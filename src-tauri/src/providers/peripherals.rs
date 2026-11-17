//! Peripherals: battery levels of wireless mice, keyboards, headsets and
//! controllers, read by Halo Battery's providers (70+ vendor protocols).
//!
//! The helper (`sidecars/peripherals/`, Halo Battery's code run headless) is
//! bundled under `resources/peripherals/` and started while the module is on.
//! It prints one JSON object per line, the shape of Halo Battery's
//! `status.json`, and takes `poll` on stdin. Its stdin is ours: when the island
//! exits for any reason the pipe closes and the helper quits with it.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

use super::Provider;
use super::activities::{self, Activity, GREEN, ORANGE, RED};
use crate::hub::Hub;
use crate::settings::Settings;

pub const ID: &str = "peripherals";
const ENABLED_KEY: &str = "module.peripherals.enabled";
const ALERTS_KEY: &str = "peripherals.alerts";
const HELPER_DIR: &str = "peripherals";
const HELPER_EXE: &str = "halo-bridge.exe";
/// Overrides where the helper is (development builds, or a custom build).
const HELPER_ENV: &str = "DYNAMIC_ISLAND_PERIPHERALS_HELPER";
const SUPERVISE_EVERY: Duration = Duration::from_secs(2);
/// After a crash, wait before starting it again: 5 s, 10 s, … up to 5 min.
const RESTART_MIN: Duration = Duration::from_secs(5);
const RESTART_MAX: Duration = Duration::from_secs(300);
/// A line longer than this is not one of ours.
const MAX_LINE: usize = 1024 * 1024;

/// One device, as Halo Battery's `status.json` describes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Device {
    pub key: String,
    pub name: String,
    /// 0..100, `None` while unknown.
    pub level: Option<u8>,
    pub charging: bool,
    #[serde(alias = "charging_known")]
    pub charging_known: bool,
    /// `false`: the receiver is there but the device sleeps or is off.
    pub online: bool,
    /// mouse / keyboard / headset / gamepad / …
    pub kind: String,
    /// Coarse level text when the device only reports steps ("about 55% (medium)").
    pub approx: Option<String>,
    #[serde(alias = "low_alert_at")]
    pub low_alert_at: Option<u8>,
    #[serde(alias = "seconds_left")]
    pub seconds_left: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PeripheralsState {
    /// The helper is installed with this build.
    pub available: bool,
    /// The helper is running and has reported at least once.
    pub ready: bool,
    pub devices: Vec<Device>,
    /// Unix ms of the last report.
    pub updated_at: u64,
    /// Why the helper isn't running, when it should be.
    pub error: Option<String>,
}

/// What the helper prints (only the fields we use).
#[derive(Deserialize)]
struct Report {
    #[serde(default)]
    devices: Vec<Device>,
    #[serde(default)]
    updated_unix: u64,
}

#[derive(Default)]
pub struct PeripheralsProvider {
    ctx: Mutex<Option<Arc<Ctx>>>,
}

struct Ctx {
    hub: Arc<Hub>,
    state: Mutex<PeripheralsState>,
    child: Mutex<Option<(Child, ChildStdin)>>,
    /// Last level per device, for the low battery / fully charged alerts.
    last: Mutex<std::collections::HashMap<String, (u8, bool)>>,
}

impl Ctx {
    fn setting(&self, key: &str, default: bool) -> bool {
        self.hub
            .app()
            .state::<Settings>()
            .get(key)
            .and_then(|v| v.as_bool())
            .unwrap_or(default)
    }

    fn publish(&self) {
        let state = self.state.lock().unwrap().clone();
        self.hub.publish(ID, state);
    }

    fn set_error(&self, error: Option<String>) {
        let mut state = self.state.lock().unwrap();
        state.error = error;
        if state.error.is_some() {
            state.ready = false;
        }
        drop(state);
        self.publish();
    }

    fn helper(&self) -> Option<PathBuf> {
        if let Some(path) = std::env::var_os(HELPER_ENV).map(PathBuf::from) {
            return path.is_file().then_some(path);
        }
        let bundled = self
            .hub
            .app()
            .path()
            .resource_dir()
            .ok()
            .map(|d| d.join(HELPER_DIR).join(HELPER_EXE));
        // `tauri dev`: the helper built by `sidecars/peripherals/build.ps1`.
        let dev = cfg!(debug_assertions).then(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../sidecars/peripherals/dist/halo-bridge")
                .join(HELPER_EXE)
        });
        bundled.into_iter().chain(dev).find(|p| p.is_file())
    }

    /// Settings, log and battery history of the helper: our own data folder,
    /// never a real Halo Battery install's.
    fn data_dir(&self) -> Option<PathBuf> {
        let dir = self.hub.app().path().app_data_dir().ok()?.join(HELPER_DIR);
        std::fs::create_dir_all(&dir).ok()?;
        Some(dir)
    }

    fn running(&self) -> bool {
        let mut child = self.child.lock().unwrap();
        match child.as_mut().map(|(c, _)| c.try_wait()) {
            Some(Ok(None)) => true,
            Some(_) => {
                *child = None;
                false
            }
            None => false,
        }
    }

    fn stop(&self) {
        if let Some((mut child, _stdin)) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let mut state = self.state.lock().unwrap();
        state.ready = false;
        state.devices.clear();
        drop(state);
        self.publish();
    }

    fn send(&self, command: &str) {
        if let Some((_, stdin)) = self.child.lock().unwrap().as_mut() {
            let _ = writeln!(stdin, "{command}");
            let _ = stdin.flush();
        }
    }

    fn start(self: &Arc<Self>, exe: &PathBuf) -> Result<(), String> {
        let mut cmd = Command::new(exe);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(dir) = self.data_dir() {
            cmd.env("APPDATA", dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        *self.child.lock().unwrap() = Some((child, stdin));

        let ctx = self.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(n) if n > MAX_LINE => continue,
                    Ok(_) => {}
                }
                match serde_json::from_str::<Report>(line.trim()) {
                    Ok(report) => ctx.apply(report),
                    Err(e) => log::warn!("peripherals: bad line from helper: {e}"),
                }
            }
        });
        Ok(())
    }

    fn apply(&self, report: Report) {
        if self.setting(ALERTS_KEY, true) {
            self.alerts(&report.devices);
        }
        let mut state = self.state.lock().unwrap();
        state.ready = true;
        state.error = None;
        state.devices = report.devices;
        state.updated_at = report.updated_unix * 1000;
        drop(state);
        self.publish();
    }

    fn alerts(&self, devices: &[Device]) {
        let mut last = self.last.lock().unwrap();
        for d in devices {
            let Some(level) = d.level.filter(|_| d.online) else {
                continue;
            };
            let before = last.insert(d.key.clone(), (level, d.charging));
            let Some((before_level, before_charging)) = before else {
                continue; // first reading: nothing crossed yet
            };
            match alert_for(d, level, before_level, before_charging) {
                Some(Alert::Low) => alert_low(self.hub.app(), d, level, low_of(d)),
                Some(Alert::Full) => alert_full(self.hub.app(), d),
                None => {}
            }
        }
    }
}

#[derive(Debug, PartialEq)]
enum Alert {
    Low,
    Full,
}

/// Halo Battery's default when a device has no level of its own.
fn low_of(d: &Device) -> u8 {
    d.low_alert_at.unwrap_or(20)
}

/// Whether going from `before_level` to `level` deserves an alert: falling to
/// the device's low level on battery, or reaching 100% on the charger. Only
/// on the crossing, so one poll after another never repeats it.
fn alert_for(d: &Device, level: u8, before_level: u8, before_charging: bool) -> Option<Alert> {
    let low = low_of(d);
    if !d.charging && d.charging_known && before_level > low && level <= low {
        Some(Alert::Low)
    } else if d.charging && level >= 100 && (before_level < 100 || !before_charging) {
        Some(Alert::Full)
    } else {
        None
    }
}

fn supervise(ctx: Arc<Ctx>) {
    let mut backoff = RESTART_MIN;
    let mut next_start = Instant::now();
    let mut started_at: Option<Instant> = None;
    loop {
        let enabled = ctx.setting(ENABLED_KEY, true);
        let running = ctx.running();
        if !enabled {
            if running || ctx.state.lock().unwrap().ready {
                ctx.stop();
            }
            started_at = None;
        } else if !running && Instant::now() >= next_start {
            if let Some(at) = started_at.take() {
                // It ran and stopped by itself: crashed, or the device stack hung.
                if at.elapsed() > RESTART_MAX {
                    backoff = RESTART_MIN;
                }
                log::warn!("peripherals: helper exited, restarting in {backoff:?}");
                next_start = Instant::now() + backoff;
                backoff = (backoff * 2).min(RESTART_MAX);
                ctx.set_error(Some("restarting".into()));
            } else {
                match ctx.helper() {
                    None => ctx.set_error(Some("missing".into())),
                    Some(exe) => match ctx.start(&exe) {
                        Ok(()) => started_at = Some(Instant::now()),
                        Err(e) => {
                            log::error!("peripherals: can't start {}: {e}", exe.display());
                            ctx.set_error(Some(e));
                            next_start = Instant::now() + backoff;
                            backoff = (backoff * 2).min(RESTART_MAX);
                        }
                    },
                }
            }
        }
        std::thread::sleep(SUPERVISE_EVERY);
    }
}

fn kind_icon(kind: &str) -> &'static str {
    match kind {
        "headset" | "headphones" => "headphones",
        _ => "battery",
    }
}

fn alert_low(app: &tauri::AppHandle, d: &Device, level: u8, low: u8) {
    let Some(activities) = activities::handle() else {
        return;
    };
    let mut alert = Activity::alert(format!("peripherals.{}", d.key), ID, Duration::from_secs(8));
    alert.title = crate::i18n::t(app, "peripherals.low").replace("{name}", &d.name);
    alert.subtitle =
        Some(crate::i18n::t(app, "peripherals.lowDetail").replace("{n}", &level.to_string()));
    alert.icon = Some(kind_icon(&d.kind).into());
    alert.color = Some(if level <= low / 2 { RED } else { ORANGE }.into());
    alert.progress = Some(level as f64 / 100.0);
    alert.priority = 78;
    alert.expand = true;
    activities.upsert(alert);
}

fn alert_full(app: &tauri::AppHandle, d: &Device) {
    let Some(activities) = activities::handle() else {
        return;
    };
    let mut alert = Activity::alert(format!("peripherals.{}", d.key), ID, Duration::from_secs(5));
    alert.title = crate::i18n::t(app, "peripherals.full").replace("{name}", &d.name);
    alert.icon = Some("charging".into());
    alert.color = Some(GREEN.into());
    alert.progress = Some(1.0);
    alert.priority = 60;
    activities.upsert(alert);
}

impl Provider for PeripheralsProvider {
    fn id(&self) -> &'static str {
        ID
    }

    fn start(self: Arc<Self>, hub: Arc<Hub>) {
        let ctx = Arc::new(Ctx {
            hub,
            state: Mutex::new(PeripheralsState::default()),
            child: Mutex::new(None),
            last: Mutex::new(Default::default()),
        });
        ctx.state.lock().unwrap().available = ctx.helper().is_some();
        ctx.publish();
        *self.ctx.lock().unwrap() = Some(ctx.clone());
        std::thread::spawn(move || supervise(ctx));
    }

    fn action(&self, action: &str, _payload: Value) -> Result<Value, String> {
        let ctx = self
            .ctx
            .lock()
            .unwrap()
            .clone()
            .ok_or("peripherals: not started")?;
        match action {
            // The panel opened: read the devices now instead of at the next poll.
            "poll" => {
                ctx.send("poll");
                Ok(Value::Null)
            }
            _ => Err(format!("peripherals: unknown action '{action}'")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_halo_battery_status_lines() {
        let line = r#"{"app": "Halo Battery", "version": "1.17.0", "running": true,
            "updated": "2026-11-17T11:38:35", "updated_unix": 1795000000,
            "devices": [{"key": "logi:1", "name": "M720 Triathlon Multi-Device Mouse",
            "level": 50, "charging": false, "charging_known": true, "online": true,
            "kind": "mouse", "approx": null, "low_alert_at": 20, "seconds_left": null,
            "text": "M720 Triathlon Multi-Device Mouse: 50%"}]}"#;
        let report: Report = serde_json::from_str(line).unwrap();
        assert_eq!(report.updated_unix, 1_795_000_000);
        let d = &report.devices[0];
        assert_eq!(d.level, Some(50));
        assert!(d.online && d.charging_known && !d.charging);
        assert_eq!(d.kind, "mouse");
        assert_eq!(d.low_alert_at, Some(20));
        // What the frontend gets: camelCase.
        let out = serde_json::to_value(d).unwrap();
        assert_eq!(out["lowAlertAt"], 20);
        assert_eq!(out["chargingKnown"], true);
    }

    fn mouse(charging: bool) -> Device {
        Device {
            key: "m".into(),
            name: "Mouse".into(),
            charging,
            charging_known: true,
            online: true,
            low_alert_at: Some(20),
            ..Default::default()
        }
    }

    #[test]
    fn alerts_only_on_the_crossing() {
        let on_battery = mouse(false);
        assert_eq!(alert_for(&on_battery, 20, 21, false), Some(Alert::Low));
        assert_eq!(
            alert_for(&on_battery, 19, 20, false),
            None,
            "already below: no repeat"
        );
        assert_eq!(alert_for(&on_battery, 50, 51, false), None);
        let charging = mouse(true);
        assert_eq!(
            alert_for(&charging, 15, 21, false),
            None,
            "on the charger: no low alert"
        );
        assert_eq!(alert_for(&charging, 100, 99, true), Some(Alert::Full));
        assert_eq!(
            alert_for(&charging, 100, 100, true),
            None,
            "still full: no repeat"
        );
        // Level known, charger state not: Halo Battery suppresses alerts.
        let unsure = Device {
            charging_known: false,
            ..mouse(false)
        };
        assert_eq!(alert_for(&unsure, 10, 30, false), None);
    }

    #[test]
    fn unknown_levels_and_missing_fields_are_fine() {
        let report: Report =
            serde_json::from_str(r#"{"devices": [{"key": "x", "name": "Pad", "level": null}]}"#)
                .unwrap();
        assert_eq!(report.devices[0].level, None);
        assert!(!report.devices[0].online);
    }
}
