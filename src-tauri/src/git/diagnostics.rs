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

/// Retains a bounded, metadata-only session log of recognized Git operations.
pub(super) fn record(
    repository: &Path,
    arguments: &[&str],
    exit_code: Option<i32>,
    duration_ms: u128,
) {
    // Retain command names only: arguments/output may contain messages, credentials,
    // file contents, URLs or arbitrary secrets from hooks. Never persist this log.
    let Some(command) = operation_name(arguments) else {
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
/// Identifies only the subcommand, skipping supported Git global options and
/// their values. Never inspect filenames, revisions, configuration or messages.
fn operation_name<'a>(arguments: &[&'a str]) -> Option<&'a str> {
    let mut args = arguments.iter().copied();
    let command = loop {
        match args.next()? {
            "-c" | "-C" | "--git-dir" | "--work-tree" | "--namespace" | "--config-env" => {
                args.next()?;
            }
            "--no-pager"
            | "--paginate"
            | "-p"
            | "-P"
            | "--literal-pathspecs"
            | "--no-literal-pathspecs"
            | "--no-optional-locks" => {}
            value
                if value.starts_with("--git-dir=")
                    || value.starts_with("--work-tree=")
                    || value.starts_with("--namespace=")
                    || value.starts_with("--config-env=")
                    || (value.starts_with("-c") && value.len() > 2)
                    || (value.starts_with("-C") && value.len() > 2) => {}
            "--" => break args.next()?,
            value if value.starts_with('-') => return None,
            command => break command,
        }
    };
    matches!(
        command,
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
    .then_some(command)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Diagnostics {
    version: String,
    path_candidate: Option<String>,
    logs: Vec<LogEntry>,
}
/// Reports the runner's Git version, a PATH candidate (not proof of OS selection),
/// and session entries for this repository.
pub(crate) fn inspect(repository: &Path) -> Result<Diagnostics, GitError> {
    let version = run_git(repository, &["--version"])?
        .stdout
        .trim()
        .to_owned();
    let path_candidate = std::env::var_os("PATH")
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|p| p.join(if cfg!(windows) { "git.exe" } else { "git" }))
                .find(|p| p.is_file())
        })
        .map(|p| p.to_string_lossy().into_owned());
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
        path_candidate,
        logs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_commands_cannot_log_filenames_as_operations() {
        for args in [
            vec!["blame", "--line-porcelain", "HEAD", "--", "commit"],
            vec!["--literal-pathspecs", "log", "--", "reset"],
            vec!["-c", "core.pager=commit", "blame", "--", "push"],
            vec!["-C", "commit", "status"],
            vec!["--git-dir=reset", "--no-pager", "show", "commit"],
            vec!["--unknown-global-option", "commit"],
            vec!["-c"],
        ] {
            assert_eq!(operation_name(&args), None, "{args:?}");
        }
        assert_eq!(
            operation_name(&["-c", "core.hooksPath=", "commit", "-m", "reset"]),
            Some("commit")
        );
        assert_eq!(
            operation_name(&[
                "-C",
                "commit",
                "-cuser.name=reset",
                "--no-pager",
                "rebase",
                "main"
            ]),
            Some("rebase")
        );
        assert_eq!(
            operation_name(&["--literal-pathspecs", "restore", "--", "commit"]),
            Some("restore")
        );
    }

    #[test]
    fn path_scan_is_serialized_as_a_candidate_not_the_selected_executable() {
        let data = inspect(&std::env::current_dir().unwrap()).unwrap();
        let value = serde_json::to_value(data).unwrap();
        assert!(value["version"]
            .as_str()
            .unwrap()
            .starts_with("git version "));
        assert!(value.get("pathCandidate").is_some());
        assert!(value.get("executable").is_none());
    }
}
