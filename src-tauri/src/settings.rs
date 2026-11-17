//! User settings: a flat JSON key/value store persisted in the app config dir.
//!
//! The backend doesn't know the schema — defaults and meaning live in the
//! frontend (each module declares its own settings). Every change is broadcast
//! as `settings://changed` so all windows stay in sync.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const CHANGED_EVENT: &str = "settings://changed";
pub const SETTINGS_LABEL: &str = "settings";

pub struct Settings {
    path: PathBuf,
    data: Mutex<Map<String, Value>>,
}

impl Settings {
    pub fn load(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("settings.json");
        let data = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok())
            .unwrap_or_default();
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    /// Current raw value of a setting (`None` = never set, use the default).
    pub fn get(&self, key: &str) -> Option<Value> {
        self.data.lock().unwrap().get(key).cloned()
    }

    pub fn snapshot(&self) -> Map<String, Value> {
        self.data.lock().unwrap().clone()
    }

    fn save(&self, data: &Map<String, Value>) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(data) {
            let _ = std::fs::write(&self.path, text);
        }
    }
}

#[tauri::command]
pub fn get_settings(settings: State<Settings>) -> Map<String, Value> {
    settings.data.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_setting(app: AppHandle, key: String, value: Value) {
    set(&app, &key, value);
}

/// Store and broadcast a setting (backend side of `setSetting`).
pub fn set(app: &AppHandle, key: &str, value: Value) {
    let settings = app.state::<Settings>();
    let snapshot = {
        let mut data = settings.data.lock().unwrap();
        data.insert(key.to_string(), value);
        settings.save(&data);
        data.clone()
    };
    let _ = app.emit(CHANGED_EVENT, snapshot);
    if key == crate::tray::HIDDEN_KEY {
        crate::tray::sync_hidden(app);
        crate::memory::sync_island(app);
    }
}

#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    open(&app).map_err(|e| e.to_string())
}

const SIZE: (f64, f64) = (860.0, 620.0);
/// Smallest the settings window can be resized to (logical px).
const MIN_SIZE: (f64, f64) = (760.0, 520.0);
/// The settings window's last size, `[width, height]` in logical px.
const SIZE_KEY: &str = "settingsWindow.size";
/// Resizing sends a burst of events: the size is saved once it settles.
const SIZE_SAVE_DELAY: std::time::Duration = std::time::Duration::from_millis(600);

pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        win.unminimize()?;
        win.show()?;
        return win.set_focus();
    }
    // Callers are sync commands / tray / single-instance handlers on the main
    // thread, where building a webview deadlocks on Windows (WebView2 needs the
    // event loop). Build from another thread instead.
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = create(&app) {
            eprintln!("settings window: {e}");
        }
    });
    Ok(())
}

fn create(app: &AppHandle) -> tauri::Result<()> {
    let (width, height) = stored_size(app.state::<Settings>().get(SIZE_KEY));
    let win = WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("index.html".into()))
        .title(crate::i18n::t(app, "window.settings"))
        .inner_size(width, height)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .resizable(true)
        .center()
        // Custom titlebar lives in the webview (see `SettingsApp.tsx`).
        .decorations(false)
        // See-through, so the island's glass materials can show (`set_settings_look`);
        // the page paints its own background otherwise.
        .transparent(true)
        .background_color(tauri::webview::Color(12, 12, 16, 255))
        .additional_browser_args(crate::memory::BROWSER_ARGS)
        .build()?;
    crate::memory::trim_when_minimized(&win);
    remember_size(&win);
    Ok(())
}

/// The saved size, or the default; never below the minimum.
fn stored_size(value: Option<Value>) -> (f64, f64) {
    let pair = value
        .and_then(|v| serde_json::from_value::<[f64; 2]>(v).ok())
        .filter(|[w, h]| w.is_finite() && h.is_finite());
    let [w, h] = pair.unwrap_or([SIZE.0, SIZE.1]);
    (w.max(MIN_SIZE.0), h.max(MIN_SIZE.1))
}

/// Saves the window's size once a resize settles (not while minimized or maximized).
fn remember_size(win: &tauri::WebviewWindow) {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    let generation = Arc::new(AtomicU64::new(0));
    let window = win.clone();
    win.on_window_event(move |event| {
        let tauri::WindowEvent::Resized(size) = event else {
            return;
        };
        if size.width == 0 || size.height == 0 {
            return;
        }
        let this = generation.fetch_add(1, Ordering::Relaxed) + 1;
        let generation = generation.clone();
        let window = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(SIZE_SAVE_DELAY);
            if generation.load(Ordering::Relaxed) != this
                || window.is_maximized().unwrap_or(false)
                || window.is_minimized().unwrap_or(false)
            {
                return;
            }
            let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
                return;
            };
            let logical = size.to_logical::<f64>(scale);
            let value = serde_json::json!([logical.width.round(), logical.height.round()]);
            set(window.app_handle(), SIZE_KEY, value);
        });
    });
}

/// The settings window takes on the island's look: its theme (title bar,
/// system backdrop) and material. Solid is the page's own background; the
/// glass materials put a system backdrop behind the (translucent) page:
/// Mica for frosted glass, Acrylic (clearer, the desktop shows) for Liquid Glass.
#[tauri::command]
pub fn set_settings_look(window: tauri::WebviewWindow, material: String, theme: String) {
    use tauri::window::{Effect, EffectsBuilder};
    if window.label() != SETTINGS_LABEL {
        return;
    }
    let light = theme == "light";
    let _ = window.set_theme(Some(if light {
        tauri::Theme::Light
    } else {
        tauri::Theme::Dark
    }));
    let effect = match material.as_str() {
        "frosted" => Some(if light { Effect::MicaLight } else { Effect::MicaDark }),
        "liquid" => Some(Effect::Acrylic),
        _ => None,
    };
    let _ = window.set_effects(effect.map(|e| EffectsBuilder::new().effect(e).build()));
}

const REPO_URL: &str = "https://github.com/HeyyCzer/windows-island";

/// Open the GitHub repo in the default browser (About page).
#[tauri::command]
pub fn open_repo() {
    open_url(REPO_URL);
}

/// Open a web page in the default browser (island links, e.g. usage pages).
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https links".into());
    }
    open_url(&url);
    Ok(())
}

/// Open a URL in the default browser.
pub fn open_url(url: &str) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        use windows::core::{HSTRING, PCWSTR, w};
        ShellExecuteW(
            None,
            w!("open"),
            &HSTRING::from(url),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    crate::autostart::is_enabled(&app)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    crate::autostart::set(&app, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_window_size_falls_back_and_never_goes_below_the_minimum() {
        assert_eq!(stored_size(None), SIZE);
        assert_eq!(stored_size(Some(serde_json::json!([1200, 900]))), (1200.0, 900.0));
        assert_eq!(stored_size(Some(serde_json::json!([100, 100]))), MIN_SIZE);
        assert_eq!(stored_size(Some(serde_json::json!("junk"))), SIZE);
    }
}
