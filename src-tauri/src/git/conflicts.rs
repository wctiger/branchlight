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
    run_git(repository, &["rebase", "--abort"])
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
