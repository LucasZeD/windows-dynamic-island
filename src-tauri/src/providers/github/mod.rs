//! GitHub: the repositories the user follows: open issues and pull requests,
//! stars, forks, the latest release and commit, and news when a release comes
//! out or someone pushes.
//!
//! The repo list lives in the regular settings store (`github.repos`, edited by
//! the settings window); this provider re-polls whenever it changes and every
//! few minutes otherwise. Counts come from the search API, which excludes pull
//! requests (a repo's `open_issues_count` doesn't).
//!
//! Auth, in order: a token saved from the settings window (kept in the Windows
//! Credential Manager, see `providers/credentials.rs`), the GitHub CLI (`gh auth token`),
//! or anonymous — public repos only, with a much lower rate limit.

mod api;

use std::sync::Arc;
use std::sync::Mutex;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{Listener, Manager};

use super::{Provider, credentials, now_ms};
use crate::hub::Hub;
use crate::settings::{self, Settings};

pub const ID: &str = "github";

const TOKEN_TARGET: &str = "dynamic-island:github";
const REPOS_KEY: &str = "github.repos";
/// `{ "owner/name": "branch" }`: the branch to follow, when not the default one.
const BRANCHES_KEY: &str = "github.branches";
const ENABLED_KEY: &str = "module.github.enabled";
const POLL_MS: u64 = 5 * 60 * 1000;
/// Manual refreshes closer than this to the last round are ignored.
const MIN_REFRESH_GAP_MS: u64 = 20_000;
const MAX_REPOS: usize = 30;
/// Releases and pushes kept for the frontend, newest first.
const MAX_UPDATES: usize = 10;
/// Without a login GitHub allows 60 calls an hour: a repository's details
/// (3 calls) are then refreshed this rarely. Signed in, every round.
const ANON_DETAILS_MS: u64 = 30 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Auth {
    #[default]
    None,
    Token,
    Gh,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoState {
    /// `owner/name`, as the user typed it.
    pub name: String,
    /// The branch followed for commits; `None`: the default branch.
    pub branch: Option<String>,
    pub open_issues: Option<u64>,
    pub latest: Option<api::Issue>,
    pub error: Option<&'static str>,
    pub info: Option<api::RepoInfo>,
    /// GitHub counts pull requests among the open issues: those minus the issues.
    pub open_prs: Option<u64>,
    pub release: Option<api::Release>,
    pub commit: Option<api::Commit>,
    /// When the details (info, release, commit) were last read; 0: never.
    #[serde(skip)]
    pub details_at: u64,
}

/// News from a followed repository since the previous poll.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub repo: String,
    /// `release` or `commit`.
    pub kind: &'static str,
    /// The release's tag, or the commit's first line.
    pub title: String,
    /// The commit's branch, when not the default one.
    pub branch: Option<String>,
    pub url: String,
    pub seen_at: u64,
}

/// An issue that showed up since the previous poll (drives the peek).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewIssue {
    pub repo: String,
    pub issue: api::Issue,
    pub seen_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GithubState {
    pub repos: Vec<RepoState>,
    pub auth: Auth,
    pub login: Option<String>,
    /// The saved token was rejected.
    pub auth_error: bool,
    pub rate_limited_until: Option<u64>,
    pub loading: bool,
    pub updated_at: Option<u64>,
    pub new_issue: Option<NewIssue>,
    /// Releases and pushes seen while running, newest first.
    pub updates: Vec<Update>,
}

enum Wake {
    Settings,
    Refresh,
    Auth,
}

#[derive(Default)]
pub struct GithubProvider {
    tx: Mutex<Option<Sender<Wake>>>,
}

impl GithubProvider {
    fn wake(&self, w: Wake) {
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(w);
        }
    }
}

impl Provider for GithubProvider {
    fn id(&self) -> &'static str {
        ID
    }

    fn start(self: Arc<Self>, hub: Arc<Hub>) {
        let (tx, rx) = mpsc::channel();
        let on_settings = tx.clone();
        hub.app().listen(settings::CHANGED_EVENT, move |_| {
            let _ = on_settings.send(Wake::Settings);
        });
        *self.tx.lock().unwrap() = Some(tx);

        std::thread::spawn(move || {
            let mut w = Worker {
                hub,
                state: GithubState::default(),
                signature: String::new(),
                last_round: 0,
                auth_dirty: true,
            };
            let mut next_at = 0u64;
            loop {
                let wait = next_at.saturating_sub(now_ms());
                let reason = match rx.recv_timeout(Duration::from_millis(wait)) {
                    Ok(w) => Some(w),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => return,
                };
                let (enabled, repos) = w.config();
                // The order doesn't count: reordering the list needs no new requests.
                let mut sorted = repos.clone();
                sorted.sort();
                let signature = format!("{enabled}|{sorted:?}");
                match reason {
                    // Some other setting changed, or only the order.
                    Some(Wake::Settings) if signature == w.signature => {
                        w.reorder(&repos);
                        continue;
                    }
                    Some(Wake::Refresh)
                        if now_ms().saturating_sub(w.last_round) < MIN_REFRESH_GAP_MS =>
                    {
                        continue;
                    }
                    Some(Wake::Auth) => w.auth_dirty = true,
                    _ => {}
                }
                w.signature = signature;
                if enabled {
                    w.round(&repos);
                }
                next_at = (now_ms() + POLL_MS).max(w.state.rate_limited_until.unwrap_or(0));
            }
        });
    }

    fn action(&self, action: &str, payload: Value) -> Result<Value, String> {
        match action {
            "refresh" => self.wake(Wake::Refresh),
            "setToken" => {
                let token = payload["token"].as_str().unwrap_or_default().trim();
                if token.is_empty() {
                    return Err("empty token".into());
                }
                // Only keep tokens GitHub accepts.
                let login = api::login(token).map_err(|e| e.code().to_string())?;
                credentials::write(TOKEN_TARGET, token)?;
                self.wake(Wake::Auth);
                return Ok(Value::String(login));
            }
            "clearToken" => {
                credentials::delete(TOKEN_TARGET)?;
                self.wake(Wake::Auth);
            }
            "branches" => {
                let repo = payload["repo"].as_str().unwrap_or_default().trim();
                if !valid_repo(repo) {
                    return Err("invalid repository".into());
                }
                let (token, _) = resolve_token();
                let names =
                    api::branches(repo, token.as_deref()).map_err(|e| e.code().to_string())?;
                return Ok(serde_json::json!(names));
            }
            "open" => {
                let url = payload["url"].as_str().unwrap_or_default();
                if !url.starts_with("https://github.com/") {
                    return Err("only github.com links can be opened".into());
                }
                settings::open_url(url);
            }
            _ => return Err(format!("github: unknown action '{action}'")),
        }
        Ok(Value::Null)
    }
}

struct Worker {
    hub: Arc<Hub>,
    state: GithubState,
    /// Module switch + repo list at the last round, to skip unrelated settings changes.
    signature: String,
    last_round: u64,
    auth_dirty: bool,
}

impl Worker {
    fn config(&self) -> (bool, Vec<(String, Option<String>)>) {
        let settings = self.hub.app().state::<Settings>();
        let enabled = settings
            .get(ENABLED_KEY)
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let mut repos: Vec<String> = Vec::new();
        for v in settings
            .get(REPOS_KEY)
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
        {
            if let Some(r) = v.as_str().map(str::trim)
                && valid_repo(r)
                && !repos.iter().any(|x| x.eq_ignore_ascii_case(r))
            {
                repos.push(r.to_string());
            }
        }
        repos.truncate(MAX_REPOS);
        let branches = settings.get(BRANCHES_KEY).unwrap_or_default();
        let with_branches = repos
            .into_iter()
            .map(|name| {
                let branch = branches[&name]
                    .as_str()
                    .map(str::trim)
                    .filter(|b| valid_branch(b))
                    .map(str::to_string);
                (name, branch)
            })
            .collect();
        (enabled, with_branches)
    }

    /// Puts the known repos in the user's order (no requests).
    fn reorder(&mut self, repos: &[(String, Option<String>)]) {
        let place = |name: &str| {
            repos
                .iter()
                .position(|(r, _)| r.eq_ignore_ascii_case(name))
                .unwrap_or(usize::MAX)
        };
        let before: Vec<String> = self.state.repos.iter().map(|r| r.name.clone()).collect();
        self.state.repos.sort_by_key(|r| place(&r.name));
        if self.state.repos.iter().map(|r| &r.name).ne(before.iter()) {
            self.publish();
        }
    }

    fn publish(&self) {
        self.hub.publish(ID, &self.state);
    }

    fn round(&mut self, repos: &[(String, Option<String>)]) {
        self.last_round = now_ms();
        let (mut token, auth) = resolve_token();
        if auth != self.state.auth {
            self.auth_dirty = true;
        }
        self.state.auth = auth;
        if self.auth_dirty {
            self.state.login = None;
            self.state.auth_error = false;
            match token.as_deref().map(api::login) {
                Some(Ok(login)) => {
                    self.state.login = Some(login);
                    self.auth_dirty = false;
                }
                Some(Err(api::Error::Unauthorized)) => {
                    self.state.auth_error = true;
                    self.auth_dirty = false;
                }
                // Offline / rate limited: try again next round.
                Some(Err(_)) => {}
                None => self.auth_dirty = false,
            }
        }
        if self.state.auth_error {
            token = None;
        }

        // Keep what we know about repos still in the list, in the user's order.
        let mut previous = std::mem::take(&mut self.state.repos);
        self.state.repos = repos
            .iter()
            .map(|(name, branch)| {
                previous
                    .iter()
                    .position(|r| r.name.eq_ignore_ascii_case(name))
                    .map(|i| previous.swap_remove(i))
                    .map(|r| follow(r, name, branch))
                    .unwrap_or_else(|| RepoState {
                        name: name.clone(),
                        branch: branch.clone(),
                        ..Default::default()
                    })
            })
            .collect();
        if self.state.rate_limited_until.is_some_and(|t| t <= now_ms()) {
            self.state.rate_limited_until = None;
        }
        self.state.loading = true;
        self.publish();

        for i in 0..self.state.repos.len() {
            if self.state.rate_limited_until.is_some() {
                break;
            }
            let name = self.state.repos[i].name.clone();
            match api::repo_issues(&name, token.as_deref()) {
                Ok(found) => {
                    let repo = &mut self.state.repos[i];
                    let prev_number = repo.latest.as_ref().map(|l| l.number);
                    if let (Some(prev), Some(latest)) = (prev_number, &found.latest)
                        && latest.number > prev
                    {
                        self.state.new_issue = Some(NewIssue {
                            repo: name.clone(),
                            issue: latest.clone(),
                            seen_at: now_ms(),
                        });
                    }
                    let repo = &mut self.state.repos[i];
                    repo.open_issues = Some(found.open);
                    repo.latest = found.latest;
                    repo.error = None;
                    let due = token.is_some()
                        || now_ms().saturating_sub(repo.details_at) > ANON_DETAILS_MS;
                    if due
                        && let Err(api::Error::RateLimited(until)) =
                            self.details(i, token.as_deref())
                    {
                        self.state.rate_limited_until = Some(until);
                    }
                }
                Err(api::Error::RateLimited(until)) => {
                    self.state.rate_limited_until = Some(until);
                }
                Err(e) => {
                    if matches!(e, api::Error::Unauthorized) && token.is_some() {
                        self.state.auth_error = true;
                    }
                    self.state.repos[i].error = Some(e.code());
                }
            }
            self.publish();
        }

        self.state.loading = false;
        self.state.updated_at = Some(now_ms());
        self.publish();
    }
}

impl Worker {
    /// Stars, forks, the latest release and commit of `repos[i]`, and news
    /// when the release or the commit changed. Other errors leave the last
    /// known details in place.
    fn details(&mut self, i: usize, token: Option<&str>) -> Result<(), api::Error> {
        let name = self.state.repos[i].name.clone();
        let info = api::repo_info(&name, token)?;
        let release = api::latest_release(&name, token)?;
        let branch = self.state.repos[i].branch.clone();
        let commit = api::latest_commit(&name, branch.as_deref(), token)?;
        let repo = &mut self.state.repos[i];
        let news = news(repo, release.as_ref(), commit.as_ref(), now_ms());
        repo.open_prs = repo
            .open_issues
            .map(|issues| info.open_issues_and_prs.saturating_sub(issues));
        repo.info = Some(info);
        repo.release = release;
        repo.commit = commit;
        repo.details_at = now_ms();
        for update in news {
            self.state.updates.insert(0, update);
        }
        self.state.updates.truncate(MAX_UPDATES);
        Ok(())
    }
}

/// What changed since `repo`'s details were last read. Nothing the first time:
/// what's there when a repository is added (or the app starts) isn't news.
fn news(
    repo: &RepoState,
    release: Option<&api::Release>,
    commit: Option<&api::Commit>,
    now: u64,
) -> Vec<Update> {
    if repo.details_at == 0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    if let Some(r) = release
        && repo.release.as_ref().map(|p| &p.tag) != Some(&r.tag)
    {
        out.push(Update {
            repo: repo.name.clone(),
            kind: "release",
            title: r.tag.clone(),
            branch: None,
            url: r.url.clone(),
            seen_at: now,
        });
    }
    if let Some(c) = commit
        && repo.commit.as_ref().map(|p| &p.sha) != Some(&c.sha)
    {
        out.push(Update {
            repo: repo.name.clone(),
            kind: "commit",
            title: c.title.clone(),
            branch: repo.branch.clone(),
            url: c.url.clone(),
            seen_at: now,
        });
    }
    out
}

/// What's known about a repo, now following `branch`. On another branch the
/// last commit no longer counts: it's read again, and isn't news.
fn follow(known: RepoState, name: &str, branch: &Option<String>) -> RepoState {
    let mut repo = RepoState {
        name: name.to_string(),
        ..known
    };
    if repo.branch != *branch {
        repo.branch = branch.clone();
        repo.commit = None;
        repo.details_at = 0;
    }
    repo
}

/// A branch name git and GitHub would accept (no spaces, `..` or control characters).
fn valid_branch(b: &str) -> bool {
    !b.is_empty()
        && b.len() <= 255
        && !b.contains("..")
        && !b.starts_with('/')
        && !b.ends_with('/')
        && b.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./+".contains(c))
}

/// `owner/name` with GitHub's allowed characters.
fn valid_repo(r: &str) -> bool {
    let ok = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    matches!(r.split_once('/'), Some((owner, name)) if ok(owner) && ok(name))
}

fn resolve_token() -> (Option<String>, Auth) {
    if let Some(t) = credentials::read(TOKEN_TARGET) {
        return (Some(t), Auth::Token);
    }
    if let Some(t) = gh_token() {
        return (Some(t), Auth::Gh);
    }
    (None, Auth::None)
}

/// Token of a logged-in GitHub CLI, if installed.
fn gh_token() -> Option<String> {
    let mut cmd = std::process::Command::new("gh");
    cmd.args(["auth", "token"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let token = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (!token.is_empty()).then_some(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str) -> api::Release {
        api::Release {
            tag: tag.into(),
            name: None,
            url: format!("https://github.com/o/r/releases/tag/{tag}"),
            published_at: String::new(),
        }
    }

    fn commit(sha: &str) -> api::Commit {
        api::Commit {
            sha: sha.into(),
            title: format!("commit {sha}"),
            author: None,
            url: String::new(),
            date: String::new(),
        }
    }

    fn known(release_tag: Option<&str>, sha: &str) -> RepoState {
        RepoState {
            name: "o/r".into(),
            release: release_tag.map(release),
            commit: Some(commit(sha)),
            details_at: 1,
            ..Default::default()
        }
    }

    #[test]
    fn switching_branch_forgets_the_last_commit_without_news() {
        let repo = follow(known(Some("v1"), "aaa"), "o/r", &Some("dev".into()));
        assert_eq!(repo.branch.as_deref(), Some("dev"));
        assert!(repo.commit.is_none());
        assert!(news(&repo, Some(&release("v2")), Some(&commit("bbb")), 5).is_empty());
        // Same branch: kept as is.
        let same = follow(known(Some("v1"), "aaa"), "o/r", &None);
        assert!(same.commit.is_some());
    }

    #[test]
    fn branch_names_are_checked() {
        assert!(valid_branch("main"));
        assert!(valid_branch("release/1.2"));
        assert!(!valid_branch(""));
        assert!(!valid_branch("a b"));
        assert!(!valid_branch("../x"));
    }

    #[test]
    fn the_first_read_is_not_news() {
        let fresh = RepoState {
            name: "o/r".into(),
            ..Default::default()
        };
        assert!(news(&fresh, Some(&release("v1")), Some(&commit("aaa")), 5).is_empty());
    }

    #[test]
    fn a_new_release_and_a_push_are_news() {
        let repo = known(Some("v1"), "aaa");
        let out = news(&repo, Some(&release("v2")), Some(&commit("bbb")), 5);
        let kinds: Vec<_> = out.iter().map(|u| (u.kind, u.title.as_str())).collect();
        assert_eq!(kinds, [("release", "v2"), ("commit", "commit bbb")]);
    }

    #[test]
    fn the_first_release_ever_is_news_and_nothing_new_is_not() {
        let repo = known(None, "aaa");
        assert_eq!(
            news(&repo, Some(&release("v1")), Some(&commit("aaa")), 5).len(),
            1
        );
        let same = known(Some("v1"), "aaa");
        assert!(news(&same, Some(&release("v1")), Some(&commit("aaa")), 5).is_empty());
    }
}
