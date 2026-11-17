//! Minimal GitHub REST client (blocking, via ureq).

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::super::now_ms;

const API: &str = "https://api.github.com";

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
    let mut res = req.call().map_err(|_| Error::Network)?;

    let status = res.status().as_u16();
    let header = |name: &str| {
        res.headers()
            .get(name)
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
    };
    match status {
        200 => {}
        401 => return Err(Error::Unauthorized),
        404 | 422 => return Err(Error::NotFound),
        403 | 429 => {
            let until = header("retry-after")
                .map(|secs| now_ms() + secs * 1000)
                .or_else(|| {
                    let exhausted = header("x-ratelimit-remaining") == Some(0);
                    header("x-ratelimit-reset")
                        .filter(|_| exhausted)
                        .map(|secs| secs * 1000)
                })
                // Secondary limits don't always say when; back off a minute.
                .unwrap_or_else(|| now_ms() + 60_000);
            return Err(Error::RateLimited(until));
        }
        _ => return Err(Error::Http),
    }
    let body = res
        .body_mut()
        .read_to_string()
        .map_err(|_| Error::Network)?;
    serde_json::from_str(&body).map_err(|_| Error::Http)
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

/// The newest commit on the default branch; `None` for an empty repository.
pub fn latest_commit(repo: &str, token: Option<&str>) -> Result<Option<Commit>, Error> {
    match get(
        &format!("/repos/{repo}/commits"),
        &[("per_page", "1")],
        token,
    ) {
        Ok(v) => Ok(v.get(0).and_then(parse_commit)),
        // An empty repository answers 409.
        Err(Error::Http) => Ok(None),
        Err(e) => Err(e),
    }
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
    fn reads_a_repository() {
        let info = parse_repo_info(&json!({
            "stargazers_count": 1200, "forks_count": 34, "open_issues_count": 17,
            "language": "Rust", "description": "  ", "pushed_at": "2026-11-17T10:00:00Z"
        }));
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
