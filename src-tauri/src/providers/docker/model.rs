//! What the island shows of Docker, read from `docker inspect` JSON.
//!
//! Environment variables are never read: they often hold passwords and tokens.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

const COMPOSE: &str = "com.docker.compose.";
const KUBE: &str = "io.kubernetes.";
/// Docker Desktop's mount of the Windows drives inside its VM.
const DESKTOP_HOST: &str = "/run/desktop/mnt/host/";
/// A health check's output is often a whole web page; keep the start.
const MAX_HEALTH_OUTPUT: usize = 400;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Port {
    pub container_port: u16,
    pub protocol: String,
    pub host_ip: Option<String>,
    pub host_port: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Kube {
    pub pod: String,
    pub namespace: Option<String>,
    pub container: Option<String>,
}

/// One container in the list (cheap: everything comes from one inspect).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    /// The short id (12 characters).
    pub id: String,
    pub name: String,
    pub image: String,
    /// created / running / paused / restarting / removing / exited / dead
    pub state: String,
    /// starting / healthy / unhealthy, when it has a health check.
    pub health: Option<String>,
    pub exit_code: i64,
    pub oom_killed: bool,
    /// Unix ms; 0 when never.
    pub created_at: u64,
    pub started_at: u64,
    pub finished_at: u64,
    pub restart_count: u64,
    pub project: Option<String>,
    pub service: Option<String>,
    pub ports: Vec<Port>,
    pub kube: Option<Kube>,
}

impl Container {
    /// Stopped on its own with an error (not `docker stop`, which ends with
    /// 0, 130, 137 or 143), or killed for running out of memory.
    pub fn crashed(&self) -> bool {
        matches!(self.state.as_str(), "exited" | "dead")
            && (self.oom_killed || !matches!(self.exit_code, 0 | 130 | 137 | 143))
    }
}

fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    path.iter()
        .try_fold(v, |v, k| v.get(k))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

fn labels(v: &Value) -> BTreeMap<String, String> {
    v.pointer("/Config/Labels")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// RFC 3339 → Unix ms. Docker writes `0001-01-01T00:00:00Z` for "never".
pub fn time_ms(iso: Option<&str>) -> u64 {
    let Some(iso) = iso else { return 0 };
    chrono::DateTime::parse_from_rfc3339(iso)
        .ok()
        .and_then(|t| u64::try_from(t.timestamp_millis()).ok())
        .unwrap_or(0)
}

fn ports(v: &Value) -> Vec<Port> {
    let Some(map) = v
        .pointer("/NetworkSettings/Ports")
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (key, bindings) in map {
        let (port, protocol) = key.split_once('/').unwrap_or((key, "tcp"));
        let Ok(container_port) = port.parse() else {
            continue;
        };
        let bindings = bindings.as_array().map(Vec::as_slice).unwrap_or_default();
        if bindings.is_empty() {
            out.push(Port {
                container_port,
                protocol: protocol.into(),
                host_ip: None,
                host_port: None,
            });
        }
        for b in bindings {
            let host_port = str_at(b, &["HostPort"]).and_then(|p| p.parse().ok());
            // The same port on IPv4 and IPv6 is one port to the user.
            if out
                .iter()
                .any(|p: &Port| p.container_port == container_port && p.host_port == host_port)
            {
                continue;
            }
            out.push(Port {
                container_port,
                protocol: protocol.into(),
                host_ip: str_at(b, &["HostIp"]).map(String::from),
                host_port,
            });
        }
    }
    out.sort_by_key(|p| (p.host_port.is_none(), p.container_port));
    out
}

fn kube(labels: &BTreeMap<String, String>) -> Option<Kube> {
    Some(Kube {
        pod: labels.get("io.kubernetes.pod.name")?.clone(),
        namespace: labels.get("io.kubernetes.pod.namespace").cloned(),
        container: labels.get("io.kubernetes.container.name").cloned(),
    })
}

pub fn container(v: &Value) -> Option<Container> {
    let id: String = str_at(v, &["Id"])?.chars().take(12).collect();
    let labels = labels(v);
    let state = v.get("State").cloned().unwrap_or_default();
    Some(Container {
        name: str_at(v, &["Name"])
            .unwrap_or(&id)
            .trim_start_matches('/')
            .to_string(),
        id,
        image: str_at(v, &["Config", "Image"])
            .unwrap_or_default()
            .to_string(),
        state: str_at(&state, &["Status"]).unwrap_or("unknown").to_string(),
        health: str_at(&state, &["Health", "Status"]).map(String::from),
        exit_code: state["ExitCode"].as_i64().unwrap_or(0),
        oom_killed: state["OOMKilled"].as_bool().unwrap_or(false),
        created_at: time_ms(str_at(v, &["Created"])),
        started_at: time_ms(str_at(&state, &["StartedAt"])),
        finished_at: time_ms(str_at(&state, &["FinishedAt"])),
        restart_count: v["RestartCount"].as_u64().unwrap_or(0),
        project: labels.get("com.docker.compose.project").cloned(),
        service: labels.get("com.docker.compose.service").cloned(),
        ports: ports(v),
        kube: kube(&labels),
    })
}

/// A path as the user knows it: Docker Desktop's `/run/desktop/mnt/host/c/x`
/// is `C:\x` on Windows.
pub fn host_path(path: &str) -> String {
    let Some(rest) = path.strip_prefix(DESKTOP_HOST) else {
        return path.to_string();
    };
    let mut parts = rest.splitn(2, '/');
    let drive = parts.next().unwrap_or_default();
    if drive.len() != 1 || !drive.chars().all(|c| c.is_ascii_alphabetic()) {
        return path.to_string();
    }
    let tail = parts.next().unwrap_or_default().replace('/', "\\");
    format!("{}:\\{tail}", drive.to_ascii_uppercase())
}

// --- details, for an unfolded container ---------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mount {
    /// volume / bind / tmpfs / npipe
    pub kind: String,
    pub name: Option<String>,
    pub source: Option<String>,
    pub destination: String,
    pub read_only: bool,
    pub driver: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    pub name: String,
    pub ip: Option<String>,
    pub gateway: Option<String>,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub status: String,
    pub failing_streak: u64,
    pub last_output: Option<String>,
    pub last_exit_code: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compose {
    pub project: String,
    pub service: Option<String>,
    pub working_dir: Option<String>,
    pub config_files: Vec<String>,
    pub number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BuildStep {
    pub created_by: String,
    pub size: String,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    pub id: String,
    pub tags: Vec<String>,
    pub digests: Vec<String>,
    pub created_at: u64,
    pub size: u64,
    pub platform: String,
    pub layers: usize,
    pub labels: BTreeMap<String, String>,
    /// The build's steps, newest first (`docker image history`).
    pub history: Vec<BuildStep>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub id: String,
    pub command: String,
    pub working_dir: Option<String>,
    pub restart_policy: String,
    pub platform: Option<String>,
    pub hostname: Option<String>,
    pub health: Option<Health>,
    pub error: Option<String>,
    pub mounts: Vec<Mount>,
    pub networks: Vec<Network>,
    pub compose: Option<Compose>,
    /// `io.kubernetes.*` labels, for a container a cluster runs.
    pub kube: BTreeMap<String, String>,
    /// Every other label.
    pub labels: BTreeMap<String, String>,
    pub image: Option<Image>,
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn cut(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

pub fn details(v: &Value) -> Option<Details> {
    let all = labels(v);
    let id = str_at(v, &["Id"])?.to_string();
    let mut command = strings(v.pointer("/Config/Entrypoint"));
    command.extend(strings(v.pointer("/Config/Cmd")));

    let health = v.pointer("/State/Health").map(|h| {
        let last = h["Log"].as_array().and_then(|l| l.last());
        Health {
            status: str_at(h, &["Status"]).unwrap_or("unknown").to_string(),
            failing_streak: h["FailingStreak"].as_u64().unwrap_or(0),
            last_output: last
                .and_then(|l| str_at(l, &["Output"]))
                .map(|o| cut(o, MAX_HEALTH_OUTPUT)),
            last_exit_code: last.and_then(|l| l["ExitCode"].as_i64()),
        }
    });

    // Docker Desktop keeps the Windows path of each bind in a label.
    let bind_source = |target: &str| {
        all.iter()
            .filter(|(k, v)| {
                k.starts_with("desktop.docker.io/binds/") && k.ends_with("/Target") && *v == target
            })
            .find_map(|(k, _)| all.get(&k.replace("/Target", "/Source")).cloned())
    };
    let mounts = v["Mounts"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let destination = str_at(m, &["Destination"]).unwrap_or_default().to_string();
            let kind = str_at(m, &["Type"]).unwrap_or("volume").to_string();
            let source = if kind == "bind" {
                bind_source(&destination).or_else(|| str_at(m, &["Source"]).map(host_path))
            } else {
                str_at(m, &["Source"]).map(String::from)
            };
            Mount {
                name: str_at(m, &["Name"]).map(String::from),
                source,
                read_only: !m["RW"].as_bool().unwrap_or(true),
                driver: str_at(m, &["Driver"]).map(String::from),
                destination,
                kind,
            }
        })
        .collect();

    let networks = v
        .pointer("/NetworkSettings/Networks")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(name, n)| Network {
                    name: name.clone(),
                    ip: str_at(n, &["IPAddress"]).map(String::from),
                    gateway: str_at(n, &["Gateway"]).map(String::from),
                    aliases: strings(n.get("Aliases")),
                })
                .collect()
        })
        .unwrap_or_default();

    let compose = all
        .get("com.docker.compose.project")
        .map(|project| Compose {
            project: project.clone(),
            service: all.get("com.docker.compose.service").cloned(),
            working_dir: all.get("com.docker.compose.project.working_dir").cloned(),
            config_files: all
                .get("com.docker.compose.project.config_files")
                .map(|f| f.split(',').map(String::from).collect())
                .unwrap_or_default(),
            number: all.get("com.docker.compose.container-number").cloned(),
        });

    let restart = str_at(v, &["HostConfig", "RestartPolicy", "Name"]).unwrap_or("no");
    let retries = v
        .pointer("/HostConfig/RestartPolicy/MaximumRetryCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    Some(Details {
        id,
        command: command.join(" "),
        working_dir: str_at(v, &["Config", "WorkingDir"]).map(String::from),
        restart_policy: if retries > 0 {
            format!("{restart}:{retries}")
        } else {
            restart.to_string()
        },
        platform: str_at(v, &["Platform"]).map(String::from),
        hostname: str_at(v, &["Config", "Hostname"]).map(String::from),
        health,
        error: str_at(v, &["State", "Error"]).map(String::from),
        mounts,
        networks,
        compose,
        kube: all
            .iter()
            .filter(|(k, _)| k.starts_with(KUBE))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        labels: all
            .iter()
            .filter(|(k, _)| {
                !k.starts_with(KUBE)
                    && !k.starts_with(COMPOSE)
                    && !k.starts_with("desktop.docker.io/")
            })
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        image: None,
    })
}

/// `docker image inspect` (one image).
pub fn image(v: &Value) -> Option<Image> {
    let os = str_at(v, &["Os"]).unwrap_or_default();
    let arch = str_at(v, &["Architecture"]).unwrap_or_default();
    Some(Image {
        id: str_at(v, &["Id"])?.to_string(),
        tags: strings(v.get("RepoTags")),
        digests: strings(v.get("RepoDigests")),
        created_at: time_ms(str_at(v, &["Created"])),
        size: v["Size"].as_u64().unwrap_or(0),
        platform: [os, arch]
            .iter()
            .filter(|s| !s.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join("/"),
        layers: v
            .pointer("/RootFS/Layers")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        labels: v
            .pointer("/Config/Labels")
            .and_then(Value::as_object)
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default(),
        history: Vec::new(),
    })
}

/// `docker image history --format '{{json .}}'`, one step per line.
pub fn history(text: &str, max: usize) -> Vec<BuildStep> {
    text.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .map(|v| BuildStep {
            created_by: cut(
                str_at(&v, &["CreatedBy"])
                    .unwrap_or_default()
                    .trim_start_matches("/bin/sh -c #(nop) ")
                    .trim_start_matches("|1 "),
                300,
            ),
            size: str_at(&v, &["Size"]).unwrap_or_default().to_string(),
            created: str_at(&v, &["CreatedSince"])
                .unwrap_or_default()
                .to_string(),
        })
        .filter(|s| !s.created_by.is_empty())
        .take(max)
        .collect()
}

// --- news worth a toast -------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// Unique per occurrence; the island toasts each key once.
    pub key: String,
    /// crashed / oom / unhealthy
    pub kind: &'static str,
    pub container: String,
    pub id: String,
    pub exit_code: i64,
    /// Unix ms.
    pub at: u64,
}

/// What went wrong between two polls.
pub fn events(before: &[Container], now: &[Container], at: u64) -> Vec<Event> {
    let mut out = Vec::new();
    for c in now {
        let Some(old) = before.iter().find(|o| o.id == c.id) else {
            continue;
        };
        let event = |kind: &'static str, stamp: u64| Event {
            key: format!("{}:{kind}:{stamp}", c.id),
            kind,
            container: c.name.clone(),
            id: c.id.clone(),
            exit_code: c.exit_code,
            at,
        };
        // A new stop: its time moved (a restart loop shows each crash once).
        if c.crashed() && (!old.crashed() || old.finished_at != c.finished_at) {
            out.push(event(
                if c.oom_killed { "oom" } else { "crashed" },
                c.finished_at,
            ));
        }
        if c.health.as_deref() == Some("unhealthy") && old.health.as_deref() != Some("unhealthy") {
            out.push(event("unhealthy", at));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn inspect() -> Value {
        json!({
            "Id": "a2c25381c1e72fb37e91c6562eb35aa19d112124b42322db6d51f33144de91fc",
            "Name": "/ditest-web-1",
            "Created": "2026-11-18T01:59:38.148471413Z",
            "RestartCount": 2,
            "Platform": "linux",
            "State": {
                "Status": "running", "ExitCode": 0, "OOMKilled": false,
                "StartedAt": "2026-11-18T01:59:38.333697553Z",
                "FinishedAt": "0001-01-01T00:00:00Z",
                "Health": {"Status": "healthy", "FailingStreak": 0,
                    "Log": [{"ExitCode": 0, "Output": "x".repeat(2000)}]}
            },
            "Config": {
                "Image": "nginx:alpine",
                "Entrypoint": ["/docker-entrypoint.sh"],
                "Cmd": ["nginx", "-g", "daemon off;"],
                "Env": ["SECRET=hunter2"],
                "Labels": {
                    "com.docker.compose.project": "ditest",
                    "com.docker.compose.service": "web",
                    "com.docker.compose.project.config_files": "C:\\x\\compose.yaml",
                    "desktop.docker.io/binds/1/Source": "C:\\Users\\me\\site",
                    "desktop.docker.io/binds/1/Target": "/host",
                    "maintainer": "NGINX"
                }
            },
            "HostConfig": {"RestartPolicy": {"Name": "on-failure", "MaximumRetryCount": 3}},
            "Mounts": [
                {"Type": "volume", "Name": "ditest_data", "Source": "/var/lib/docker/volumes/ditest_data/_data",
                 "Destination": "/data", "Driver": "local", "RW": true},
                {"Type": "bind", "Source": "/run/desktop/mnt/host/c/Users/me/site", "Destination": "/host", "RW": false}
            ],
            "NetworkSettings": {
                "Ports": {
                    "80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "18080"}, {"HostIp": "::", "HostPort": "18080"}],
                    "443/tcp": null
                },
                "Networks": {"ditest_default": {"IPAddress": "172.18.0.2", "Gateway": "172.18.0.1", "Aliases": ["web"]}}
            }
        })
    }

    #[test]
    fn reads_a_container() {
        let c = container(&inspect()).unwrap();
        assert_eq!(c.id, "a2c25381c1e7");
        assert_eq!(c.name, "ditest-web-1");
        assert_eq!(c.state, "running");
        assert_eq!(c.health.as_deref(), Some("healthy"));
        assert_eq!(c.project.as_deref(), Some("ditest"));
        assert_eq!(c.service.as_deref(), Some("web"));
        assert_eq!(c.restart_count, 2);
        assert!(c.started_at > 0);
        assert_eq!(c.finished_at, 0, "Docker's year 1 means never");
        // IPv4 and IPv6 bindings of one port are one entry; unpublished ports come last.
        assert_eq!(c.ports.len(), 2);
        assert_eq!(c.ports[0].host_port, Some(18080));
        assert_eq!(c.ports[1].container_port, 443);
        assert_eq!(c.ports[1].host_port, None);
        assert!(c.kube.is_none());
    }

    #[test]
    fn details_leave_secrets_out_and_find_windows_paths() {
        let d = details(&inspect()).unwrap();
        let text = serde_json::to_string(&d).unwrap();
        assert!(
            !text.contains("hunter2"),
            "environment variables must never be sent"
        );
        assert_eq!(d.command, "/docker-entrypoint.sh nginx -g daemon off;");
        assert_eq!(d.restart_policy, "on-failure:3");
        let health = d.health.unwrap();
        assert!(health.last_output.unwrap().chars().count() <= MAX_HEALTH_OUTPUT + 1);
        assert_eq!(d.mounts[0].name.as_deref(), Some("ditest_data"));
        assert_eq!(d.mounts[1].source.as_deref(), Some("C:\\Users\\me\\site"));
        assert!(d.mounts[1].read_only);
        assert_eq!(d.networks[0].ip.as_deref(), Some("172.18.0.2"));
        let compose = d.compose.unwrap();
        assert_eq!(compose.config_files, vec!["C:\\x\\compose.yaml"]);
        // Compose and Docker Desktop labels have their own sections.
        assert_eq!(d.labels.len(), 1);
        assert_eq!(d.labels["maintainer"], "NGINX");
    }

    #[test]
    fn kubernetes_containers_keep_their_pod() {
        let mut v = inspect();
        v["Config"]["Labels"] = json!({
            "io.kubernetes.pod.name": "api-7d9f",
            "io.kubernetes.pod.namespace": "default",
            "io.kubernetes.container.name": "api"
        });
        let c = container(&v).unwrap();
        let kube = c.kube.unwrap();
        assert_eq!(kube.pod, "api-7d9f");
        assert_eq!(kube.namespace.as_deref(), Some("default"));
        assert_eq!(details(&v).unwrap().kube.len(), 3);
    }

    #[test]
    fn docker_desktop_paths_become_windows_paths() {
        assert_eq!(
            host_path("/run/desktop/mnt/host/c/Users/me/x"),
            "C:\\Users\\me\\x"
        );
        assert_eq!(
            host_path("/run/desktop/mnt/host/wsl/x"),
            "/run/desktop/mnt/host/wsl/x"
        );
        assert_eq!(host_path("/home/me/x"), "/home/me/x");
    }

    fn with(state: &str, exit_code: i64, finished_at: u64, health: Option<&str>) -> Container {
        let mut c = container(&inspect()).unwrap();
        c.state = state.into();
        c.exit_code = exit_code;
        c.finished_at = finished_at;
        c.health = health.map(String::from);
        c
    }

    #[test]
    fn only_real_crashes_count() {
        assert!(with("exited", 3, 1, None).crashed());
        assert!(!with("exited", 0, 1, None).crashed());
        assert!(!with("exited", 143, 1, None).crashed(), "docker stop");
        assert!(
            !with("exited", 137, 1, None).crashed(),
            "docker stop past its timeout"
        );
        assert!(!with("running", 3, 1, None).crashed());
        let mut oom = with("exited", 137, 1, None);
        oom.oom_killed = true;
        assert!(oom.crashed());
    }

    #[test]
    fn events_fire_once_per_crash() {
        let running = [with("running", 0, 0, Some("healthy"))];
        let crashed = [with("exited", 1, 100, None)];
        let e = events(&running, &crashed, 5);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].kind, "crashed");
        // Same crash at the next poll: nothing new.
        assert!(events(&crashed, &crashed, 6).is_empty());
        // A restart loop: it crashed again, later.
        let again = [with("exited", 1, 200, None)];
        assert_eq!(events(&crashed, &again, 7).len(), 1);
        // A container seen for the first time says nothing.
        assert!(events(&[], &crashed, 8).is_empty());
        // Health turning bad.
        let sick = [with("running", 0, 0, Some("unhealthy"))];
        let e = events(&running, &sick, 9);
        assert_eq!(e[0].kind, "unhealthy");
        assert!(events(&sick, &sick, 10).is_empty());
    }

    #[test]
    fn build_history_reads_cli_lines() {
        let text = r#"{"CreatedBy":"CMD [\"nginx\"]","Size":"0B","CreatedSince":"2 weeks ago"}
{"CreatedBy":"/bin/sh -c #(nop) ADD file:abc in / ","Size":"8MB","CreatedSince":"3 weeks ago"}
not json
{"CreatedBy":"","Size":"0B","CreatedSince":"x"}"#;
        let h = history(text, 10);
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].created_by, "CMD [\"nginx\"]");
        assert_eq!(h[1].created_by, "ADD file:abc in /");
    }
}
