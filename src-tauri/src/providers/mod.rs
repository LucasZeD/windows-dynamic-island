//! Data providers feeding the island.
//!
//! A provider owns one source of information (media session, Claude Code, …),
//! publishes its state through the [`Hub`] under its `id`, and optionally
//! handles actions coming from the UI (play/pause, etc).
//!
//! To add a new provider:
//!   1. create `providers/<name>.rs` implementing [`Provider`];
//!   2. add it to [`registry`];
//!   3. add a matching frontend module in `src/modules/<name>/`.

pub mod activities;
pub mod antigravity;
pub mod ask;
pub mod calendar;
pub mod claude;
pub mod clipboard;
pub mod codex;
pub mod credentials;
pub mod cursor;
pub mod find;
pub mod github;
pub mod monitor;
pub mod music;
pub mod notifications;
pub mod process;
pub mod shelf;
pub mod shortcuts;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::State;

use crate::hub::Hub;

pub trait Provider: Send + Sync + 'static {
    /// Unique id; the frontend reads this provider's state with `useProvider(id)`.
    fn id(&self) -> &'static str;

    /// Spawn whatever background work the provider needs. Must not block.
    fn start(self: Arc<Self>, hub: Arc<Hub>);

    /// Handle an action sent from the UI via `provider_action`.
    fn action(&self, action: &str, _payload: Value) -> Result<Value, String> {
        Err(format!("{}: unsupported action '{action}'", self.id()))
    }
}

pub fn registry() -> Vec<Arc<dyn Provider>> {
    vec![
        // First: the others push alerts into it.
        Arc::new(activities::ActivitiesProvider),
        Arc::new(music::MusicProvider::default()),
        Arc::new(notifications::NotificationsProvider::default()),
        Arc::new(ask::AskProvider::default()),
        Arc::new(find::FindProvider::default()),
        Arc::new(shelf::ShelfProvider::default()),
        Arc::new(clipboard::ClipboardProvider::default()),
        Arc::new(claude::ClaudeProvider::default()),
        Arc::new(codex::CodexProvider),
        Arc::new(antigravity::AntigravityProvider::default()),
        Arc::new(cursor::CursorProvider::default()),
        Arc::new(github::GithubProvider::default()),
        Arc::new(monitor::MonitorProvider::default()),
        Arc::new(calendar::CalendarProvider::default()),
        Arc::new(shortcuts::ShortcutsProvider::default()),
    ]
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Whether a request to one of the local HTTP servers comes from a local
/// program (curl, a script, Claude Code's hooks) rather than a web page.
///
/// Listening on 127.0.0.1 doesn't keep browsers out: any page can POST to
/// localhost. Browsers always send `Origin` on those requests, and local
/// tools don't, so any `Origin` is refused. The `Host` check stops DNS
/// rebinding (a site whose name resolves to 127.0.0.1).
pub fn from_local_client(headers: &[tiny_http::Header]) -> bool {
    let header = |name: &'static str| {
        headers
            .iter()
            .find(|h| h.field.equiv(name))
            .map(|h| h.value.as_str().to_ascii_lowercase())
    };
    if header("Origin").is_some() {
        return false;
    }
    let Some(host) = header("Host") else {
        return true; // HTTP/1.0 tools may leave it out.
    };
    let name = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or_default(),
        None => host.split(':').next().unwrap_or_default(),
    };
    matches!(name, "127.0.0.1" | "localhost" | "::1")
}

pub struct Providers(pub Vec<Arc<dyn Provider>>);

#[tauri::command]
pub fn get_snapshot(hub: State<Arc<Hub>>) -> std::collections::HashMap<String, Value> {
    hub.snapshot()
}

#[tauri::command]
pub async fn provider_action(
    providers: State<'_, Providers>,
    id: String,
    action: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    let provider = providers
        .0
        .iter()
        .find(|p| p.id() == id)
        .cloned()
        .ok_or_else(|| format!("unknown provider '{id}'"))?;
    let payload = payload.unwrap_or(Value::Null);
    tauri::async_runtime::spawn_blocking(move || provider.action(&action, payload))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::from_local_client;
    use tiny_http::Header;

    fn headers(list: &[(&str, &str)]) -> Vec<Header> {
        list.iter()
            .map(|(k, v)| Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap())
            .collect()
    }

    #[test]
    fn local_tools_get_through() {
        assert!(from_local_client(&headers(&[("Host", "127.0.0.1:5199")])));
        assert!(from_local_client(&headers(&[("Host", "localhost:5199")])));
        assert!(from_local_client(&headers(&[("Host", "[::1]:5199")])));
        // The statusline bridge sends no port.
        assert!(from_local_client(&headers(&[("Host", "127.0.0.1")])));
        assert!(from_local_client(&[]));
    }

    #[test]
    fn web_pages_are_refused() {
        // A cross-site POST (text/plain, no preflight) from any page.
        assert!(!from_local_client(&headers(&[
            ("Host", "127.0.0.1:5199"),
            ("Origin", "https://evil.example"),
        ])));
        // Sandboxed frames and file:// pages send "null".
        assert!(!from_local_client(&headers(&[
            ("Host", "127.0.0.1:5199"),
            ("Origin", "null"),
        ])));
        // DNS rebinding: the name resolves to 127.0.0.1, the Host header doesn't lie.
        assert!(!from_local_client(&headers(&[("Host", "rebind.evil.example:5199")])));
    }
}
