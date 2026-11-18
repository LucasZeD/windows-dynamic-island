//! Docker: the containers of the current Docker context and how they're
//! doing, polled through the `docker` CLI while the module is on. Unfolding a
//! container asks for its details (image and build, volumes, networks,
//! Compose project, Kubernetes labels), stats and logs on demand.
//!
//! A container that crashes, runs out of memory or turns unhealthy is an
//! event; the island shows each one once as a toast.

mod cli;
mod kube;
mod model;

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::Manager;

use super::{Provider, now_ms};
use crate::hub::Hub;
use crate::settings::Settings;
use cli::CliError;
use model::{Container, Event};

pub const ID: &str = "docker";
const ENABLED_KEY: &str = "module.docker.enabled";
/// While the daemon answers.
const POLL_RUNNING: Duration = Duration::from_secs(5);
/// Docker Desktop is closed (or starting).
const POLL_DOWN: Duration = Duration::from_secs(15);
/// No `docker` at all: someone may install it.
const POLL_MISSING: Duration = Duration::from_secs(120);
/// The module is off: only watch the setting.
const POLL_OFF: Duration = Duration::from_secs(3);
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const DETAILS_TIMEOUT: Duration = Duration::from_secs(10);
/// `docker stop` waits 10 s for the process before killing it.
const CONTROL_TIMEOUT: Duration = Duration::from_secs(40);
const MAX_EVENTS: usize = 20;
const MAX_HISTORY: usize = 30;
const MAX_LOG_LINES: u32 = 1000;
const MAX_LOG_LINE: usize = 2000;
/// Containers per `docker inspect` call (keeps the command line short).
const INSPECT_CHUNK: usize = 400;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DockerState {
    /// The `docker` CLI is installed.
    pub available: bool,
    /// The daemon answered the last poll.
    pub running: bool,
    /// At least one poll is done (`available` / `running` mean something).
    pub ready: bool,
    pub context: Option<String>,
    pub version: Option<String>,
    pub containers: Vec<Container>,
    /// Newest first.
    pub events: Vec<Event>,
    /// Unix ms of the last poll that answered.
    pub updated_at: u64,
    /// What the CLI said when the daemon didn't answer.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogLine {
    /// RFC 3339 from `--timestamps`, empty when missing.
    at: String,
    /// Written to the container's stderr.
    err: bool,
    text: String,
}

pub struct DockerProvider {
    hub: Mutex<Option<Arc<Hub>>>,
    state: Arc<Mutex<DockerState>>,
    wake: Mutex<Sender<()>>,
    woken: Mutex<Option<Receiver<()>>>,
}

impl Default for DockerProvider {
    fn default() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            hub: Mutex::default(),
            state: Arc::default(),
            wake: Mutex::new(tx),
            woken: Mutex::new(Some(rx)),
        }
    }
}

fn enabled(hub: &Hub) -> bool {
    hub.app()
        .state::<Settings>()
        .get(ENABLED_KEY)
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

fn id_arg(payload: &Value) -> Result<String, String> {
    let id = payload["id"].as_str().unwrap_or_default();
    if cli::valid_name(id) {
        Ok(id.to_string())
    } else {
        Err("docker: invalid container".into())
    }
}

/// One poll: the list and every container's state, or why there is none.
fn poll(state: &Mutex<DockerState>) {
    let before = state.lock().unwrap().clone();
    let mut next = DockerState {
        available: true,
        ready: true,
        context: before.context.clone(),
        version: before.version.clone(),
        events: before.events.clone(),
        ..Default::default()
    };
    match list() {
        Ok(containers) => {
            if !before.running {
                // Just came up (or first poll): which daemon is this?
                next.version = cli::docker(
                    &["version", "--format", "{{.Server.Version}}"],
                    LIST_TIMEOUT,
                )
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
                next.context = cli::docker(&["context", "show"], LIST_TIMEOUT)
                    .ok()
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty());
            }
            let now = now_ms();
            if before.running {
                let mut fresh = model::events(&before.containers, &containers, now);
                fresh.extend(next.events);
                fresh.truncate(MAX_EVENTS);
                next.events = fresh;
            }
            next.running = true;
            next.containers = containers;
            next.updated_at = now;
        }
        Err(CliError::Missing) => next.available = false,
        Err(e) => next.error = Some(e.to_string()),
    }
    *state.lock().unwrap() = next;
}

fn list() -> Result<Vec<Container>, CliError> {
    let ids = cli::docker(&["ps", "-aq"], LIST_TIMEOUT)?;
    let ids: Vec<&str> = ids
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let mut out = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(INSPECT_CHUNK) {
        let mut args = vec!["inspect", "--type", "container"];
        args.extend(chunk);
        // A container removed between the two calls fails the whole inspect: list again next time.
        let text = cli::docker(&args, LIST_TIMEOUT)?;
        let all: Vec<Value> =
            serde_json::from_str(&text).map_err(|e| CliError::Failed(e.to_string()))?;
        out.extend(all.iter().filter_map(model::container));
    }
    out.sort_by(|a, b| (&a.project, &a.name).cmp(&(&b.project, &b.name)));
    Ok(out)
}

fn details(id: &str) -> Result<Value, String> {
    let text = cli::docker(&["inspect", "--type", "container", id], DETAILS_TIMEOUT)
        .map_err(|e| e.to_string())?;
    let all: Vec<Value> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let raw = all.first().ok_or("docker: no such container")?;
    let mut details = model::details(raw).ok_or("docker: unreadable container")?;
    // The image by its id: the tag may point elsewhere since.
    if let Some(image) = raw["Image"].as_str().filter(|s| !s.is_empty()) {
        details.image = cli::docker(&["image", "inspect", image], DETAILS_TIMEOUT)
            .ok()
            .and_then(|t| serde_json::from_str::<Vec<Value>>(&t).ok())
            .and_then(|v| v.first().and_then(model::image));
        if let Some(img) = details.image.as_mut() {
            let format = "{{json .}}";
            if let Ok(text) = cli::docker(
                &["image", "history", "--no-trunc", "--format", format, image],
                DETAILS_TIMEOUT,
            ) {
                img.history = model::history(&text, MAX_HISTORY);
            }
        }
    }
    serde_json::to_value(details).map_err(|e| e.to_string())
}

fn stats(id: &str) -> Result<Value, String> {
    let text = cli::docker(
        &["stats", "--no-stream", "--format", "{{json .}}", id],
        DETAILS_TIMEOUT,
    )
    .map_err(|e| e.to_string())?;
    let v: Value =
        serde_json::from_str(text.lines().next().unwrap_or_default()).map_err(|e| e.to_string())?;
    let field = |k: &str| v[k].as_str().unwrap_or_default().to_string();
    Ok(json!({
        "cpu": field("CPUPerc"),
        "memory": field("MemUsage"),
        "memoryPercent": field("MemPerc"),
        "net": field("NetIO"),
        "block": field("BlockIO"),
        "pids": field("PIDs"),
    }))
}

/// `2026-11-18T01:59:38.674489477Z text` → its time and text.
fn log_line(line: &str, err: bool) -> LogLine {
    let (at, text) = match line.split_once(' ') {
        Some((at, text)) if at.len() >= 20 && at.as_bytes()[4] == b'-' && at.contains('T') => {
            (at, text)
        }
        _ => ("", line),
    };
    LogLine {
        at: at.to_string(),
        err,
        text: text.chars().take(MAX_LOG_LINE).collect(),
    }
}

/// Both streams, in the order they were written.
fn merge_logs(stdout: &str, stderr: &str, tail: usize) -> Vec<LogLine> {
    let mut lines: Vec<LogLine> = stdout
        .lines()
        .map(|l| log_line(l, false))
        .chain(stderr.lines().map(|l| log_line(l, true)))
        .collect();
    // RFC 3339 with nanoseconds sorts as text; stable, so untimed lines keep their order.
    lines.sort_by(|a, b| a.at.cmp(&b.at));
    let skip = lines.len().saturating_sub(tail);
    lines.split_off(skip)
}

fn logs(id: &str, tail: u32) -> Result<Value, String> {
    let n = tail.clamp(1, MAX_LOG_LINES).to_string();
    let (out, err) = cli::docker_both(&["logs", "--tail", &n, "--timestamps", id], DETAILS_TIMEOUT)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(merge_logs(&out, &err, tail as usize)).map_err(|e| e.to_string())
}

impl DockerProvider {
    fn publish(&self) {
        if let Some(hub) = self.hub.lock().unwrap().as_ref() {
            hub.publish(ID, self.state.lock().unwrap().clone());
        }
    }

    fn wake(&self) {
        let _ = self.wake.lock().unwrap().send(());
    }
}

impl Provider for DockerProvider {
    fn id(&self) -> &'static str {
        ID
    }

    fn start(self: Arc<Self>, hub: Arc<Hub>) {
        *self.hub.lock().unwrap() = Some(hub.clone());
        let Some(woken) = self.woken.lock().unwrap().take() else {
            return;
        };
        std::thread::spawn(move || {
            loop {
                let wait = if enabled(&hub) {
                    poll(&self.state);
                    self.publish();
                    let s = self.state.lock().unwrap();
                    match (s.available, s.running) {
                        (false, _) => POLL_MISSING,
                        (true, false) => POLL_DOWN,
                        (true, true) => POLL_RUNNING,
                    }
                } else {
                    let mut s = self.state.lock().unwrap();
                    if s.ready {
                        // Off: forget the list, so turning it back on doesn't toast old news.
                        *s = DockerState::default();
                        drop(s);
                        self.publish();
                    }
                    POLL_OFF
                };
                if let Err(mpsc::RecvTimeoutError::Disconnected) = woken.recv_timeout(wait) {
                    return;
                }
                // Several wakes at once are one poll.
                while woken.try_recv().is_ok() {}
            }
        });
    }

    fn action(&self, action: &str, payload: Value) -> Result<Value, String> {
        match action {
            "poll" => self.wake(),
            "details" => return details(&id_arg(&payload)?),
            "stats" => return stats(&id_arg(&payload)?),
            "logs" => {
                let tail = payload["tail"]
                    .as_u64()
                    .unwrap_or(200)
                    .min(MAX_LOG_LINES as u64) as u32;
                return logs(&id_arg(&payload)?, tail);
            }
            "start" | "stop" | "restart" | "pause" | "unpause" => {
                let id = id_arg(&payload)?;
                let result = cli::docker(&[action, &id], CONTROL_TIMEOUT);
                self.wake();
                result.map_err(|e| e.to_string())?;
            }
            "open" => {
                let port = payload["port"]
                    .as_u64()
                    .and_then(|p| u16::try_from(p).ok())
                    .ok_or("docker: invalid port")?;
                crate::settings::open_url(&format!("http://localhost:{port}"));
            }
            "pods" => return serde_json::to_value(kube::pods()).map_err(|e| e.to_string()),
            "podLogs" => {
                let tail = payload["tail"]
                    .as_u64()
                    .unwrap_or(200)
                    .min(MAX_LOG_LINES as u64) as u32;
                let text = kube::logs(
                    payload["namespace"].as_str().unwrap_or_default(),
                    payload["pod"].as_str().unwrap_or_default(),
                    payload["container"].as_str(),
                    tail,
                )?;
                return serde_json::to_value(merge_logs(&text, "", tail as usize))
                    .map_err(|e| e.to_string());
            }
            _ => return Err(format!("docker: unknown action '{action}'")),
        }
        Ok(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_from_both_streams_come_in_order() {
        let out = "2026-11-18T01:59:38.674489477Z starting\n2026-11-18T01:59:42.000000000Z done";
        let err = "2026-11-18T01:59:40.675149103Z boom";
        let lines = merge_logs(out, err, 10);
        let texts: Vec<_> = lines.iter().map(|l| l.text.as_str()).collect();
        assert_eq!(texts, ["starting", "boom", "done"]);
        assert!(lines[1].err);
        // Only the last ones.
        assert_eq!(merge_logs(out, err, 1)[0].text, "done");
    }

    #[test]
    fn lines_without_a_time_are_kept_whole() {
        let l = log_line("plain text here", false);
        assert_eq!(l.at, "");
        assert_eq!(l.text, "plain text here");
    }

    /// Against the local Docker: `cargo test --lib docker::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live() {
        let state = Mutex::new(DockerState::default());
        poll(&state);
        let s = state.lock().unwrap();
        println!("{}", serde_json::to_string_pretty(&*s).unwrap());
        if let Some(c) = s.containers.first() {
            println!(
                "{}",
                serde_json::to_string_pretty(&details(&c.id).unwrap()).unwrap()
            );
            println!(
                "{}",
                serde_json::to_string_pretty(&logs(&c.id, 5).unwrap()).unwrap()
            );
        }
        println!("{}", serde_json::to_string_pretty(&kube::pods()).unwrap());
    }
}
