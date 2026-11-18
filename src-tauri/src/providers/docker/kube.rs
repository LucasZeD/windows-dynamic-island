//! Kubernetes: the pods of kubectl's current context, read on demand while
//! the Kubernetes view is open (never in the background).

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::cli::{self, CliError};
use super::model::time_ms;

const TIMEOUT: Duration = Duration::from_secs(8);
/// kubectl's own deadline for the API server, under ours.
const REQUEST_TIMEOUT: &str = "--request-timeout=6s";
const MAX_PODS: usize = 300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodContainer {
    pub name: String,
    pub image: String,
    pub ready: bool,
    pub restarts: u64,
    /// running / waiting / terminated
    pub state: String,
    /// CrashLoopBackOff, ImagePullBackOff, Completed, OOMKilled…
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pod {
    pub namespace: String,
    pub name: String,
    /// Pending / Running / Succeeded / Failed / Unknown
    pub phase: String,
    pub node: Option<String>,
    pub ip: Option<String>,
    pub created_at: u64,
    /// `Deployment/api`, through its ReplicaSet when there is one.
    pub owner: Option<String>,
    pub containers: Vec<PodContainer>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cluster {
    /// kubectl is installed.
    pub available: bool,
    pub context: Option<String>,
    pub pods: Vec<Pod>,
    /// "noContext", "timeout", or what kubectl said.
    pub error: Option<String>,
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn owner(meta: &Value) -> Option<String> {
    let o = meta.get("ownerReferences")?.as_array()?.first()?;
    let kind = s(o, "kind")?;
    let name = s(o, "name")?;
    // A ReplicaSet named `api-7d9f8b` belongs to the Deployment `api`.
    if kind == "ReplicaSet"
        && let Some((deployment, _)) = name.rsplit_once('-')
    {
        return Some(format!("Deployment/{deployment}"));
    }
    Some(format!("{kind}/{name}"))
}

pub fn pod(v: &Value) -> Option<Pod> {
    let meta = v.get("metadata")?;
    let spec = &v["spec"];
    let status = &v["status"];
    let statuses = status["containerStatuses"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let containers = spec["containers"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|c| {
            let name = s(c, "name")?;
            let st = statuses
                .iter()
                .find(|st| s(st, "name").as_deref() == Some(&name));
            let (state, reason) = st
                .and_then(|st| st["state"].as_object())
                .and_then(|m| m.iter().next())
                .map(|(k, v)| (k.clone(), s(v, "reason")))
                .unwrap_or_else(|| ("waiting".into(), None));
            Some(PodContainer {
                image: s(c, "image").unwrap_or_default(),
                ready: st.and_then(|st| st["ready"].as_bool()).unwrap_or(false),
                restarts: st.and_then(|st| st["restartCount"].as_u64()).unwrap_or(0),
                state,
                reason,
                name,
            })
        })
        .collect();
    Some(Pod {
        namespace: s(meta, "namespace").unwrap_or_else(|| "default".into()),
        name: s(meta, "name")?,
        phase: s(status, "phase").unwrap_or_else(|| "Unknown".into()),
        node: s(spec, "nodeName"),
        ip: s(status, "podIP"),
        created_at: time_ms(meta["creationTimestamp"].as_str()),
        owner: owner(meta),
        containers,
    })
}

pub fn pods() -> Cluster {
    let mut cluster = Cluster {
        available: true,
        ..Default::default()
    };
    // Without a context kubectl tries localhost:8080, which is never it.
    match cli::kubectl(&["config", "current-context"], TIMEOUT) {
        Ok(ctx) if !ctx.trim().is_empty() => cluster.context = Some(ctx.trim().to_string()),
        Err(CliError::Missing) => {
            cluster.available = false;
            return cluster;
        }
        _ => {
            cluster.error = Some("noContext".into());
            return cluster;
        }
    }
    match cli::kubectl(
        &["get", "pods", "-A", "-o", "json", REQUEST_TIMEOUT],
        TIMEOUT,
    ) {
        Ok(text) => {
            let v: Value = serde_json::from_str(&text).unwrap_or_default();
            cluster.pods = v["items"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default()
                .iter()
                .filter_map(pod)
                .take(MAX_PODS)
                .collect();
        }
        Err(e) => cluster.error = Some(e.to_string()),
    }
    cluster
}

pub fn logs(
    namespace: &str,
    pod: &str,
    container: Option<&str>,
    tail: u32,
) -> Result<String, String> {
    if !cli::valid_name(namespace)
        || !cli::valid_name(pod)
        || container.is_some_and(|c| !cli::valid_name(c))
    {
        return Err("invalid name".into());
    }
    let tail = format!("--tail={tail}");
    let mut args = vec![
        "logs",
        pod,
        "-n",
        namespace,
        &tail,
        "--timestamps",
        REQUEST_TIMEOUT,
    ];
    if let Some(c) = container {
        args.extend(["-c", c]);
    }
    cli::kubectl(&args, TIMEOUT).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_a_pod() {
        let v = json!({
            "metadata": {
                "name": "api-7d9f8b-x2k4p", "namespace": "shop",
                "creationTimestamp": "2026-11-18T01:00:00Z",
                "ownerReferences": [{"kind": "ReplicaSet", "name": "api-7d9f8b"}]
            },
            "spec": {"nodeName": "docker-desktop", "containers": [
                {"name": "api", "image": "shop/api:1.2"},
                {"name": "sidecar", "image": "envoy:1"}
            ]},
            "status": {"phase": "Running", "podIP": "10.1.0.5", "containerStatuses": [
                {"name": "api", "ready": false, "restartCount": 7,
                 "state": {"waiting": {"reason": "CrashLoopBackOff"}}},
                {"name": "sidecar", "ready": true, "restartCount": 0,
                 "state": {"running": {"startedAt": "2026-11-18T01:00:05Z"}}}
            ]}
        });
        let p = pod(&v).unwrap();
        assert_eq!(p.namespace, "shop");
        assert_eq!(p.owner.as_deref(), Some("Deployment/api"));
        assert_eq!(p.node.as_deref(), Some("docker-desktop"));
        assert!(p.created_at > 0);
        assert_eq!(p.containers[0].reason.as_deref(), Some("CrashLoopBackOff"));
        assert_eq!(p.containers[0].restarts, 7);
        assert_eq!(p.containers[1].state, "running");
        assert!(p.containers[1].ready);
    }

    #[test]
    fn a_pod_not_scheduled_yet_is_fine() {
        let v = json!({
            "metadata": {"name": "job-1", "ownerReferences": [{"kind": "Job", "name": "job"}]},
            "spec": {"containers": [{"name": "c", "image": "busybox"}]},
            "status": {"phase": "Pending"}
        });
        let p = pod(&v).unwrap();
        assert_eq!(p.namespace, "default");
        assert_eq!(p.owner.as_deref(), Some("Job/job"));
        assert_eq!(p.containers[0].state, "waiting");
    }

    #[test]
    fn log_arguments_are_checked() {
        assert!(logs("--all", "p", None, 10).is_err());
        assert!(logs("ns", "p", Some("-c"), 10).is_err());
    }
}
