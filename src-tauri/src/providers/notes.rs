//! Notes: a folder of Markdown files (a "vault", like Obsidian's) edited in
//! the island. The folder is `Documents/Island Notes` unless the user picks
//! another one (`notes.folder`); every note is a plain `.md` file in it, so
//! any other editor can open them too.
//!
//! Paths exchanged with the UI are relative to the folder, with `/`. Nothing
//! outside the folder can be read or written: [`resolve`] refuses `..`,
//! drive letters and absolute paths. Deleted notes go to `.trash/` inside it;
//! pasted pictures to `attachments/`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::Manager;

use super::Provider;
use super::ask::{data_url, image_media_type};
use crate::hub::Hub;

pub const ID: &str = "notes";
const FOLDER_SETTING: &str = "notes.folder";
const DEFAULT_FOLDER: &str = "Island Notes";
const ATTACHMENTS: &str = "attachments";
const TRASH: &str = ".trash";
const MAX_IMAGE_BYTES: u64 = 25_000_000;
const MAX_DEPTH: usize = 12;
const WELCOME: &str = include_str!("notes_welcome.md");

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    /// Relative to the folder, `/`-separated; notes keep their `.md`.
    path: String,
    /// Shown name (notes without `.md`).
    name: String,
    dir: bool,
    children: Vec<Node>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct State {
    root: String,
    tree: Vec<Node>,
    error: Option<String>,
}

#[derive(Default)]
pub struct NotesProvider {
    hub: Mutex<Option<Arc<Hub>>>,
}

impl NotesProvider {
    fn hub(&self) -> Result<Arc<Hub>, String> {
        self.hub
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "notes not started".into())
    }
}

/// The notes folder: the one picked in the settings, or `Documents/Island Notes`.
fn root(app: &tauri::AppHandle) -> PathBuf {
    let picked = app
        .state::<crate::settings::Settings>()
        .get(FOLDER_SETTING)
        .and_then(|v| v.as_str().map(str::to_owned))
        .filter(|s| !s.trim().is_empty());
    if let Some(p) = picked {
        return PathBuf::from(p);
    }
    let path = app.path();
    path.document_dir()
        .or_else(|_| path.app_data_dir())
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(DEFAULT_FOLDER)
}

/// Creates the folder on first use, with a note explaining the module.
fn ensure_root(root: &Path) -> Result<(), String> {
    if root.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let _ = std::fs::write(root.join("Welcome.md"), WELCOME);
    Ok(())
}

fn refresh(hub: &Hub) {
    let root = root(hub.app());
    let (tree, error) = match ensure_root(&root) {
        Ok(()) => (list(&root, "", 0), None),
        Err(e) => (vec![], Some(e)),
    };
    hub.publish(
        ID,
        &State {
            root: root.to_string_lossy().to_string(),
            tree,
            error,
        },
    );
}

fn is_note(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

/// Folders and `.md` notes, folders first, by name. Hidden entries and
/// attachment folders are left out.
fn list(dir: &Path, rel: &str, depth: usize) -> Vec<Node> {
    if depth > MAX_DEPTH {
        return vec![];
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut nodes: Vec<Node> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let path = entry.path();
            let child = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            if path.is_dir() {
                if name.eq_ignore_ascii_case(ATTACHMENTS) {
                    return None;
                }
                Some(Node {
                    children: list(&path, &child, depth + 1),
                    path: child,
                    name,
                    dir: true,
                })
            } else if is_note(&path) {
                Some(Node {
                    path: child,
                    name: name[..name.len() - 3].to_string(),
                    dir: false,
                    children: vec![],
                })
            } else {
                None
            }
        })
        .collect();
    nodes.sort_by(|a, b| {
        b.dir
            .cmp(&a.dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    nodes
}

/// `rel` inside `root`, refusing anything that could leave it.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut out = root.to_path_buf();
    for part in rel.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.contains(':') {
            return Err("path outside the notes folder".into());
        }
        out.push(part);
    }
    Ok(out)
}

/// A name the file system takes on every platform.
fn valid_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty()
        || name.starts_with('.')
        || name.ends_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
    {
        return Err("invalid name".into());
    }
    Ok(name)
}

/// `/`-separated path of `path` relative to `root`.
fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// `dir/stem.ext`, or `dir/stem 1.ext`, `dir/stem 2.ext`… if taken.
fn unique(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let file = |n: usize| {
        let name = if n == 0 {
            stem.to_string()
        } else {
            format!("{stem} {n}")
        };
        dir.join(if ext.is_empty() {
            name
        } else {
            format!("{name}.{ext}")
        })
    };
    (0..).map(file).find(|p| !p.exists()).unwrap()
}

/// The folder part of a note's path (`a/b/note.md` → `a/b`).
fn parent_of(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(p, _)| p).unwrap_or("")
}

/// A Markdown link target written in the note at `note` (`../pics/a%20b.png`,
/// `<attachments/x y.png>`) as a path relative to the folder; `None` when it
/// would leave the folder.
fn link_target(note: &str, src: &str) -> Option<String> {
    let src = src.trim().trim_start_matches('<').trim_end_matches('>');
    let src = percent_decode(src.split(['#', '?']).next().unwrap_or(src));
    let mut parts: Vec<&str> = if src.starts_with('/') {
        vec![]
    } else {
        parent_of(note)
            .split('/')
            .filter(|p| !p.is_empty())
            .collect()
    };
    for part in src.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p if p.contains(':') => return None,
            p => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3])
            && let Ok(b) = u8::from_str_radix(hex, 16)
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// How the note at `note` links to the folder-relative `target`.
fn link_from(note: &str, target: &str) -> String {
    let from: Vec<&str> = parent_of(note)
        .split('/')
        .filter(|p| !p.is_empty())
        .collect();
    let to: Vec<&str> = target.split('/').collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&str> = vec![".."; from.len() - common];
    parts.extend(&to[common..]);
    parts.join("/").replace(' ', "%20")
}

/// Writes through a temporary file, so a crash never leaves half a note.
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[derive(Deserialize)]
struct PathArg {
    path: String,
}

#[derive(Deserialize)]
struct WriteArg {
    path: String,
    content: String,
}

#[derive(Deserialize)]
struct CreateArg {
    /// Folder to create it in ("" = the top).
    parent: String,
    name: String,
    dir: bool,
}

#[derive(Deserialize)]
struct RenameArg {
    path: String,
    name: String,
}

#[derive(Deserialize)]
struct MoveArg {
    path: String,
    /// Destination folder ("" = the top).
    to: String,
}

#[derive(Deserialize)]
struct ImageArg {
    note: String,
    src: String,
}

#[derive(Deserialize)]
struct PasteArg {
    note: String,
    /// The picture, base64.
    data: String,
    ext: String,
}

fn arg<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, String> {
    serde_json::from_value(payload).map_err(|e| e.to_string())
}

impl Provider for NotesProvider {
    fn id(&self) -> &'static str {
        ID
    }

    fn start(self: Arc<Self>, hub: Arc<Hub>) {
        *self.hub.lock().unwrap() = Some(hub.clone());
        refresh(&hub);
        // Notes added, moved or removed outside the island.
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(3));
                refresh(&hub);
            }
        });
    }

    fn action(&self, action: &str, payload: Value) -> Result<Value, String> {
        let hub = self.hub()?;
        let app = hub.app();
        let root = root(app);
        ensure_root(&root)?;
        match action {
            "refresh" => {}
            "openFolder" => crate::settings::open_url(&root.to_string_lossy()),
            "openLink" => {
                let url = payload.as_str().unwrap_or_default();
                let lower = url.to_ascii_lowercase();
                if !(lower.starts_with("https://")
                    || lower.starts_with("http://")
                    || lower.starts_with("mailto:"))
                {
                    return Err("only web links".into());
                }
                crate::settings::open_url(url);
                return Ok(Value::Null);
            }
            "pickFolder" => {
                let Some(folder) = crate::dialog::pick_folder() else {
                    return Ok(Value::Null);
                };
                crate::settings::set(app, FOLDER_SETTING, Value::String(folder.clone()));
                refresh(&hub);
                return Ok(Value::String(folder));
            }
            "resetFolder" => crate::settings::set(app, FOLDER_SETTING, Value::Null),
            _ => {
                let result = file_action(&root, action, payload)?;
                // The tree changed: show it now rather than at the next poll.
                if matches!(action, "create" | "rename" | "move" | "delete") {
                    refresh(&hub);
                }
                return Ok(result);
            }
        }
        refresh(&hub);
        Ok(Value::Null)
    }
}

/// What can be done to the notes folder at `root` (everything but the
/// dialogs, settings and links, which need the app).
fn file_action(root: &Path, action: &str, payload: Value) -> Result<Value, String> {
    let root = root.to_path_buf();
    let result = match action {
        "read" => {
            let PathArg { path } = arg(payload)?;
            let file = resolve(&root, &path)?;
            if !is_note(&file) {
                return Err("not a note".into());
            }
            let content = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
            return Ok(json!({ "content": content }));
        }
        "write" => {
            let WriteArg { path, content } = arg(payload)?;
            let file = resolve(&root, &path)?;
            if !is_note(&file) || !file.parent().is_some_and(Path::is_dir) {
                return Err("not a note".into());
            }
            write_atomic(&file, &content)?;
            return Ok(Value::Null);
        }
        "create" => {
            let CreateArg { parent, name, dir } = arg(payload)?;
            let name = valid_name(&name)?;
            let folder = resolve(&root, &parent)?;
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let target = if dir {
                let target = unique(&folder, name, "");
                std::fs::create_dir(&target).map_err(|e| e.to_string())?;
                target
            } else {
                let stem = name.strip_suffix(".md").unwrap_or(name);
                let target = unique(&folder, stem, "md");
                std::fs::write(&target, "").map_err(|e| e.to_string())?;
                target
            };
            Value::String(relative(&root, &target))
        }
        "rename" => {
            let RenameArg { path, name } = arg(payload)?;
            let from = resolve(&root, &path)?;
            let name = valid_name(&name)?;
            let file_name = if is_note(&from) && !name.to_lowercase().ends_with(".md") {
                format!("{name}.md")
            } else {
                name.to_string()
            };
            let to = from.with_file_name(file_name);
            if to != from {
                // Only a change of case: same file on Windows.
                let same = to
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&from.to_string_lossy());
                if to.exists() && !same {
                    return Err("exists".into());
                }
                std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
            }
            Value::String(relative(&root, &to))
        }
        "move" => {
            let MoveArg { path, to } = arg(payload)?;
            let from = resolve(&root, &path)?;
            let folder = resolve(&root, &to)?;
            if folder.starts_with(&from) {
                return Err("can't move a folder into itself".into());
            }
            let name = from.file_name().ok_or("no name")?;
            let target = folder.join(name);
            if target != from {
                if target.exists() {
                    return Err("exists".into());
                }
                std::fs::rename(&from, &target).map_err(|e| e.to_string())?;
            }
            Value::String(relative(&root, &target))
        }
        // To `.trash/` in the folder, never deleted for good.
        "delete" => {
            let PathArg { path } = arg(payload)?;
            let from = resolve(&root, &path)?;
            if from == root {
                return Err("can't delete the notes folder".into());
            }
            let trash = root.join(TRASH);
            std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
            let name = from
                .file_name()
                .ok_or("no name")?
                .to_string_lossy()
                .to_string();
            let (stem, ext) = match name.rsplit_once('.') {
                Some((s, e)) if from.is_file() => (s.to_string(), e.to_string()),
                _ => (name.clone(), String::new()),
            };
            std::fs::rename(&from, unique(&trash, &stem, &ext)).map_err(|e| e.to_string())?;
            Value::Null
        }
        "image" => {
            let ImageArg { note, src } = arg(payload)?;
            let target = link_target(&note, &src).ok_or("outside the notes folder")?;
            let file = resolve(&root, &target)?;
            let media = image_media_type(&file).ok_or("not a picture")?;
            let size = std::fs::metadata(&file).map_err(|e| e.to_string())?.len();
            if size > MAX_IMAGE_BYTES {
                return Err("too big".into());
            }
            return data_url(&file, media)
                .map(Value::String)
                .ok_or_else(|| "unreadable".into());
        }
        // A picture pasted into a note: saved next to the notes, linked from it.
        "pasteImage" => {
            let PasteArg { note, data, ext } = arg(payload)?;
            let ext = ext.to_lowercase();
            if !["png", "jpg", "jpeg", "gif", "webp"].contains(&ext.as_str()) {
                return Err("not a picture".into());
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|e| e.to_string())?;
            let folder = root.join(ATTACHMENTS);
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let stem = chrono::Local::now()
                .format("Pasted %Y-%m-%d %H%M%S")
                .to_string();
            let file = unique(&folder, &stem, &ext);
            std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
            return Ok(Value::String(link_from(&note, &relative(&root, &file))));
        }
        _ => return Err(format!("{ID}: unknown action '{action}'")),
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_folder() {
        let root = Path::new("/notes");
        assert_eq!(
            resolve(root, "a/b.md").unwrap(),
            root.join("a").join("b.md")
        );
        assert_eq!(resolve(root, "").unwrap(), root);
        assert!(resolve(root, "../x.md").is_err());
        assert!(resolve(root, "a/../../x.md").is_err());
        assert!(resolve(root, "C:/Windows/x.md").is_err());
        assert!(resolve(root, "a\\..\\x.md").is_err());
    }

    #[test]
    fn names() {
        assert_eq!(valid_name("  Ideas ").unwrap(), "Ideas");
        assert!(valid_name("").is_err());
        assert!(valid_name("a/b").is_err());
        assert!(valid_name("..").is_err());
        assert!(valid_name(".hidden").is_err());
        assert!(valid_name("what?").is_err());
    }

    #[test]
    fn links_resolve_from_the_note() {
        assert_eq!(
            link_target("a/b/n.md", "../pics/x%20y.png").unwrap(),
            "a/pics/x y.png"
        );
        assert_eq!(
            link_target("n.md", "<attachments/x y.png>").unwrap(),
            "attachments/x y.png"
        );
        assert_eq!(
            link_target("a/n.md", "/attachments/p.png").unwrap(),
            "attachments/p.png"
        );
        assert!(link_target("n.md", "../outside.png").is_none());
        assert!(link_target("n.md", "C:/x.png").is_none());
    }

    #[test]
    fn links_are_written_relative() {
        assert_eq!(
            link_from("n.md", "attachments/P 1.png"),
            "attachments/P%201.png"
        );
        assert_eq!(
            link_from("a/b/n.md", "attachments/p.png"),
            "../../attachments/p.png"
        );
        assert_eq!(
            link_target("a/b/n.md", &link_from("a/b/n.md", "attachments/P 1.png")).unwrap(),
            "attachments/P 1.png"
        );
    }

    /// Create, write, read, rename, move, paste and delete in a real folder.
    #[test]
    fn file_actions() {
        let root = std::env::temp_dir().join(format!("island-notes-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        ensure_root(&root).unwrap();
        assert!(root.join("Welcome.md").is_file());
        let run = |action: &str, payload: Value| file_action(&root, action, payload);

        let dir = run("create", json!({ "parent": "", "name": "Work", "dir": true })).unwrap();
        assert_eq!(dir, "Work");
        let note = run("create", json!({ "parent": "Work", "name": "Plan", "dir": false })).unwrap();
        assert_eq!(note, "Work/Plan.md");
        // Taken names get a number.
        let again = run("create", json!({ "parent": "Work", "name": "Plan", "dir": false })).unwrap();
        assert_eq!(again, "Work/Plan 1.md");

        run("write", json!({ "path": "Work/Plan.md", "content": "# Hi
there" })).unwrap();
        let read = run("read", json!({ "path": "Work/Plan.md" })).unwrap();
        assert_eq!(read["content"], "# Hi
there");
        assert!(run("write", json!({ "path": "../escape.md", "content": "x" })).is_err());
        assert!(run("write", json!({ "path": "Work/x.txt", "content": "x" })).is_err());

        let renamed = run("rename", json!({ "path": "Work/Plan.md", "name": "Roadmap" })).unwrap();
        assert_eq!(renamed, "Work/Roadmap.md");
        assert_eq!(
            run("rename", json!({ "path": "Work/Roadmap.md", "name": "Plan 1" })).unwrap_err(),
            "exists"
        );
        let moved = run("move", json!({ "path": "Work/Roadmap.md", "to": "" })).unwrap();
        assert_eq!(moved, "Roadmap.md");
        assert!(run("move", json!({ "path": "Work", "to": "Work" })).is_err());

        // A 1×1 PNG, pasted into a note one folder down.
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        let link = run("pasteImage", json!({ "note": "Work/Plan 1.md", "data": png, "ext": "png" })).unwrap();
        let link = link.as_str().unwrap();
        assert!(link.starts_with("../attachments/Pasted%20"), "{link}");
        let img = run("image", json!({ "note": "Work/Plan 1.md", "src": link })).unwrap();
        assert!(img.as_str().unwrap().starts_with("data:image/png;base64,"));

        // The tree: folders first, attachments and the trash left out.
        run("delete", json!({ "path": "Work" })).unwrap();
        assert!(root.join(TRASH).join("Work").join("Plan 1.md").is_file());
        let names: Vec<String> = list(&root, "", 0).into_iter().map(|n| n.path).collect();
        assert_eq!(names, ["Roadmap.md", "Welcome.md"]);
        assert!(run("delete", json!({ "path": "" })).is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn percent() {
        assert_eq!(percent_decode("a%20b%2"), "a b%2");
        assert_eq!(percent_decode("%C3%A9"), "é");
    }

    /// An empty folder of its own for one test, removed when it ends.
    struct Folder(PathBuf);

    impl Folder {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "island-notes-{name}-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).unwrap();
            Self(root)
        }

        fn run(&self, action: &str, payload: Value) -> Result<Value, String> {
            file_action(&self.0, action, payload)
        }

        fn touch(&self, rel: &str) {
            let path = self.0.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        }

        fn paths(&self) -> Vec<String> {
            fn walk(nodes: Vec<Node>, out: &mut Vec<String>) {
                for n in nodes {
                    out.push(n.path);
                    walk(n.children, out);
                }
            }
            let mut out = vec![];
            walk(list(&self.0, "", 0), &mut out);
            out
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn more_names() {
        assert!(valid_name("   ").is_err());
        assert!(valid_name("end.").is_err());
        assert!(valid_name("tab\there").is_err());
        for c in ['\\', ':', '*', '"', '<', '>', '|'] {
            assert!(valid_name(&format!("a{c}b")).is_err(), "{c}");
        }
        assert_eq!(valid_name("Notes 2026 (draft)").unwrap(), "Notes 2026 (draft)");
        assert_eq!(valid_name("Café").unwrap(), "Café");
    }

    #[test]
    fn resolve_skips_empty_and_dot_parts() {
        let root = Path::new("/notes");
        assert_eq!(
            resolve(root, "./a//b/./n.md").unwrap(),
            root.join("a").join("b").join("n.md")
        );
        assert_eq!(resolve(root, "a\\b.md").unwrap(), root.join("a").join("b.md"));
        assert!(resolve(root, "a/x:y.md").is_err());
    }

    #[test]
    fn parents_and_relative_paths() {
        assert_eq!(parent_of("a/b/n.md"), "a/b");
        assert_eq!(parent_of("n.md"), "");
        let root = Path::new("/notes");
        assert_eq!(relative(root, &root.join("a").join("b.md")), "a/b.md");
        assert_eq!(relative(root, root), "");
    }

    #[test]
    fn links_in_the_same_folder_and_with_anchors() {
        assert_eq!(link_from("a/n.md", "a/p.png"), "p.png");
        assert_eq!(link_from("a/b/n.md", "a/c/p.png"), "../c/p.png");
        assert_eq!(link_target("a/n.md", "./p.png#x").unwrap(), "a/p.png");
        assert_eq!(link_target("a/n.md", "p.png?v=2").unwrap(), "a/p.png");
        assert_eq!(link_target("a/n.md", "../p.png").unwrap(), "p.png");
    }

    #[test]
    fn welcome_note_only_in_a_new_folder() {
        let f = Folder::new("welcome");
        // The folder exists already: nothing is added to it.
        ensure_root(&f.0).unwrap();
        assert!(!f.0.join("Welcome.md").exists());

        let fresh = f.0.join("fresh");
        ensure_root(&fresh).unwrap();
        assert_eq!(std::fs::read_to_string(fresh.join("Welcome.md")).unwrap(), WELCOME);
    }

    #[test]
    fn tree_shows_folders_first_and_only_notes() {
        let f = Folder::new("tree");
        f.touch("beta.md");
        f.touch("Alpha.md");
        f.touch("LOUD.MD");
        f.touch("notes.txt");
        f.touch(".hidden.md");
        f.touch(".obsidian/app.md");
        f.touch("Attachments/p.md");
        f.touch("zoo/inner.md");
        f.touch("Archive/old.md");
        std::fs::create_dir(f.0.join("empty")).unwrap();

        assert_eq!(
            f.paths(),
            [
                "Archive",
                "Archive/old.md",
                "empty",
                "zoo",
                "zoo/inner.md",
                "Alpha.md",
                "beta.md",
                "LOUD.MD",
            ]
        );
        let names: Vec<String> = list(&f.0, "", 0).into_iter().map(|n| n.name).collect();
        assert_eq!(names, ["Archive", "empty", "zoo", "Alpha", "beta", "LOUD"]);
    }

    #[test]
    fn tree_stops_at_max_depth() {
        let f = Folder::new("depth");
        let deep: Vec<String> = (0..=MAX_DEPTH + 1).map(|i| format!("d{i}")).collect();
        f.touch(&format!("{}/n.md", deep.join("/")));
        let paths = f.paths();
        // Folders down to the limit are listed; what's below it isn't.
        assert!(paths.contains(&deep[..=MAX_DEPTH].join("/")));
        assert!(!paths.iter().any(|p| p.ends_with("n.md")));
    }

    #[test]
    fn create_keeps_md_once_and_numbers_folders() {
        let f = Folder::new("create");
        assert_eq!(
            f.run("create", json!({ "parent": "", "name": "Idea.md", "dir": false }))
                .unwrap(),
            "Idea.md"
        );
        assert_eq!(
            f.run("create", json!({ "parent": "", "name": "Box", "dir": true })).unwrap(),
            "Box"
        );
        assert_eq!(
            f.run("create", json!({ "parent": "", "name": "Box", "dir": true })).unwrap(),
            "Box 1"
        );
        // A missing parent folder is made on the way.
        assert_eq!(
            f.run("create", json!({ "parent": "a/b", "name": "n", "dir": false }))
                .unwrap(),
            "a/b/n.md"
        );
        assert!(f.run("create", json!({ "parent": "", "name": "a/b", "dir": false })).is_err());
        assert!(f.run("create", json!({ "parent": "..", "name": "x", "dir": false })).is_err());
        assert!(f.run("create", json!({ "parent": "", "dir": false })).is_err());
    }

    #[test]
    fn writes_leave_no_temporary_file() {
        let f = Folder::new("write");
        f.touch("n.md");
        f.run("write", json!({ "path": "n.md", "content": "one" })).unwrap();
        f.run("write", json!({ "path": "n.md", "content": "two" })).unwrap();
        assert_eq!(std::fs::read_to_string(f.0.join("n.md")).unwrap(), "two");
        let files: Vec<_> = std::fs::read_dir(&f.0).unwrap().flatten().collect();
        assert_eq!(files.len(), 1);
        // A note in a folder that isn't there is refused, not created.
        assert_eq!(
            f.run("write", json!({ "path": "missing/n.md", "content": "x" })).unwrap_err(),
            "not a note"
        );
        assert!(!f.0.join("missing").exists());
    }

    #[test]
    fn read_only_notes() {
        let f = Folder::new("read");
        f.touch("a/n.md");
        f.touch("a/p.txt");
        assert_eq!(f.run("read", json!({ "path": "a" })).unwrap_err(), "not a note");
        assert_eq!(f.run("read", json!({ "path": "a/p.txt" })).unwrap_err(), "not a note");
        assert!(f.run("read", json!({ "path": "a/gone.md" })).is_err());
        assert!(f.run("read", json!({ "path": "../a/n.md" })).is_err());
        assert_eq!(f.run("read", json!({ "path": "a/n.md" })).unwrap()["content"], "");
    }

    #[test]
    fn rename_folders_notes_and_case() {
        let f = Folder::new("rename");
        f.touch("Work/Plan.md");
        f.touch("Work/Other.md");
        // Folders get no `.md`; notes get it once.
        assert_eq!(
            f.run("rename", json!({ "path": "Work", "name": "Projects" })).unwrap(),
            "Projects"
        );
        assert_eq!(
            f.run("rename", json!({ "path": "Projects/Plan.md", "name": "Road.md" }))
                .unwrap(),
            "Projects/Road.md"
        );
        // Only the case changes: allowed, even where the file system ignores case.
        assert_eq!(
            f.run("rename", json!({ "path": "Projects/Road.md", "name": "road" })).unwrap(),
            "Projects/road.md"
        );
        assert!(f.paths().contains(&"Projects/road.md".to_string()));
        // Same name: nothing to do.
        assert_eq!(
            f.run("rename", json!({ "path": "Projects/road.md", "name": "road" })).unwrap(),
            "Projects/road.md"
        );
        assert_eq!(
            f.run("rename", json!({ "path": "Projects/road.md", "name": "Other" }))
                .unwrap_err(),
            "exists"
        );
        assert_eq!(
            f.run("rename", json!({ "path": "Projects/road.md", "name": "../x" }))
                .unwrap_err(),
            "invalid name"
        );
        assert!(f.run("rename", json!({ "path": "Projects/gone.md", "name": "x" })).is_err());
    }

    #[test]
    fn move_refuses_clashes_and_loops() {
        let f = Folder::new("move");
        f.touch("a/n.md");
        f.touch("b/n.md");
        f.touch("a/sub/x.md");
        assert_eq!(
            f.run("move", json!({ "path": "a/n.md", "to": "b" })).unwrap_err(),
            "exists"
        );
        assert!(f.run("move", json!({ "path": "a", "to": "a/sub" })).is_err());
        assert!(f.run("move", json!({ "path": "a/n.md", "to": ".." })).is_err());
        // To the folder it's already in: stays.
        assert_eq!(f.run("move", json!({ "path": "a/n.md", "to": "a" })).unwrap(), "a/n.md");
        // A folder moves with what's in it.
        assert_eq!(f.run("move", json!({ "path": "a/sub", "to": "b" })).unwrap(), "b/sub");
        assert!(f.0.join("b").join("sub").join("x.md").is_file());
    }

    #[test]
    fn delete_goes_to_a_numbered_trash() {
        let f = Folder::new("delete");
        f.touch("n.md");
        f.run("delete", json!({ "path": "n.md" })).unwrap();
        f.touch("n.md");
        f.run("delete", json!({ "path": "n.md" })).unwrap();
        let trash = f.0.join(TRASH);
        assert!(trash.join("n.md").is_file());
        assert!(trash.join("n 1.md").is_file());
        assert!(f.paths().is_empty());
        assert!(f.run("delete", json!({ "path": "gone.md" })).is_err());
        assert!(f.run("delete", json!({ "path": "../x" })).is_err());
        assert!(f.run("delete", json!({ "path": "./" })).is_err());
    }

    #[test]
    fn pictures_must_be_pictures_inside_the_folder() {
        let f = Folder::new("pictures");
        f.touch("n.md");
        let paste = |ext: &str, data: &str| {
            f.run("pasteImage", json!({ "note": "n.md", "data": data, "ext": ext }))
        };
        assert_eq!(paste("exe", "AAAA").unwrap_err(), "not a picture");
        assert!(paste("png", "not base64!").is_err());
        // The extension's case doesn't matter, and the link is from the note.
        let link = paste("PNG", "AAAA").unwrap();
        assert!(link.as_str().unwrap().starts_with("attachments/Pasted%20"), "{link}");
        assert!(link.as_str().unwrap().ends_with(".png"), "{link}");

        let image = |src: &str| f.run("image", json!({ "note": "n.md", "src": src }));
        assert_eq!(image("../x.png").unwrap_err(), "outside the notes folder");
        assert_eq!(image("n.md").unwrap_err(), "not a picture");
        assert!(image("missing.png").is_err());
    }

    #[test]
    fn unknown_actions_and_bad_payloads() {
        let f = Folder::new("unknown");
        assert!(
            f.run("format", Value::Null)
                .unwrap_err()
                .contains("unknown action 'format'")
        );
        assert!(f.run("read", json!({ "file": "n.md" })).is_err());
        assert!(f.run("write", json!("n.md")).is_err());
    }
}
