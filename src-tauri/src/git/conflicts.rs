use std::path::{Path, PathBuf};

use crate::models::{GitError, GitOutput, RepositoryOperation};

use super::runner::run_git;

/// Detects merge and rebase state from Git's per-worktree metadata paths.
pub(crate) fn get_repository_operation(repository: &Path) -> Result<RepositoryOperation, GitError> {
    let rebase_merge = resolve_git_path(repository, "rebase-merge")?;
    let rebase_apply = resolve_git_path(repository, "rebase-apply")?;
    if rebase_merge.exists() || rebase_apply.exists() {
        return Ok(RepositoryOperation::Rebase);
    }

    let merge_head = resolve_git_path(repository, "MERGE_HEAD")?;
    if merge_head.exists() {
        return Ok(RepositoryOperation::Merge);
    }

    for (marker, operation) in [
        ("CHERRY_PICK_HEAD", RepositoryOperation::CherryPick),
        ("REVERT_HEAD", RepositoryOperation::Revert),
    ] {
        if resolve_git_path(repository, marker)?.exists() {
            return Ok(operation);
        }
    }
    // Multi-step sequencers can stop between commits without a *_HEAD file.
    let todo = resolve_git_path(repository, "sequencer/todo")?;
    if let Ok(contents) = std::fs::read_to_string(todo) {
        if contents.starts_with("pick ") {
            return Ok(RepositoryOperation::CherryPick);
        }
        if contents.starts_with("revert ") {
            return Ok(RepositoryOperation::Revert);
        }
    }
    Ok(RepositoryOperation::None)
}

/// Aborts only an active merge so an unrelated operation cannot be interrupted.
pub(crate) fn abort_merge(repository: &Path) -> Result<GitOutput, GitError> {
    require_operation(repository, RepositoryOperation::Merge)?;
    run_git(repository, &["merge", "--abort"])
}

/// Aborts only an active rebase so an unrelated operation cannot be interrupted.
pub(crate) fn abort_rebase(repository: &Path) -> Result<GitOutput, GitError> {
    require_operation(repository, RepositoryOperation::Rebase)?;
    let output = run_git(repository, &["rebase", "--abort"])?;
    super::rebase_plan::cleanup(repository);
    Ok(output)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RebaseRecovery {
    Continue,
    Skip,
}

/// Rechecks per-worktree state under the scheduler lock before resuming Git.
pub(crate) fn recover_rebase(
    repository: &Path,
    action: RebaseRecovery,
) -> Result<GitOutput, GitError> {
    require_operation(repository, RepositoryOperation::Rebase)?;
    let flag = match action {
        RebaseRecovery::Continue => {
            if !run_git(repository, &["ls-files", "--unmerged", "-z"])?
                .stdout
                .is_empty()
            {
                return Err(GitError::InvalidOperationInput {
                    message: "Resolve and stage all conflicts before continuing the rebase.".into(),
                });
            }
            "--continue"
        }
        RebaseRecovery::Skip => "--skip",
    };
    // Reuse the commit message already prepared by rebase; never open an editor
    // that cannot be interacted with from the desktop process.
    let output =
        super::runner::run_git_with_env(repository, &["rebase", flag], &[("GIT_EDITOR", "true")]);
    if get_repository_operation(repository).is_ok_and(|op| op == RepositoryOperation::None) {
        super::rebase_plan::cleanup(repository);
    }
    output
}

/// Resolves metadata through Git so linked worktrees use their own operation state.
fn resolve_git_path(repository: &Path, name: &str) -> Result<PathBuf, GitError> {
    let output = run_git(repository, &["rev-parse", "--git-path", name])?;
    let reported_path = output.stdout.trim_end_matches(['\r', '\n']);
    if reported_path.is_empty() {
        return Err(GitError::InvalidStatusResponse {
            message: format!("System Git did not report its {name} metadata path."),
            output,
        });
    }

    let path = PathBuf::from(reported_path);
    Ok(if path.is_absolute() {
        path
    } else {
        repository.join(path)
    })
}

/// Provides an actionable error when the requested abort does not match Git state.
fn require_operation(repository: &Path, expected: RepositoryOperation) -> Result<(), GitError> {
    if get_repository_operation(repository)? == expected {
        Ok(())
    } else {
        let operation = match expected {
            RepositoryOperation::Merge => "merge",
            RepositoryOperation::Rebase => "rebase",
            RepositoryOperation::CherryPick => "cherry-pick",
            RepositoryOperation::Revert => "revert",
            RepositoryOperation::None => "repository operation",
        };
        Err(GitError::InvalidOperationInput {
            message: format!("Git does not report an active {operation} to abort."),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        process::{Command, Output},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;
    use crate::git::get_repository_status;

    fn temporary_repository(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        let repository = env::temp_dir().join(format!(
            "branchlight-conflicts-{label}-{}-{unique}",
            std::process::id()
        ));

        let init = Command::new("git")
            .args(["init", "-b", "main"])
            .arg(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(init.status.success());
        for (key, value) in [
            ("user.name", "Branchlight Tests"),
            ("user.email", "branchlight@example.invalid"),
        ] {
            assert!(git(&repository, &["config", key, value]).status.success());
        }

        repository
    }

    fn git(repository: &Path, arguments: &[&str]) -> Output {
        Command::new("git")
            .args(arguments)
            .current_dir(repository)
            .output()
            .expect("system Git should be available while building Branchlight")
    }

    fn commit_conflict_file(repository: &Path, contents: &str, message: &str) {
        fs::write(repository.join("conflict.txt"), contents)
            .expect("the conflict fixture should be written");
        assert!(git(repository, &["add", "--", "conflict.txt"])
            .status
            .success());
        assert!(git(repository, &["commit", "-m", message]).status.success());
    }

    #[test]
    fn detects_and_aborts_only_an_active_merge() {
        let repository = temporary_repository("merge");
        commit_conflict_file(&repository, "base\n", "Create base");
        assert!(git(&repository, &["switch", "-c", "feature"])
            .status
            .success());
        commit_conflict_file(&repository, "feature\n", "Change on feature");
        assert!(git(&repository, &["switch", "main"]).status.success());
        commit_conflict_file(&repository, "main\n", "Change on main");

        assert!(!git(&repository, &["merge", "feature"]).status.success());
        let status = get_repository_status(&repository).expect("merge status should be readable");
        assert_eq!(status.operation, RepositoryOperation::Merge);
        assert_eq!(status.conflicts.len(), 1);
        assert!(matches!(
            abort_rebase(&repository),
            Err(GitError::InvalidOperationInput { .. })
        ));

        abort_merge(&repository).expect("the active merge should abort");
        let status = get_repository_status(&repository).expect("normal status should be restored");
        assert_eq!(status.operation, RepositoryOperation::None);
        assert!(status.conflicts.is_empty());

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    fn stopped_rebase(label: &str) -> PathBuf {
        let repository = temporary_repository(label);
        commit_conflict_file(&repository, "base\n", "Base");
        assert!(git(&repository, &["switch", "-c", "topic"])
            .status
            .success());
        commit_conflict_file(&repository, "topic one\n", "Topic one");
        commit_conflict_file(&repository, "topic two\n", "Topic two");
        assert!(git(&repository, &["switch", "main"]).status.success());
        commit_conflict_file(&repository, "main\n", "Main");
        assert!(git(&repository, &["switch", "topic"]).status.success());
        assert!(!git(&repository, &["rebase", "main"]).status.success());
        repository
    }

    #[test]
    fn rebase_continue_preserves_a_subsequent_stop_and_finishes_after_resolution() {
        let repository = stopped_rebase("continue");
        assert!(recover_rebase(&repository, RebaseRecovery::Continue).is_err());
        commit_resolution(&repository, "resolved one\n");
        // The first commit succeeds, but replaying the second conflicts again.
        assert!(recover_rebase(&repository, RebaseRecovery::Continue).is_err());
        let status = get_repository_status(&repository).unwrap();
        assert_eq!(status.operation, RepositoryOperation::Rebase);
        assert_eq!(status.conflicts.len(), 1);
        commit_resolution(&repository, "resolved two\n");
        recover_rebase(&repository, RebaseRecovery::Continue).unwrap();
        let status = get_repository_status(&repository).unwrap();
        assert_eq!(status.operation, RepositoryOperation::None);
        assert!(status.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(repository.join("conflict.txt")).unwrap(),
            "resolved two\n"
        );
        assert!(recover_rebase(&repository, RebaseRecovery::Continue).is_err());
        fs::remove_dir_all(repository).unwrap();
    }

    fn commit_resolution(repository: &Path, contents: &str) {
        fs::write(repository.join("conflict.txt"), contents).unwrap();
        assert!(git(repository, &["add", "--", "conflict.txt"])
            .status
            .success());
    }

    #[test]
    fn rebase_skip_omits_commits_and_keeps_abort_available_after_another_stop() {
        let repository = stopped_rebase("skip");
        assert!(recover_rebase(&repository, RebaseRecovery::Skip).is_err());
        assert_eq!(
            get_repository_operation(&repository).unwrap(),
            RepositoryOperation::Rebase
        );
        abort_rebase(&repository).unwrap();
        assert_eq!(
            fs::read_to_string(repository.join("conflict.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "topic two\n"
        );
        assert!(!git(&repository, &["rebase", "main"]).status.success());
        assert!(recover_rebase(&repository, RebaseRecovery::Skip).is_err());
        recover_rebase(&repository, RebaseRecovery::Skip).unwrap();
        assert_eq!(
            get_repository_operation(&repository).unwrap(),
            RepositoryOperation::None
        );
        assert_eq!(
            fs::read_to_string(repository.join("conflict.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "main\n"
        );
        assert!(recover_rebase(&repository, RebaseRecovery::Skip).is_err());
        fs::remove_dir_all(repository).unwrap();
    }

    #[test]
    fn detects_and_aborts_only_an_active_rebase() {
        let repository = temporary_repository("rebase");
        commit_conflict_file(&repository, "base\n", "Create base");
        assert!(git(&repository, &["switch", "-c", "topic"])
            .status
            .success());
        commit_conflict_file(&repository, "topic\n", "Change on topic");
        assert!(git(&repository, &["switch", "main"]).status.success());
        commit_conflict_file(&repository, "main\n", "Change on main");
        assert!(git(&repository, &["switch", "topic"]).status.success());

        assert!(!git(&repository, &["rebase", "main"]).status.success());
        let status = get_repository_status(&repository).expect("rebase status should be readable");
        assert_eq!(status.operation, RepositoryOperation::Rebase);
        assert_eq!(status.conflicts.len(), 1);
        assert!(matches!(
            abort_merge(&repository),
            Err(GitError::InvalidOperationInput { .. })
        ));

        abort_rebase(&repository).expect("the active rebase should abort");
        let status = get_repository_status(&repository).expect("normal status should be restored");
        assert_eq!(status.operation, RepositoryOperation::None);
        assert!(status.conflicts.is_empty());

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }
}
