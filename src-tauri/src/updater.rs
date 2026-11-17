//! Updates from GitHub releases, only when asked.
//!
//! The release workflow publishes a signed `latest.json` next to the
//! installers (endpoint and public key in `tauri.conf.json`). Upstream checks
//! it on startup and installs silently. This build never does: a release
//! would replace it with one without the local changes. Updates come in by
//! merging upstream (see the workspace CLAUDE.md); the About page can still
//! check and install by hand.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// A downloaded update waiting for the user: the update and its installer.
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Vec<u8>)>>);

pub fn spawn(app: AppHandle) {
    if cfg!(debug_assertions) {
        return; // dev builds would "update" into the released app
    }
    if crate::portable::is_portable() {
        return; // the installer would land elsewhere; portable users re-download
    }
    if crate::store::IS_STORE {
        return; // the Microsoft Store updates it
    }
    // Only the manual check on the About page uses it: nothing runs in the background.
    app.manage(Pending::default());
}

/// Look for a newer release and download it. Returns the version waiting to
/// be installed, if any.
async fn check(app: &AppHandle) -> tauri_plugin_updater::Result<Option<String>> {
    if let Some((update, _)) = &*app.state::<Pending>().0.lock().unwrap() {
        return Ok(Some(update.version.clone())); // already waiting on the user
    }
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    let bytes = update.download(|_, _| {}, || {}).await?;
    let version = update.version.clone();
    *app.state::<Pending>().0.lock().unwrap() = Some((update, bytes));
    crate::tray::show_update(app, &version);
    Ok(Some(version))
}

/// Manual check from the About page. Errors with `"portable"` on portable
/// builds, `"store"` on the Microsoft Store edition and `"dev"` on dev builds,
/// which never self-update.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    if crate::portable::is_portable() {
        return Err("portable".into());
    }
    if crate::store::IS_STORE {
        return Err("store".into());
    }
    if app.try_state::<Pending>().is_none() {
        return Err("dev".into());
    }
    check(&app).await.map_err(|e| {
        log::warn!("update check failed: {e}");
        e.to_string()
    })
}

/// Install the pending update from the About page.
#[tauri::command]
pub fn install_update(app: AppHandle) {
    install(&app);
}

/// Install the downloaded update. On Windows the installer takes over and the
/// app exits; the installer starts it again when done.
pub fn install(app: &AppHandle) {
    let Some(pending) = app.try_state::<Pending>() else {
        return;
    };
    let Some((update, bytes)) = pending.0.lock().unwrap().take() else {
        return;
    };
    if let Err(e) = update.install(bytes) {
        log::error!("update install failed: {e}");
        return;
    }
    app.restart();
}
