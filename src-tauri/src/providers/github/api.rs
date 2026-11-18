//! Minimal GitHub REST client (blocking, via ureq).
//!
//! GitHub's rate limits (docs.github.com, "Rate limits for the REST API"):
//! - Primary: 60 requests an hour per IP signed out, 5,000 an hour signed in
//!   ("core"); the search API has its own bucket, 10 a minute signed out and
//!   30 signed in. Every answer says what's left (`x-ratelimit-*`), and
//!   `GET /rate_limit` reports it for free. A bucket known to be empty isn't
//!   called again until it resets.
//! - Secondary: 403 / 429 without those numbers. Wait `retry-after` when
//!   given, else at least a minute, longer each time it happens again.
//! - Conditional requests: a `304 Not Modified` to a signed-in request costs
//!   nothing, so answers are kept with their ETag and asked for again with it.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::super::now_ms;

const API: &str = "https://api.github.com";
/// Answers kept for conditional requests; the cache starts over past this.
const MAX_CACHED: usize = 256;
/// A secondary limit's wait when GitHub doesn't say, doubled each time in a row.
const SECONDARY_WAIT_MS: u64 = 60_000;
const MAX_SECONDARY_DOUBLINGS: u32 = 5;

/// GitHub's separate rate-limit buckets this client uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Resource {
    Core,
    Search,
}

impl Resource {
    fn of_path(path: &str) -> Self {
        if path.starts_with("/search/") {
            Resource::Search
        } else {
            Resource::Core
        }
    }

    fn named(name: &str) -> Option<Self> {
        match name {
            "core" => Some(Resource::Core),
            "search" => Some(Resource::Search),
            _ => None,
        }
    }
}

/// What's left of a bucket until it resets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    pub remaining: u64,
    /// Unix time in ms.
    pub reset_ms: u64,
}

static BUDGETS: Mutex<Option<HashMap<Resource, Budget>>> = Mutex::new(None);
/// Secondary limits hit in a row (reset by any answer that isn't one).
static STRIKES: AtomicU32 = AtomicU32::new(0);
/// `url → (etag, body)` for conditional requests.
static CACHE: Mutex<Option<HashMap<String, (String, Value)>>> = Mutex::new(None);

fn set_budget(resource: Resource, budget: Budget) {
    BUDGETS
        .lock()
        .unwrap()
        .get_or_insert_with(HashMap::new)
        .insert(resource, budget);
}

/// The bucket's budget, while it hasn't reset yet.
pub fn budget(resource: Resource) -> Option<Budget> {
    let budget = *BUDGETS.lock().unwrap().as_ref()?.get(&resource)?;
    (budget.reset_ms > now_ms()).then_some(budget)
}

/// Whether `calls` more requests fit in the bucket (unknown: they do).
pub fn affordable(resource: Resource, calls: u64) -> bool {
    budget(resource).is_none_or(|b| b.remaining >= calls)
}

/// How long a secondary limit is waited out after `strikes` in a row.
fn secondary_wait(strikes: u32) -> u64 {
    SECONDARY_WAIT_MS << strikes.min(MAX_SECONDARY_DOUBLINGS)
}

/// Until when a 403 / 429 answer means to stop (unix ms), or `None` when it
/// isn't a rate limit (a 403 for missing permissions).
fn limited_until(
    status: u16,
    retry_after: Option<u64>,
    remaining: Option<u64>,
    reset: Option<u64>,
    says_rate_limit: bool,
    now: u64,
    strikes: u32,
) -> Option<u64> {
    if let Some(secs) = retry_after {
        return Some(now + secs * 1000);
    }
    if remaining == Some(0)
        && let Some(reset) = reset
    {
        return Some((reset * 1000).max(now + 1000));
    }
    (status == 429 || says_rate_limit).then(|| now + secondary_wait(strikes))
}

/// Reads `GET /rate_limit` (which doesn't count against any limit).
pub fn rate_limit(token: Option<&str>) -> Result<(), Error> {
    let v = request("/rate_limit", &[], token, false)?;
    for (resource, budget) in parse_rate_limit(&v) {
        set_budget(resource, budget);
    }
    Ok(())
}

fn parse_rate_limit(v: &Value) -> Vec<(Resource, Budget)> {
    let Some(resources) = v["resources"].as_object() else {
        return Vec::new();
    };
    resources
        .iter()
        .filter_map(|(name, r)| {
            Some((
                Resource::named(name)?,
                Budget {
                    remaining: r["remaining"].as_u64()?,
                    reset_ms: r["reset"].as_u64()? * 1000,
                },
            ))
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    /// ISO 8601, straight from GitHub.
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RepoIssues {
    pub open: u64,
    pub latest: Option<Issue>,
}

/// Error codes are worded by the frontend (`github.error.*`).
#[derive(Debug)]
pub enum Error {
    /// Missing or private without access (GitHub answers 404 / 422).
    NotFound,
    Unauthorized,
    /// Rate limited until this unix time in ms.
    RateLimited(u64),
    Network,
    Http,
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Error::NotFound => "notFound",
            Error::Unauthorized => "unauthorized",
            Error::RateLimited(_) => "rateLimited",
            Error::Network => "network",
            Error::Http => "http",
        }
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into()
}

fn get(path: &str, query: &[(&str, &str)], token: Option<&str>) -> Result<Value, Error> {
    // A bucket known to be empty isn't asked again before it resets.
    let resource = Resource::of_path(path);
    if let Some(b) = budget(resource)
        && b.remaining == 0
    {
        return Err(Error::RateLimited(b.reset_ms));
    }
    request(path, query, token, true)
}

fn request(
    path: &str,
    query: &[(&str, &str)],
    token: Option<&str>,
    conditional: bool,
) -> Result<Value, Error> {
    let mut req = agent()
        .get(format!("{API}{path}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "windows-island");
    for (k, v) in query {
        req = req.query(*k, *v);
    }
    if let Some(token) = token {
        req = req.header("Authorization", &format!("Bearer {token}"));
    }
    // Signed in and signed out can see different things: cached apart.
    let key = format!("{}|{path}?{query:?}", token.is_some());
    let cached = conditional
        .then(|| CACHE.lock().unwrap().as_ref()?.get(&key).cloned())
        .flatten();
    if let Some((etag, _)) = &cached {
        req = req.header("If-None-Match", etag);
    }
    let mut res = req.call().map_err(|_| Error::Network)?;

    let status = res.status().as_u16();
    let text = |name: &str| {
        res.headers()
            .get(name)
            .and_then(|h| h.to_str().ok())
            .map(|s| s.trim().to_string())
    };
    let number = |name: &str| text(name).and_then(|s| s.parse::<u64>().ok());
    let remaining = number("x-ratelimit-remaining");
    let reset = number("x-ratelimit-reset");
    let retry_after = number("retry-after");
    let etag = text("etag");
    let resource = text("x-ratelimit-resource")
        .and_then(|r| Resource::named(&r))
        .unwrap_or(Resource::of_path(path));
    if let (Some(remaining), Some(reset)) = (remaining, reset) {
        set_budget(
            resource,
            Budget {
                remaining,
                reset_ms: reset * 1000,
            },
        );
    }

    match status {
        200 | 304 => STRIKES.store(0, Ordering::Relaxed),
        401 => return Err(Error::Unauthorized),
        404 | 422 => return Err(Error::NotFound),
        403 | 429 => {
            let body = res.body_mut().read_to_string().unwrap_or_default();
            let strikes = STRIKES.load(Ordering::Relaxed);
            let until = limited_until(
                status,
                retry_after,
                remaining,
                reset,
                body.to_lowercase().contains("rate limit"),
                now_ms(),
                strikes,
            );
            return match until {
                Some(until) => {
                    // Only a limit GitHub didn't put a time on grows the next wait.
                    if retry_after.is_none() && remaining != Some(0) {
                        STRIKES.store(strikes + 1, Ordering::Relaxed);
                    }
                    Err(Error::RateLimited(until))
                }
                None => Err(Error::Http),
            };
        }
        _ => return Err(Error::Http),
    }
    if status == 304 {
        return cached.map(|(_, body)| body).ok_or(Error::Http);
    }
    let body = res
        .body_mut()
        .read_to_string()
        .map_err(|_| Error::Network)?;
    let value: Value = serde_json::from_str(&body).map_err(|_| Error::Http)?;
    if conditional && let Some(etag) = etag {
        let mut cache = CACHE.lock().unwrap();
        let cache = cache.get_or_insert_with(HashMap::new);
        if cache.len() >= MAX_CACHED {
            cache.clear();
        }
        cache.insert(key, (etag, value.clone()));
    }
    Ok(value)
}

/// Open issues (pull requests excluded) and the newest one.
pub fn repo_issues(repo: &str, token: Option<&str>) -> Result<RepoIssues, Error> {
    let q = format!("repo:{repo} is:issue is:open");
    let v = get(
        "/search/issues",
        &[
            ("q", &q),
            ("sort", "created"),
            ("order", "desc"),
            ("per_page", "1"),
        ],
        token,
    )?;
    let latest = v["items"].get(0).map(|i| Issue {
        number: i["number"].as_u64().unwrap_or(0),
        title: i["title"].as_str().unwrap_or_default().to_string(),
        url: i["html_url"].as_str().unwrap_or_default().to_string(),
        author: i["user"]["login"].as_str().map(str::to_string),
        created_at: i["created_at"].as_str().unwrap_or_default().to_string(),
    });
    Ok(RepoIssues {
        open: v["total_count"].as_u64().unwrap_or(0),
        latest,
    })
}

/// Login of the token's owner.
pub fn login(token: &str) -> Result<String, Error> {
    let v = get("/user", &[], Some(token))?;
    Ok(v["login"].as_str().unwrap_or_default().to_string())
}

/// What a repository's page shows at the top.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub stars: u64,
    pub forks: u64,
    /// Issues and pull requests together (GitHub's `open_issues_count`).
    pub open_issues_and_prs: u64,
    pub language: Option<String>,
    pub description: Option<String>,
    /// ISO 8601: the last push to any branch.
    pub pushed_at: Option<String>,
    pub default_branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub tag: String,
    /// The release's title, when it has one besides the tag.
    pub name: Option<String>,
    pub url: String,
    /// ISO 8601.
    pub published_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    /// First line of the message.
    pub title: String,
    pub author: Option<String>,
    pub url: String,
    /// ISO 8601.
    pub date: String,
}

pub fn repo_info(repo: &str, token: Option<&str>) -> Result<RepoInfo, Error> {
    let v = get(&format!("/repos/{repo}"), &[], token)?;
    Ok(parse_repo_info(&v))
}

fn parse_repo_info(v: &Value) -> RepoInfo {
    let text = |k: &str| {
        v[k].as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    RepoInfo {
        stars: v["stargazers_count"].as_u64().unwrap_or(0),
        forks: v["forks_count"].as_u64().unwrap_or(0),
        open_issues_and_prs: v["open_issues_count"].as_u64().unwrap_or(0),
        language: text("language"),
        description: text("description"),
        pushed_at: text("pushed_at"),
        default_branch: text("default_branch"),
    }
}

/// The newest published release (drafts and pre-releases aside); `None` without one.
pub fn latest_release(repo: &str, token: Option<&str>) -> Result<Option<Release>, Error> {
    match get(&format!("/repos/{repo}/releases/latest"), &[], token) {
        Ok(v) => Ok(parse_release(&v)),
        Err(Error::NotFound) => Ok(None),
        Err(e) => Err(e),
    }
}

fn parse_release(v: &Value) -> Option<Release> {
    let tag = v["tag_name"].as_str()?.to_string();
    let name = v["name"]
        .as_str()
        .map(str::trim)
        .filter(|n| !n.is_empty() && *n != tag)
        .map(str::to_string);
    Some(Release {
        tag,
        name,
        url: v["html_url"].as_str().unwrap_or_default().to_string(),
        published_at: v["published_at"].as_str().unwrap_or_default().to_string(),
    })
}

/// The newest commit on `branch` (the default one when `None`); `None` for an
/// empty repository.
pub fn latest_commit(
    repo: &str,
    branch: Option<&str>,
    token: Option<&str>,
) -> Result<Option<Commit>, Error> {
    let mut query = vec![("per_page", "1")];
    if let Some(branch) = branch {
        query.push(("sha", branch));
    }
    match get(&format!("/repos/{repo}/commits"), &query, token) {
        Ok(v) => Ok(v.get(0).and_then(parse_commit)),
        // An empty repository answers 409.
        Err(Error::Http) => Ok(None),
        Err(e) => Err(e),
    }
}

/// The repository's branch names (the first 100, as GitHub lists them).
pub fn branches(repo: &str, token: Option<&str>) -> Result<Vec<String>, Error> {
    let v = get(
        &format!("/repos/{repo}/branches"),
        &[("per_page", "100")],
        token,
    )?;
    Ok(v.as_array()
        .map(|list| {
            list.iter()
                .filter_map(|b| b["name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

fn parse_commit(v: &Value) -> Option<Commit> {
    let sha = v["sha"].as_str()?;
    let message = v["commit"]["message"].as_str().unwrap_or_default();
    Some(Commit {
        sha: sha.chars().take(7).collect(),
        title: message
            .lines()
            .next()
            .unwrap_or_default()
            .trim()
            .to_string(),
        author: v["author"]["login"]
            .as_str()
            .or_else(|| v["commit"]["author"]["name"].as_str())
            .map(str::to_string),
        url: v["html_url"].as_str().unwrap_or_default().to_string(),
        date: v["commit"]["committer"]["date"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn requests_go_to_their_bucket() {
        assert_eq!(Resource::of_path("/search/issues"), Resource::Search);
        assert_eq!(Resource::of_path("/repos/o/r"), Resource::Core);
        assert_eq!(Resource::named("search"), Some(Resource::Search));
        assert_eq!(Resource::named("graphql"), None);
    }

    #[test]
    fn reads_the_rate_limit_endpoint() {
        let mut got = parse_rate_limit(&json!({ "resources": {
            "core": { "limit": 60, "remaining": 12, "reset": 1_800_000_000u64 },
            "search": { "limit": 10, "remaining": 0, "reset": 1_800_000_060u64 },
            "graphql": { "limit": 0, "remaining": 0, "reset": 1 }
        }}));
        got.sort_by_key(|(r, _)| *r == Resource::Search);
        assert_eq!(
            got,
            [
                (
                    Resource::Core,
                    Budget {
                        remaining: 12,
                        reset_ms: 1_800_000_000_000
                    }
                ),
                (
                    Resource::Search,
                    Budget {
                        remaining: 0,
                        reset_ms: 1_800_000_060_000
                    }
                ),
            ]
        );
        assert!(parse_rate_limit(&json!({ "message": "nope" })).is_empty());
    }

    #[test]
    fn rate_limit_answers() {
        let now = 1_000_000;
        // retry-after wins.
        assert_eq!(
            limited_until(403, Some(30), Some(0), Some(5_000), true, now, 0),
            Some(now + 30_000)
        );
        // Primary limit: until the bucket resets.
        assert_eq!(
            limited_until(403, None, Some(0), Some(2_000), false, now, 0),
            Some(2_000_000)
        );
        // Already reset by the time it's read: a second, not the past.
        assert_eq!(
            limited_until(429, None, Some(0), Some(10), false, now, 0),
            Some(now + 1000)
        );
        // Secondary limit with no time: a minute, then longer each time in a row.
        assert_eq!(
            limited_until(403, None, Some(40), Some(2_000), true, now, 0),
            Some(now + 60_000)
        );
        assert_eq!(
            limited_until(429, None, None, None, false, now, 2),
            Some(now + 240_000)
        );
        assert_eq!(
            limited_until(429, None, None, None, false, now, 40),
            Some(now + 60_000 * 32)
        );
        // A 403 that isn't a limit (no permission) is just an error.
        assert_eq!(
            limited_until(403, None, Some(40), Some(2_000), false, now, 0),
            None
        );
    }

    #[test]
    fn an_empty_bucket_is_not_called() {
        set_budget(
            Resource::Search,
            Budget {
                remaining: 0,
                reset_ms: now_ms() + 60_000,
            },
        );
        assert!(!affordable(Resource::Search, 1));
        // Refused before any network call (the path doesn't even exist).
        assert!(matches!(
            get("/search/nothing", &[], None),
            Err(Error::RateLimited(_))
        ));
        // Once the reset time has passed, the old numbers no longer count.
        set_budget(
            Resource::Search,
            Budget {
                remaining: 0,
                reset_ms: now_ms() - 1,
            },
        );
        assert!(budget(Resource::Search).is_none());
        assert!(affordable(Resource::Search, 1));
    }

    #[test]
    fn reads_a_repository() {
        let info = parse_repo_info(&json!({
            "stargazers_count": 1200, "forks_count": 34, "open_issues_count": 17,
            "language": "Rust", "description": "  ", "pushed_at": "2026-11-17T10:00:00Z",
            "default_branch": "main"
        }));
        assert_eq!(info.default_branch.as_deref(), Some("main"));
        assert_eq!(info.stars, 1200);
        assert_eq!(info.forks, 34);
        assert_eq!(info.open_issues_and_prs, 17);
        assert_eq!(info.language.as_deref(), Some("Rust"));
        // A blank description is no description.
        assert_eq!(info.description, None);
    }

    #[test]
    fn a_release_named_like_its_tag_has_no_separate_name() {
        let r = parse_release(&json!({
            "tag_name": "v1.2.0", "name": "v1.2.0",
            "html_url": "https://github.com/o/r/releases/tag/v1.2.0",
            "published_at": "2026-11-17T10:00:00Z"
        }))
        .unwrap();
        assert_eq!(r.tag, "v1.2.0");
        assert_eq!(r.name, None);
        let named = parse_release(&json!({ "tag_name": "v2", "name": "Big one" })).unwrap();
        assert_eq!(named.name.as_deref(), Some("Big one"));
    }

    #[test]
    fn a_commit_keeps_its_short_sha_and_first_line() {
        let c = parse_commit(&json!({
            "sha": "0123456789abcdef",
            "html_url": "https://github.com/o/r/commit/0123456",
            "author": null,
            "commit": {
                "message": "Fix the thing\n\nLong explanation",
                "author": { "name": "Someone" },
                "committer": { "date": "2026-11-17T10:00:00Z" }
            }
        }))
        .unwrap();
        assert_eq!(c.sha, "0123456");
        assert_eq!(c.title, "Fix the thing");
        // No GitHub account linked: the git author's name.
        assert_eq!(c.author.as_deref(), Some("Someone"));
    }
}
