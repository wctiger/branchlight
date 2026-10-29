use super::runner::run_git;
use crate::models::GitError;
use serde::Serialize;
use std::{
    collections::VecDeque,
    path::Path,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogEntry {
    repository: String,
    command: String,
    timestamp: u64,
    exit_code: Option<i32>,
    duration_ms: u128,
}
static LOG: OnceLock<Mutex<VecDeque<LogEntry>>> = OnceLock::new();

pub(super) fn record(
    repository: &Path,
    arguments: &[&str],
    exit_code: Option<i32>,
    duration_ms: u128,
) {
    // Retain command names only: arguments/output may contain messages, credentials,
    // file contents, URLs or arbitrary secrets from hooks. Never persist this log.
    let command = arguments.iter().find(|a| {
        matches!(
            **a,
            "commit"
                | "reset"
                | "cherry-pick"
                | "revert"
                | "rebase"
                | "merge"
                | "push"
                | "pull"
                | "fetch"
                | "switch"
                | "branch"
                | "stash"
                | "add"
                | "restore"
                | "clone"
                | "init"
        )
    });
    let Some(command) = command else {
        return;
    };
    if let Ok(mut entries) = LOG.get_or_init(Mutex::default).lock() {
        entries.push_back(LogEntry {
            repository: repository.to_string_lossy().into_owned(),
            command: command.to_string(),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            exit_code,
            duration_ms,
        });
        while entries.len() > 200 {
            entries.pop_front();
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Diagnostics {
    version: String,
    executable: String,
    logs: Vec<LogEntry>,
}
pub(crate) fn inspect(repository: &Path) -> Result<Diagnostics, GitError> {
    let version = run_git(repository, &["--version"])?
        .stdout
        .trim()
        .to_owned();
    let executable = std::env::var_os("PATH")
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|p| p.join(if cfg!(windows) { "git.exe" } else { "git" }))
                .find(|p| p.is_file())
        })
        .map_or_else(
            || "git (system PATH)".to_owned(),
            |p| p.to_string_lossy().into_owned(),
        );
    let logs = LOG
        .get_or_init(Mutex::default)
        .lock()
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| Path::new(&entry.repository) == repository)
                .cloned()
                .rev()
                .collect()
        })
        .unwrap_or_default();
    Ok(Diagnostics {
        version,
        executable,
        logs,
    })
}
