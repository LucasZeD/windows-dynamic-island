//! Chat: ChatGPT or Gemini inside the island, signed in with the user's own
//! account (so it's the chat plan, not API or Codex tokens).
//!
//! Each site is its own borderless window, owned by the island and laid over
//! the chat module's panel (the frontend sends its rect), kept alive when
//! hidden so a conversation is still there next time. (A child webview of the
//! island itself would stop Tauri from treating the island as a webview window,
//! which the whole app relies on.) They are transparent, with a
//! stylesheet that clears the sites' backgrounds so the island's glass shows
//! through.
//!
//! Isolation: the sites get no IPC (Tauri only grants it to the app's own
//! pages), keep their cookies in their own profile (`<app data>/chat`), and
//! links they open in new windows go to the default browser.
//!
//! Showing a page doesn't take the keyboard (hovering mustn't pull focus out
//! of a game); clicking it does. While it's on screen, a click anywhere outside
//! the island is swallowed (low-level mouse hook) and closes it: the click
//! doesn't reach the app below.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::Value;
use tauri::Emitter;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use super::Provider;
use crate::hub::Hub;
use crate::window::{self, ISLAND_LABEL};

pub const ID: &str = "chat";
/// The hook caught a click outside: the frontend collapses the island.
pub const DISMISS_EVENT: &str = "chat://dismiss";
/// A site's page finished loading (payload: the site), so it covers its panel.
pub const LOADED_EVENT: &str = "chat://loaded";
/// Per site (`Site::index`): its page has loaded at least once.
static LOADED: [AtomicBool; 2] = [AtomicBool::new(false), AtomicBool::new(false)];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Site {
    ChatGpt,
    Gemini,
}

impl Site {
    const ALL: [Site; 2] = [Site::ChatGpt, Site::Gemini];

    fn parse(s: &str) -> Option<Site> {
        match s {
            "chatgpt" => Some(Site::ChatGpt),
            "gemini" => Some(Site::Gemini),
            _ => None,
        }
    }

    fn index(self) -> usize {
        self as usize
    }

    fn id(self) -> &'static str {
        match self {
            Site::ChatGpt => "chatgpt",
            Site::Gemini => "gemini",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Site::ChatGpt => "chat-chatgpt",
            Site::Gemini => "chat-gemini",
        }
    }

    fn home(self) -> &'static str {
        match self {
            Site::ChatGpt => "https://chatgpt.com/",
            Site::Gemini => "https://gemini.google.com/app",
        }
    }
}

/// Sign-in pages some sites open as popups; they need `window.opener`.
fn is_sign_in(url: &tauri::Url) -> bool {
    matches!(
        url.host_str(),
        Some(
            "accounts.google.com"
                | "auth.openai.com"
                | "auth0.openai.com"
                | "appleid.apple.com"
                | "login.live.com"
                | "login.microsoftonline.com"
        )
    )
}

/// Clears the sites' page backgrounds (the island's glass shows through) and
/// rounds the bottom corners like the island's. Cosmetic only: if a site
/// renames its variables, it just looks opaque.
const GLASS_SCRIPT: &str = r#"
(() => {
  if (window.top !== window) return;
  const css = `
    :root, html.dark, html.light, html[data-theme] {
      --main-surface-primary: transparent !important;
      --main-surface-background: transparent !important;
      --sidebar-surface-primary: rgba(20, 20, 22, 0.55) !important;
      --bg-primary: transparent !important;
      --gem-sys-color--surface: transparent !important;
      --gem-sys-color--surface-container: rgba(255, 255, 255, 0.06) !important;
      --bard-color-synthetic--chat-window-surface: transparent !important;
    }
    html, body, #__next, main, chat-app, chat-window, mat-sidenav-content, bard-sidenav-content {
      background: transparent !important;
      background-color: transparent !important;
    }
  `;
  const add = () => {
    if (document.getElementById("island-glass")) return;
    const style = document.createElement("style");
    style.id = "island-glass";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.documentElement) add();
  document.addEventListener("DOMContentLoaded", add);
})();
"#;

#[derive(Deserialize)]
struct Show {
    site: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    /// The island's theme ("light" / "dark"): the site follows it.
    #[serde(default)]
    theme: Option<String>,
}

#[derive(Default)]
pub struct ChatProvider {
    app: Mutex<Option<AppHandle>>,
    shown: Mutex<Option<Site>>,
    /// One show / hide at a time: creating a page takes a while, and a second
    /// `show` meanwhile (the panel still moving) would try to create it again.
    busy: Mutex<()>,
}

impl ChatProvider {
    fn app(&self) -> Result<AppHandle, String> {
        self.app
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "chat: not started".into())
    }

    fn show(&self, req: Show) -> Result<Site, String> {
        let site = Site::parse(&req.site).ok_or("chat: unknown site")?;
        if !(req.width > 0.0 && req.height > 0.0) {
            return Err("chat: empty rect".into());
        }
        let _busy = self.busy.lock().unwrap();
        let app = self.app()?;
        let island = app
            .get_webview_window(ISLAND_LABEL)
            .ok_or("no island window")?;
        // Opened by its shortcut (the island took the keyboard): the page gets it.
        let take_keyboard = native::is_foreground(&island);
        // The panel's rect is in CSS px from the island window's corner.
        let origin = island.outer_position().map_err(|e| e.to_string())?;
        let scale = island.scale_factor().map_err(|e| e.to_string())?;
        let position = PhysicalPosition::new(
            origin.x + (req.x * scale).round() as i32,
            origin.y + (req.y * scale).round() as i32,
        );
        let size = PhysicalSize::new(
            (req.width * scale).round() as u32,
            (req.height * scale).round() as u32,
        );

        for other in Site::ALL.into_iter().filter(|s| *s != site) {
            if let Some(page) = app.get_webview_window(other.label()) {
                native::hide(&page);
            }
        }
        let page = match app.get_webview_window(site.label()) {
            Some(page) => page,
            None => create(&app, &island, site)?,
        };
        page.set_position(position).map_err(|e| e.to_string())?;
        page.set_size(size).map_err(|e| e.to_string())?;
        let theme = match req.theme.as_deref() {
            Some("light") => Some(tauri::Theme::Light),
            Some("dark") => Some(tauri::Theme::Dark),
            _ => None,
        };
        let _ = page.set_theme(theme);
        native::show_inactive(&page)?;
        if take_keyboard {
            native::focus(&page);
        }
        *self.shown.lock().unwrap() = Some(site);
        #[cfg(windows)]
        hook::start(&app);
        Ok(site)
    }

    /// Hides `only` that site's page (a tab closing, which may run after the
    /// next tab's page opened), or every page.
    fn hide(&self, only: Option<Site>) -> Result<(), String> {
        let app = self.app()?;
        let _busy = self.busy.lock().unwrap();
        let mut shown = self.shown.lock().unwrap();
        let closing = match only {
            None => shown.is_some(),
            Some(site) => *shown == Some(site),
        };
        let mut had_keyboard = app
            .get_webview_window(ISLAND_LABEL)
            .is_some_and(|island| native::is_foreground(&island));
        let sites = only.map_or(Site::ALL.to_vec(), |site| vec![site]);
        for site in sites {
            if let Some(page) = app.get_webview_window(site.label()) {
                had_keyboard |= native::is_foreground(&page);
                native::hide(&page);
            }
        }
        if closing {
            *shown = None;
            #[cfg(windows)]
            hook::stop();
            // The keyboard goes back to the game / editor it came from.
            if had_keyboard {
                window::restore_focus();
            }
        }
        Ok(())
    }

    /// The page on screen, in the default browser.
    /// The island is being dragged: the page steps off the screen until it
    /// stops (then `show` puts it back in its new place). The chat stays open:
    /// the hook still closes it on a click outside, the keyboard isn't touched.
    fn park(&self, site: &str) -> Result<(), String> {
        let site = Site::parse(site).ok_or("chat: unknown site")?;
        let _busy = self.busy.lock().unwrap();
        if *self.shown.lock().unwrap() != Some(site) {
            return Ok(());
        }
        if let Some(page) = self.app()?.get_webview_window(site.label()) {
            native::hide(&page);
        }
        Ok(())
    }

    fn open_external(&self, site: &str) -> Result<(), String> {
        let app = self.app()?;
        let site = Site::parse(site).ok_or("chat: unknown site")?;
        let url = app
            .get_webview_window(site.label())
            .and_then(|v| v.url().ok())
            .filter(|u| u.scheme() == "https")
            .map(|u| u.to_string())
            .unwrap_or_else(|| site.home().to_string());
        crate::settings::open_url(&url);
        Ok(())
    }

    /// Back to the site's start page (e.g. after wandering off in a sign-in flow).
    fn home(&self, site: &str) -> Result<(), String> {
        let site = Site::parse(site).ok_or("chat: unknown site")?;
        let app = self.app()?;
        if let Some(page) = app.get_webview_window(site.label()) {
            let url = site
                .home()
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?;
            page.navigate(url).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// The site's own window: borderless and transparent, owned by the island (so
/// it stays above it), out of the taskbar and Alt+Tab, hidden until placed.
fn create(app: &AppHandle, island: &WebviewWindow, site: Site) -> Result<WebviewWindow, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("chat");
    let url = site
        .home()
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;
    WebviewWindowBuilder::new(app, site.label(), WebviewUrl::External(url))
        .title("Chat")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .focused(false)
        .parent(island)
        .map_err(|e| e.to_string())?
        .data_directory(data)
        .initialization_script(GLASS_SCRIPT)
        .on_page_load(move |page, load| {
            if load.event() == PageLoadEvent::Finished {
                LOADED[site.index()].store(true, Ordering::Relaxed);
                let _ = page.emit_to(ISLAND_LABEL, LOADED_EVENT, site.id());
            }
        })
        .on_navigation(|url| matches!(url.scheme(), "https" | "about" | "blob" | "data"))
        .on_new_window(|url, _| {
            if is_sign_in(&url) {
                return NewWindowResponse::Allow;
            }
            if matches!(url.scheme(), "https" | "http") {
                crate::settings::open_url(url.as_str());
            }
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|e| e.to_string())
}

/// Showing, hiding and focusing the pages. On Windows straight through the
/// API: the page is shown without activation (hovering mustn't pull focus out
/// of a game), which Tauri doesn't track, so its own hide / focus would be
/// skipped as if the page were already hidden.
mod native {
    use tauri::WebviewWindow;

    #[cfg(windows)]
    fn hwnd(win: &WebviewWindow) -> Option<windows::Win32::Foundation::HWND> {
        win.hwnd()
            .ok()
            .map(|h| windows::Win32::Foundation::HWND(h.0))
    }

    /// The page on screen (0: none), for `restack`.
    #[cfg(windows)]
    static SHOWN: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

    #[cfg(windows)]
    pub fn show_inactive(page: &WebviewWindow) -> Result<(), String> {
        use std::sync::atomic::Ordering;
        use windows::Win32::UI::WindowsAndMessaging::{SW_SHOWNOACTIVATE, ShowWindow};
        let hwnd = hwnd(page).ok_or("chat: no window handle")?;
        let _ = unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
        SHOWN.store(hwnd.0 as isize, Ordering::Relaxed);
        restack();
        Ok(())
    }

    #[cfg(windows)]
    pub fn hide(page: &WebviewWindow) {
        use std::sync::atomic::Ordering;
        use windows::Win32::UI::WindowsAndMessaging::{SW_HIDE, ShowWindow};
        if let Some(hwnd) = hwnd(page) {
            let _ =
                SHOWN.compare_exchange(hwnd.0 as isize, 0, Ordering::Relaxed, Ordering::Relaxed);
            let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
        }
    }

    /// Puts the page on screen back above the island, which re-raises itself
    /// to the top of the topmost band whenever the foreground window changes.
    #[cfg(windows)]
    pub fn restack() {
        use std::sync::atomic::Ordering;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
            SWP_NOSIZE, SetWindowPos,
        };
        let raw = SHOWN.load(Ordering::Relaxed);
        if raw == 0 {
            return;
        }
        let flags =
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS;
        let _ = unsafe { SetWindowPos(HWND(raw as *mut _), Some(HWND_TOPMOST), 0, 0, 0, 0, flags) };
    }

    #[cfg(not(windows))]
    pub fn restack() {}

    #[cfg(windows)]
    pub fn focus(page: &WebviewWindow) {
        use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
        if let Some(hwnd) = hwnd(page) {
            let _ = unsafe { SetForegroundWindow(hwnd) };
        }
        let _ = page.set_focus();
    }

    #[cfg(windows)]
    pub fn is_foreground(win: &WebviewWindow) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        hwnd(win).is_some_and(|h| unsafe { GetForegroundWindow() } == h)
    }

    #[cfg(not(windows))]
    pub fn show_inactive(page: &WebviewWindow) -> Result<(), String> {
        page.show().map_err(|e| e.to_string())
    }

    #[cfg(not(windows))]
    pub fn hide(page: &WebviewWindow) {
        let _ = page.hide();
    }

    #[cfg(not(windows))]
    pub fn focus(page: &WebviewWindow) {
        let _ = page.set_focus();
    }

    #[cfg(not(windows))]
    pub fn is_foreground(win: &WebviewWindow) -> bool {
        win.is_focused().unwrap_or(false)
    }
}

impl Provider for ChatProvider {
    fn id(&self) -> &'static str {
        ID
    }

    fn start(self: Arc<Self>, hub: Arc<Hub>) {
        *self.app.lock().unwrap() = Some(hub.app().clone());
    }

    fn action(&self, action: &str, payload: Value) -> Result<Value, String> {
        match action {
            "show" => {
                let req: Show = serde_json::from_value(payload).map_err(|e| e.to_string())?;
                let site = self.show(req)?;
                return Ok(
                    serde_json::json!({ "loaded": LOADED[site.index()].load(Ordering::Relaxed) }),
                );
            }
            "park" => self.park(payload.as_str().unwrap_or_default())?,
            "hide" => self.hide(payload.as_str().and_then(Site::parse))?,
            "openExternal" => self.open_external(payload.as_str().unwrap_or_default())?,
            "home" => self.home(payload.as_str().unwrap_or_default())?,
            _ => return Err(format!("chat: unknown action '{action}'")),
        }
        Ok(Value::Null)
    }
}

pub use native::restack;

/// Which mouse buttons the hook swallowed the press of: their release must be
/// swallowed too, or the app below gets half a click. Only the release of a
/// press *this* hook swallowed: a stale mark would eat the release of a click
/// on the island, and Windows would then think the button is still held (the
/// island follows the mouse as if dragged).
struct Swallowed(std::sync::atomic::AtomicU32);

impl Swallowed {
    const fn new() -> Self {
        Self(std::sync::atomic::AtomicU32::new(0))
    }

    /// A press of `bit`; swallowed when `outside` the island.
    fn press(&self, bit: u32, outside: bool) -> bool {
        if outside {
            self.0.fetch_or(bit, Ordering::Relaxed);
        } else {
            self.0.fetch_and(!bit, Ordering::Relaxed);
        }
        outside
    }

    /// A release of `bit`: swallowed when its press was.
    fn release(&self, bit: u32) -> bool {
        self.0.fetch_and(!bit, Ordering::Relaxed) & bit != 0
    }

    fn reset(&self) {
        self.0.store(0, Ordering::Relaxed);
    }
}

/// Swallows clicks outside the island while the chat is open.
#[cfg(windows)]
mod hook {
    use std::sync::{Mutex, OnceLock};

    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, HC_ACTION, MSG, MSLLHOOKSTRUCT, PostThreadMessageW,
        SetWindowsHookExW, UnhookWindowsHookEx, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP,
        WM_MBUTTONDOWN, WM_MBUTTONUP, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_XBUTTONDOWN,
        WM_XBUTTONUP,
    };

    use super::Swallowed;
    use crate::window::on_island;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    /// Thread running the hook's message loop (0: none).
    static THREAD: Mutex<u32> = Mutex::new(0);
    /// Buttons whose press was swallowed: their release is swallowed too.
    static SWALLOWED: Swallowed = Swallowed::new();

    pub fn start(app: &AppHandle) {
        let _ = APP.set(app.clone());
        let mut thread = THREAD.lock().unwrap();
        if *thread != 0 {
            return;
        }
        // A press swallowed by the last hook whose release came after it was
        // gone: this hook must not eat the next release (the island's own).
        SWALLOWED.reset();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || unsafe {
            let module = GetModuleHandleW(None).ok();
            let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(proc), module.map(Into::into), 0);
            let _ = tx.send(GetCurrentThreadId());
            let Ok(hook) = hook else {
                log::warn!("chat: couldn't install the mouse hook");
                return;
            };
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
            let _ = UnhookWindowsHookEx(hook);
        });
        *thread = rx.recv().unwrap_or(0);
    }

    pub fn stop() {
        let id = std::mem::take(&mut *THREAD.lock().unwrap());
        if id != 0 {
            let _ = unsafe { PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0)) };
        }
    }

    fn button(msg: u32) -> Option<(u32, bool)> {
        Some(match msg {
            WM_LBUTTONDOWN => (1, true),
            WM_LBUTTONUP => (1, false),
            WM_RBUTTONDOWN => (2, true),
            WM_RBUTTONUP => (2, false),
            WM_MBUTTONDOWN => (4, true),
            WM_MBUTTONUP => (4, false),
            WM_XBUTTONDOWN => (8, true),
            WM_XBUTTONUP => (8, false),
            _ => return None,
        })
    }

    unsafe extern "system" fn proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32
            && let Some((bit, down)) = button(wparam.0 as u32)
        {
            if down {
                // Windows waits on this hook for every mouse event: nothing here
                // may wait on another thread.
                let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
                if SWALLOWED.press(bit, !on_island(info.pt.x as f64, info.pt.y as f64)) {
                    if let Some(app) = APP.get().cloned() {
                        std::thread::spawn(move || {
                            let _ = app.emit(super::DISMISS_EVENT, ());
                        });
                    }
                    return LRESULT(1);
                }
            } else if SWALLOWED.release(bit) {
                return LRESULT(1);
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swallows_only_the_release_of_a_swallowed_press() {
        let s = Swallowed::new();
        // Outside: press and release both swallowed.
        assert!(s.press(1, true));
        assert!(s.release(1));
        // On the island: neither.
        assert!(!s.press(1, false));
        assert!(!s.release(1));
        // Other buttons are tracked on their own.
        assert!(s.press(2, true));
        assert!(!s.release(1));
        assert!(s.release(2));
    }

    #[test]
    fn a_new_hook_forgets_a_press_whose_release_it_never_saw() {
        // The click outside closed the chat; the hook was gone before the release.
        let s = Swallowed::new();
        assert!(s.press(1, true));
        // The chat opens again: a new hook.
        s.reset();
        // The first click on the island: its release must get through.
        assert!(!s.press(1, false));
        assert!(!s.release(1));
        // Even if the press came in before the reset.
        assert!(s.press(1, true));
        s.reset();
        assert!(!s.release(1));
    }

    #[test]
    fn knows_its_sites() {
        assert_eq!(Site::parse("chatgpt"), Some(Site::ChatGpt));
        assert_eq!(Site::parse("gemini"), Some(Site::Gemini));
        assert_eq!(Site::parse("../x"), None);
        for site in Site::ALL {
            assert!(site.home().starts_with("https://"));
        }
    }

    #[test]
    fn only_sign_in_pages_get_popups() {
        let url = |s: &str| s.parse::<tauri::Url>().unwrap();
        assert!(is_sign_in(&url(
            "https://accounts.google.com/o/oauth2/auth?x=1"
        )));
        assert!(is_sign_in(&url("https://auth.openai.com/authorize")));
        assert!(!is_sign_in(&url("https://example.com/")));
        assert!(!is_sign_in(&url("https://accounts.google.com.evil.io/")));
    }
}
