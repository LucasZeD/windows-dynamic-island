//! Running the `docker` and `kubectl` command line tools.
//!
//! The CLI rather than the Engine API: it follows the user's Docker context
//! (Docker Desktop's `desktop-linux`, a remote host, Podman's shim…) and works
//! the same on Windows and Linux. Every call has a deadline, so a daemon that
//! is starting up or a cluster that doesn't answer never stalls the poll.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Output larger than this is cut (logs, inspect of hundreds of containers).
const MAX_OUTPUT: usize = 8 * 1024 * 1024;

#[derive(Debug, PartialEq)]
pub enum CliError {
    /// The tool isn't installed (or not on PATH).
    Missing,
    /// It ran past its deadline and was killed.
    Timeout,
    /// It exited with an error; the first line of what it said.
    Failed(String),
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliError::Missing => f.write_str("missing"),
            CliError::Timeout => f.write_str("timeout"),
            CliError::Failed(msg) => f.write_str(msg),
        }
    }
}

/// Where a tool is: on PATH, or where Docker Desktop installs it (an app
/// started from the Start menu may not see a PATH updated after login).
fn locate(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(&exe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let fallbacks: &[&str] = if cfg!(windows) {
        &[r"C:\Program Files\Docker\Docker\resources\bin"]
    } else {
        &["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"]
    };
    fallbacks
        .iter()
        .map(|d| PathBuf::from(d).join(&exe))
        .find(|p| p.is_file())
}

fn docker_path() -> Option<&'static PathBuf> {
    static PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| locate("docker")).as_ref()
}

fn kubectl_path() -> Option<&'static PathBuf> {
    static PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| locate("kubectl")).as_ref()
}

pub fn docker(args: &[&str], timeout: Duration) -> Result<String, CliError> {
    run(docker_path().ok_or(CliError::Missing)?, args, timeout).map(|(out, _)| out)
}

/// Both of what it printed: `docker logs` replays the container's stderr on its own.
pub fn docker_both(args: &[&str], timeout: Duration) -> Result<(String, String), CliError> {
    run(docker_path().ok_or(CliError::Missing)?, args, timeout)
}

pub fn kubectl(args: &[&str], timeout: Duration) -> Result<String, CliError> {
    run(kubectl_path().ok_or(CliError::Missing)?, args, timeout).map(|(out, _)| out)
}

fn run(exe: &PathBuf, args: &[&str], timeout: Duration) -> Result<(String, String), CliError> {
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => CliError::Missing,
        _ => CliError::Failed(e.to_string()),
    })?;

    // Read both pipes on their own threads: a full pipe would block the child.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(pipe) = pipe {
                let _ = pipe.take(MAX_OUTPUT as u64).read_to_end(&mut buf);
            }
            buf
        })
    };
    let out = drain(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err = drain(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CliError::Timeout);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(e) => return Err(CliError::Failed(e.to_string())),
        }
    };
    let stdout = String::from_utf8_lossy(&out.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&err.join().unwrap_or_default()).into_owned();
    if status.success() {
        Ok((stdout, stderr))
    } else {
        Err(CliError::Failed(first_line(&stderr, &stdout)))
    }
}

/// The message worth showing from a failed call.
fn first_line(stderr: &str, stdout: &str) -> String {
    let text = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("failed");
    line.chars().take(300).collect()
}

/// A container id or name, a pod or namespace: safe to pass as an argument
/// (no flags, no paths, nothing a shell or the CLI would read as more).
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 253
        && !name.starts_with(['-', '.'])
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_that_could_be_flags_or_paths_are_refused() {
        assert!(valid_name("a2c25381c1e7"));
        assert!(valid_name("ditest-web-1"));
        assert!(valid_name("kube-system"));
        assert!(valid_name("my_app.v2"));
        assert!(!valid_name(""));
        assert!(!valid_name("--help"));
        assert!(!valid_name("-f"));
        assert!(!valid_name("..")); // starts with a dot
        assert!(!valid_name("a/b"));
        assert!(!valid_name("a b"));
        assert!(!valid_name("a;rm"));
        assert!(!valid_name(&"a".repeat(254)));
    }

    #[test]
    fn the_message_is_the_first_non_empty_line() {
        assert_eq!(first_line("\n  error: boom\nmore", ""), "error: boom");
        assert_eq!(first_line("", "out"), "out");
        assert_eq!(first_line("", ""), "failed");
    }
}
