//! Cursor: plan usage and tokens from Cursor's account usage endpoints (the
//! ones its own dashboard uses; undocumented, so every field is optional).
//!
//! Cursor keeps no token counts locally. Its login is in VS Code's state
//! database (`state.vscdb`, key `cursorAuth/accessToken`), read-only, every
//! poll, so a new sign-in is picked up without restarting. The token stays in
//! this process: it is only sent to cursor.com over HTTPS, never logged and
//! never published to the UI.
//!
//! - `GET  /api/usage-summary`: billing cycle, plan spend, the Total / Auto / API
//!   percentages Cursor shows.
//! - `POST /api/dashboard/get-aggregated-usage-events`: tokens over a range.
//! - `POST /api/dashboard/get-filtered-usage-events`: how many requests (count only).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{Days, Local, NaiveDate, TimeZone};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::Manager;

use super::claude::{DayUsage, TokenStats, Usage};
use super::{Provider, now_ms};
use crate::hub::Hub;
use crate::settings::Settings;

pub const ID: &str = "cursor";
const MODULE_KEY: &str = "module.ai-agents.enabled";
const BASE: &str = "https://cursor.com";
/// Background refresh. Cursor's numbers move per request, not per second.
const POLL: Duration = Duration::from_secs(5 * 60);
/// `refresh` from the UI (the card is on screen): at most this often.
const REFRESH_MIN: Duration = Duration::from_secs(60);
const DAYS: u64 = 7;

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    /// `total`, `auto` or `api` (the frontend names them).
    pub id: String,
    pub used_pct: f64,
    /// Unix ms: end of the billing cycle.
    pub resets_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CursorState {
    /// Cursor is installed (its state database exists).
    pub available: bool,
    pub signed_in: bool,
    /// `signed-out`, `expired`, `network` or `api`.
    pub error: Option<String>,
    /// `pro`, `free`, …
    pub plan: Option<String>,
    pub limits: Vec<Limit>,
    /// Cursor's own message when usage is capped ("You've hit your usage limit").
    pub message: Option<String>,
    pub tokens_today: TokenStats,
    pub usage: Usage,
    /// Unix ms of the last successful refresh.
    pub updated_at: u64,
}

struct Login {
    token: String,
    user_id: String,
    /// Unix seconds.
    expires: u64,
}

impl Login {
    fn cookie(&self) -> String {
        format!(
            "WorkosCursorSessionToken={}%3A%3A{}",
            self.user_id, self.token
        )
    }
}

/// VS Code's state database in Cursor's user folder.
fn state_db() -> PathBuf {
    let config = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    };
    config
        .unwrap_or_default()
        .join("Cursor/User/globalStorage/state.vscdb")
}

fn read_login(db: &std::path::Path) -> Option<Login> {
    use rusqlite::{Connection, OpenFlags};
    // Read-only, and through the WAL: Cursor writes there while it runs.
    let conn = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.busy_timeout(Duration::from_secs(2)).ok()?;
    let value: rusqlite::types::Value = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'",
            [],
            |row| row.get(0),
        )
        .ok()?;
    let token = match value {
        rusqlite::types::Value::Text(t) => t,
        rusqlite::types::Value::Blob(b) => String::from_utf8(b).ok()?,
        _ => return None,
    };
    let (user_id, expires) = claims(&token)?;
    Some(Login {
        token,
        user_id,
        expires,
    })
}

/// `(user id, expiry in unix seconds)` from the JWT's payload. `sub` is
/// `provider|id`; the cookie wants the id.
fn claims(token: &str) -> Option<(String, u64)> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    let sub = v["sub"].as_str()?;
    let id = sub.rsplit('|').next()?.to_string();
    // The id goes in a cookie: refuse anything that could break out of it.
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some((id, v["exp"].as_u64().unwrap_or(0)))
}

/// Numbers come as JSON numbers or as strings ("2231852").
fn num(v: &Value) -> f64 {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}

enum ApiError {
    /// 401/403: the token was revoked or expired early.
    Auth,
    Network,
    Other,
}

struct Api {
    agent: ureq::Agent,
}

impl Api {
    fn new() -> Self {
        let agent = ureq::Agent::config_builder()
            .https_only(true)
            .http_status_as_error(false)
            .max_redirects(0)
            .timeout_global(Some(Duration::from_secs(20)))
            .user_agent(concat!(
                "Mozilla/5.0 IslandForWindows/",
                env!("CARGO_PKG_VERSION")
            ))
            .build()
            .into();
        Self { agent }
    }

    fn call(&self, login: &Login, path: &str, body: Option<Value>) -> Result<Value, ApiError> {
        let url = format!("{BASE}{path}");
        let res = match body {
            None => self
                .agent
                .get(&url)
                .header("Cookie", &login.cookie())
                .header("Accept", "application/json")
                .call(),
            Some(body) => self
                .agent
                .post(&url)
                .header("Cookie", &login.cookie())
                .header("Accept", "application/json")
                .header("Origin", BASE)
                .header("Content-Type", "application/json")
                .send(body.to_string()),
        };
        let mut res = res.map_err(|_| ApiError::Network)?;
        match res.status().as_u16() {
            200..=299 => res
                .body_mut()
                .with_config()
                .limit(4 * 1024 * 1024)
                .read_to_string()
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok())
                .ok_or(ApiError::Other),
            401 | 403 => Err(ApiError::Auth),
            s => {
                log::warn!("cursor: {path} answered {s}");
                Err(ApiError::Other)
            }
        }
    }

    /// Tokens and request count between two unix-ms instants.
    fn range(&self, login: &Login, from: u64, to: u64) -> Result<TokenStats, ApiError> {
        let range =
            json!({ "teamId": -1, "startDate": from.to_string(), "endDate": to.to_string() });
        let agg = self.call(
            login,
            "/api/dashboard/get-aggregated-usage-events",
            Some(range),
        )?;
        let mut count = json!({ "teamId": 0, "startDate": from.to_string(), "endDate": to.to_string(),
            "page": 1, "pageSize": 1 });
        let events = self.call(
            login,
            "/api/dashboard/get-filtered-usage-events",
            Some(count.take()),
        )?;
        Ok(tokens_of(&agg, &events))
    }
}

fn tokens_of(agg: &Value, events: &Value) -> TokenStats {
    TokenStats {
        input: num(&agg["totalInputTokens"]) as u64,
        output: num(&agg["totalOutputTokens"]) as u64,
        cache_read: num(&agg["totalCacheReadTokens"]) as u64,
        cache_write: num(&agg["totalCacheWriteTokens"]) as u64,
        messages: num(&events["totalUsageEventsCount"]) as u64,
    }
}

fn total(t: &TokenStats) -> u64 {
    t.input + t.output + t.cache_read + t.cache_write
}

/// The limits Cursor's dashboard shows, from `/api/usage-summary`.
fn limits_of(summary: &Value) -> Vec<Limit> {
    let plan = &summary["individualUsage"]["plan"];
    let resets_at = summary["billingCycleEnd"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis() as u64);
    [
        ("total", "totalPercentUsed"),
        ("auto", "autoPercentUsed"),
        ("api", "apiPercentUsed"),
    ]
    .into_iter()
    .filter(|(_, field)| plan[*field].is_number())
    .map(|(id, field)| Limit {
        id: id.into(),
        used_pct: num(&plan[field]).clamp(0.0, 100.0),
        resets_at,
    })
    .collect()
}

fn local_midnight_ms(day: NaiveDate) -> u64 {
    Local
        .from_local_datetime(&day.and_hms_opt(0, 0, 0).unwrap_or_default())
        .earliest()
        .map(|d| d.timestamp_millis() as u64)
        .unwrap_or(0)
}

struct Ctx {
    hub: Arc<Hub>,
    state: Mutex<CursorState>,
    api: Api,
    /// Finished days don't change: fetched once.
    past_days: Mutex<HashMap<NaiveDate, TokenStats>>,
    last_refresh: Mutex<Option<Instant>>,
    wake: (Mutex<bool>, std::sync::Condvar),
}

impl Ctx {
    fn publish(&self) {
        self.hub.publish(ID, self.state.lock().unwrap().clone());
    }

    fn module_on(&self) -> bool {
        self.hub
            .app()
            .state::<Settings>()
            .get(MODULE_KEY)
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    }

    fn set(&self, f: impl FnOnce(&mut CursorState)) {
        let mut state = self.state.lock().unwrap();
        let before = state.clone();
        f(&mut state);
        let changed = *state != before;
        drop(state);
        if changed {
            self.publish();
        }
    }

    fn refresh(&self) {
        *self.last_refresh.lock().unwrap() = Some(Instant::now());
        let db = state_db();
        if !db.is_file() {
            self.set(|s| *s = CursorState::default());
            return;
        }
        let Some(login) = read_login(&db) else {
            self.set(|s| {
                s.available = true;
                s.signed_in = false;
                s.error = Some("signed-out".into());
            });
            return;
        };
        if login.expires != 0 && login.expires * 1000 <= now_ms() {
            self.set(|s| {
                s.available = true;
                s.signed_in = false;
                s.error = Some("expired".into());
            });
            return;
        }
        match self.fetch(&login) {
            Ok(()) => {}
            Err(e) => {
                let error = match e {
                    ApiError::Auth => "expired",
                    ApiError::Network => "network",
                    ApiError::Other => "api",
                };
                self.set(|s| {
                    s.available = true;
                    s.signed_in = !matches!(e, ApiError::Auth);
                    s.error = Some(error.into());
                });
            }
        }
    }

    fn fetch(&self, login: &Login) -> Result<(), ApiError> {
        let summary = self.api.call(login, "/api/usage-summary", None)?;
        let now = now_ms();
        let today = Local::now().date_naive();

        let tokens_today = self.api.range(login, local_midnight_ms(today), now)?;
        let last5h = self
            .api
            .range(login, now.saturating_sub(5 * 3600 * 1000), now)?;

        let mut daily = Vec::with_capacity(DAYS as usize);
        for back in (1..DAYS).rev() {
            let Some(day) = today.checked_sub_days(Days::new(back)) else {
                continue;
            };
            let cached = self.past_days.lock().unwrap().get(&day).cloned();
            let stats = match cached {
                Some(stats) => stats,
                None => {
                    let next = day.succ_opt().unwrap_or(day);
                    let stats =
                        self.api
                            .range(login, local_midnight_ms(day), local_midnight_ms(next))?;
                    self.past_days.lock().unwrap().insert(day, stats.clone());
                    stats
                }
            };
            daily.push(DayUsage {
                date: day.to_string(),
                tokens: total(&stats),
                responses: stats.messages,
            });
        }
        daily.push(DayUsage {
            date: today.to_string(),
            tokens: total(&tokens_today),
            responses: tokens_today.messages,
        });
        // Keep only the window: the cache would otherwise grow by a day a day.
        self.past_days.lock().unwrap().retain(|d, _| {
            today
                .checked_sub_days(Days::new(DAYS))
                .is_some_and(|oldest| *d > oldest)
        });

        let limits = limits_of(&summary);
        let plan = summary["membershipType"].as_str().map(str::to_string);
        // Only when Cursor says the plan is used up; otherwise it's marketing copy.
        let capped = summary["individualUsage"]["plan"]["remaining"].as_f64() == Some(0.0)
            && summary["individualUsage"]["onDemand"]["enabled"] != Value::Bool(true);
        let message = capped
            .then(|| summary["namedModelSelectedDisplayMessage"].as_str())
            .flatten()
            .map(str::to_string);
        self.set(|s| {
            s.available = true;
            s.signed_in = true;
            s.error = None;
            s.plan = plan;
            s.limits = limits;
            s.message = message;
            s.tokens_today = tokens_today;
            s.usage = Usage {
                daily,
                last5h_tokens: total(&last5h),
            };
            s.updated_at = now;
        });
        Ok(())
    }

    fn wake(&self) {
        let (lock, cvar) = &self.wake;
        *lock.lock().unwrap() = true;
        cvar.notify_one();
    }

    fn sleep(&self, d: Duration) {
        let (lock, cvar) = &self.wake;
        let guard = lock.lock().unwrap();
        let (mut woken, _) = cvar.wait_timeout_while(guard, d, |w| !*w).unwrap();
        *woken = false;
    }
}

fn run(ctx: Arc<Ctx>) {
    loop {
        if ctx.module_on() {
            ctx.refresh();
        }
        ctx.sleep(POLL);
    }
}

/// Cursor's exe for "open the app".
fn cursor_exe() -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let exe = local.join("Programs/cursor/Cursor.exe");
    exe.is_file().then_some(exe)
}

#[derive(Default)]
pub struct CursorProvider {
    ctx: Mutex<Option<Arc<Ctx>>>,
}

impl Provider for CursorProvider {
    fn id(&self) -> &'static str {
        ID
    }

    fn start(self: Arc<Self>, hub: Arc<Hub>) {
        let ctx = Arc::new(Ctx {
            hub,
            state: Mutex::new(CursorState::default()),
            api: Api::new(),
            past_days: Mutex::new(HashMap::new()),
            last_refresh: Mutex::new(None),
            wake: (Mutex::new(false), std::sync::Condvar::new()),
        });
        ctx.state.lock().unwrap().available = state_db().is_file();
        ctx.publish();
        *self.ctx.lock().unwrap() = Some(ctx.clone());
        std::thread::spawn(move || run(ctx));
    }

    fn action(&self, action: &str, _payload: Value) -> Result<Value, String> {
        let ctx = self
            .ctx
            .lock()
            .unwrap()
            .clone()
            .ok_or("cursor: not started")?;
        match action {
            // The card is on screen: fresher numbers, but not more than once a minute.
            "refresh" => {
                let recent = ctx
                    .last_refresh
                    .lock()
                    .unwrap()
                    .is_some_and(|t| t.elapsed() < REFRESH_MIN);
                if !recent {
                    ctx.wake();
                }
                Ok(Value::Null)
            }
            "openApp" => {
                match cursor_exe() {
                    Some(exe) => {
                        std::process::Command::new(exe)
                            .spawn()
                            .map_err(|e| format!("couldn't start Cursor: {e}"))?;
                    }
                    None => crate::settings::open_url("cursor://"),
                }
                Ok(Value::Null)
            }
            _ => Err(format!("cursor: unknown action '{action}'")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt(payload: Value) -> String {
        format!("x.{}.y", URL_SAFE_NO_PAD.encode(payload.to_string()))
    }

    /// Against the real account of whoever runs it (Cursor signed in):
    /// `cargo test --lib cursor::tests::live -- --ignored --nocapture`.
    /// Prints numbers only, never the token.
    #[test]
    #[ignore]
    fn live() {
        let login = read_login(&state_db()).expect("Cursor installed and signed in");
        assert!(
            login.expires * 1000 > now_ms(),
            "token expired: open Cursor"
        );
        let api = Api::new();
        let summary = api
            .call(&login, "/api/usage-summary", None)
            .ok()
            .expect("usage-summary");
        for l in limits_of(&summary) {
            println!(
                "limit {:<5} {:>5.1}%  resets {:?}",
                l.id, l.used_pct, l.resets_at
            );
        }
        let now = now_ms();
        let today = api
            .range(&login, local_midnight_ms(Local::now().date_naive()), now)
            .ok()
            .expect("today");
        println!(
            "today: in {} out {} cache {} requests {}",
            today.input, today.output, today.cache_read, today.messages
        );
        let week = api
            .range(&login, now - 7 * 86_400_000, now)
            .ok()
            .expect("7 days");
        println!(
            "7 days: {} tokens, {} requests",
            total(&week),
            week.messages
        );
    }

    #[test]
    fn reads_user_id_and_expiry_from_the_token() {
        let token = jwt(json!({ "sub": "google-oauth2|user_01ABC", "exp": 1_800_000_000u64 }));
        assert_eq!(claims(&token), Some(("user_01ABC".into(), 1_800_000_000)));
    }

    #[test]
    fn refuses_ids_that_would_break_the_cookie() {
        assert_eq!(claims(&jwt(json!({ "sub": "x|a;b=c" }))), None);
        assert_eq!(claims(&jwt(json!({ "sub": "x|" }))), None);
        assert_eq!(claims("not-a-jwt"), None);
    }

    #[test]
    fn reads_the_usage_summary() {
        // Shape of a real answer (Pro plan, included usage used up).
        let summary = json!({
            "billingCycleStart": "2026-11-07T03:22:41.000Z",
            "billingCycleEnd": "2026-12-07T03:22:41.000Z",
            "membershipType": "pro",
            "individualUsage": { "plan": {
                "enabled": true, "used": 2000, "limit": 2000, "remaining": 0,
                "autoPercentUsed": 19.3377, "apiPercentUsed": 54.0888, "totalPercentUsed": 20.9925
            }, "onDemand": { "enabled": false } }
        });
        let limits = limits_of(&summary);
        assert_eq!(
            limits.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(),
            ["total", "auto", "api"]
        );
        assert!((limits[0].used_pct - 20.9925).abs() < 1e-6);
        assert_eq!(limits[0].resets_at, Some(1_796_613_761_000));
    }

    #[test]
    fn reads_token_totals_given_as_strings() {
        let agg = json!({ "totalInputTokens": "2913196", "totalOutputTokens": "401277",
            "totalCacheReadTokens": "52895616", "totalCostCents": 3921.03 });
        let events = json!({ "totalUsageEventsCount": 42 });
        let t = tokens_of(&agg, &events);
        assert_eq!(
            (t.input, t.output, t.cache_read, t.cache_write, t.messages),
            (2_913_196, 401_277, 52_895_616, 0, 42)
        );
        assert_eq!(total(&t), 56_210_089);
    }
}
