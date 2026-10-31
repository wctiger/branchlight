use super::{
    inspection::{invalid, resolve},
    runner::{run_git, run_git_with_env},
};
use crate::models::{GitError, GitOutput, RepositoryOperation};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
pub(crate) struct PlanCommit {
    pub hash: String,
    pub subject: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PlanAction {
    Pick,
    Drop,
    Squash,
    Reword,
}
#[derive(Deserialize)]
pub(crate) struct PlanStep {
    pub hash: String,
    pub action: PlanAction,
    pub message: Option<String>,
}

/// Inclusive, oldest-first plan on the current branch, bounded independently of the UI.
pub(crate) fn inspect(repository: &Path, revision: &str) -> Result<Vec<PlanCommit>, GitError> {
    let oid = resolve(repository, revision)?;
    run_git(repository, &["merge-base", "--is-ancestor", &oid, "HEAD"])?;
    let parents = run_git(repository, &["rev-list", "--parents", "-n", "1", &oid])?;
    let parent = parents.stdout.split_whitespace().nth(1);
    let range = parent.map_or_else(|| "HEAD".to_owned(), |p| format!("{p}..HEAD"));
    if !run_git(repository, &["rev-list", "--merges", &range])?
        .stdout
        .is_empty()
    {
        return Err(invalid(
            "This plan spans merge commits. Choose a linear range or use an external Git tool.",
        ));
    }
    let log = run_git(
        repository,
        &[
            "log",
            "--reverse",
            "--topo-order",
            "--format=%H %s",
            "-n",
            "201",
            &range,
        ],
    )?;
    let entries: Vec<_> = log
        .stdout
        .lines()
        .map(|line| {
            let (hash, subject) = line.split_once(' ').unwrap_or((line, ""));
            PlanCommit {
                hash: hash.into(),
                subject: subject.into(),
            }
        })
        .collect();
    if entries.is_empty() || entries.len() > 200 {
        return Err(invalid("Choose a range of 1–200 commits."));
    }
    Ok(entries)
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn plan_directory(repository: &Path) -> Result<PathBuf, GitError> {
    let output = run_git(repository, &["rev-parse", "--absolute-git-dir"])?;
    Ok(PathBuf::from(output.stdout.trim_end_matches(['\r', '\n'])).join("branchlight-rebase-plan"))
}
fn io_error(error: std::io::Error) -> GitError {
    invalid(&format!("Unable to prepare rebase plan files: {error}"))
}

/// Removes only known generated files; unrelated files prevent directory removal.
pub(crate) fn cleanup(repository: &Path) {
    let Ok(directory) = plan_directory(repository) else {
        return;
    };
    if !fs::symlink_metadata(&directory).is_ok_and(|metadata| metadata.file_type().is_dir()) {
        return;
    }
    for i in 0..200 {
        let _ = fs::remove_file(directory.join(format!("message-{i}")));
    }
    let _ = fs::remove_file(directory.join("todo"));
    let _ = fs::remove_dir(directory);
}

/// A conflicting pick leaves its following amend pending. Skip must omit both,
/// or that amend would rewrite the preceding commit instead. Match only the
/// exact generated command for REBASE_HEAD, leaving other todo commands alone.
pub(crate) fn skip_pending_reword(repository: &Path) -> Result<(), GitError> {
    let directory = plan_directory(repository)?;
    let original = match fs::read_to_string(directory.join("todo")) {
        Ok(todo) => todo,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(error)),
    };
    let Ok(stopped) = run_git(repository, &["rev-parse", "--verify", "REBASE_HEAD"]) else {
        return Ok(());
    };
    let pick = format!("pick {}", stopped.stdout.trim());
    let mut lines = original.lines();
    let Some(amend) = lines.find(|line| *line == pick).and_then(|_| lines.next()) else {
        return Ok(());
    };
    if !amend.starts_with("exec git -c commit.cleanup=verbatim commit --amend --only --file=") {
        return Ok(());
    }
    let todo_path = directory
        .parent()
        .unwrap()
        .join("rebase-merge/git-rebase-todo");
    let todo = fs::read_to_string(&todo_path).map_err(io_error)?;
    let mut offset = 0;
    for line in todo.split_inclusive('\n') {
        let command = line.trim_end_matches(['\r', '\n']);
        if !command.trim().is_empty() && !command.trim_start().starts_with('#') {
            if command == amend {
                let mut updated = todo.clone();
                updated.replace_range(offset..offset + line.len(), "");
                fs::write(todo_path, updated).map_err(io_error)?;
            }
            break;
        }
        offset += line.len();
    }
    Ok(())
}

/// Called only after the common history executor rechecks branch, HEAD and operation state.
pub(crate) fn execute(
    repository: &Path,
    revision: &str,
    steps: Vec<PlanStep>,
) -> Result<GitOutput, GitError> {
    if !run_git(repository, &["status", "--porcelain"])?
        .stdout
        .is_empty()
    {
        return Err(invalid(
            "Commit or stash all changes before interactive rebase.",
        ));
    }
    let commits = inspect(repository, revision)?;
    let expected: HashSet<_> = commits.iter().map(|c| c.hash.as_str()).collect();
    let supplied: HashSet<_> = steps.iter().map(|s| s.hash.as_str()).collect();
    if steps.len() != commits.len() || supplied.len() != steps.len() || expected != supplied {
        return Err(invalid("The plan must contain every reviewed commit exactly once. Refresh and review it again."));
    }
    let mut retained = false;
    for step in &steps {
        match step.action {
            PlanAction::Squash if !retained => {
                return Err(invalid("Squash needs a preceding retained commit."))
            }
            PlanAction::Reword
                if step
                    .message
                    .as_ref()
                    .is_none_or(|m| m.trim().is_empty() || m.contains('\0')) =>
            {
                return Err(invalid("Each reword step needs a nonempty commit message."))
            }
            PlanAction::Drop => {}
            _ => retained = true,
        }
    }
    if !retained {
        return Err(invalid("Retain at least one commit in the plan."));
    }
    let directory = plan_directory(repository)?;
    if directory.to_string_lossy().contains(['\n', '\r']) {
        return Err(invalid("Interactive rebase cannot use metadata paths containing line breaks. Use an external Git tool for this repository."));
    }
    // The history executor verified no active operation. External completion or
    // a crash can leave our generated files behind; preserve unrelated files.
    cleanup(repository);
    fs::create_dir(&directory).map_err(io_error)?;
    let prepare = (|| {
        let mut todo = String::new();
        for (i, step) in steps.iter().enumerate() {
            let command = match step.action {
                PlanAction::Drop => "drop",
                PlanAction::Squash => "squash",
                _ => "pick",
            };
            todo.push_str(&format!("{command} {}\n", step.hash));
            if matches!(step.action, PlanAction::Reword) {
                let message_path = directory.join(format!("message-{i}"));
                fs::write(&message_path, step.message.as_ref().unwrap()).map_err(io_error)?;
                // Only a fixed backend command enters the todo. User text stays in a data file.
                todo.push_str(&format!(
                    "exec git -c commit.cleanup=verbatim commit --amend --only --file={}\n",
                    quote(&message_path.to_string_lossy())
                ));
            }
        }
        let todo_path = directory.join("todo");
        fs::write(&todo_path, todo).map_err(io_error)?;
        let sequence_editor = format!("cp {}", quote(&todo_path.to_string_lossy()));
        let parents = run_git(
            repository,
            &["rev-list", "--parents", "-n", "1", &commits[0].hash],
        )?;
        let parent = parents.stdout.split_whitespace().nth(1);
        let mut args = vec![
            "-c",
            "rebase.autoStash=false",
            "-c",
            "rebase.abbreviateCommands=false",
            "rebase",
            "--interactive",
            "--no-autosquash",
            "--no-update-refs",
            "--reapply-cherry-picks",
            "--keep-empty",
        ];
        args.push(parent.unwrap_or("--root"));
        run_git_with_env(
            repository,
            &args,
            &[
                ("GIT_SEQUENCE_EDITOR", &sequence_editor),
                ("GIT_EDITOR", "true"),
                ("GIT_TERMINAL_PROMPT", "0"),
            ],
        )
    })();
    if super::conflicts::get_repository_operation(repository)
        .is_ok_and(|op| op == RepositoryOperation::None)
    {
        cleanup(repository);
    }
    prepare
}
