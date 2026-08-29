use std::path::Path;

use crate::models::{GitError, GitOutput};

use super::runner::run_git;

/// Stages every change for one path without allowing the path to become an option.
pub(crate) fn stage_file(repository: &Path, path: &str) -> Result<GitOutput, GitError> {
    validate_file_path(path)?;
    run_git(repository, &["add", "--", path])
}

/// Removes every staged change for one path from the index.
pub(crate) fn unstage_file(repository: &Path, path: &str) -> Result<GitOutput, GitError> {
    validate_file_path(path)?;
    run_git(repository, &["restore", "--staged", "--", path])
}

/// Creates a commit with the repository's configured Git identity.
pub(crate) fn commit(repository: &Path, message: &str) -> Result<GitOutput, GitError> {
    if message.trim().is_empty() {
        return Err(GitError::InvalidOperationInput {
            message: "Enter a commit message before committing.".to_owned(),
        });
    }

    run_git(repository, &["commit", "-m", message])
}

fn validate_file_path(path: &str) -> Result<(), GitError> {
    if path.is_empty() {
        Err(GitError::InvalidOperationInput {
            message: "Choose a file before changing its staged state.".to_owned(),
        })
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn temporary_repository(label: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        let repository = env::temp_dir().join(format!(
            "branchlight-operations-{label}-{}-{unique}",
            std::process::id()
        ));

        fs::create_dir_all(&repository).expect("the test repository should be created");
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
            let config = Command::new("git")
                .args(["config", key, value])
                .current_dir(&repository)
                .output()
                .expect("system Git should be available while building Branchlight");
            assert!(config.status.success());
        }

        repository
    }

    #[test]
    fn stages_and_unstages_an_option_like_path_as_a_file() {
        let repository = temporary_repository("option-path");
        let path = "--branchlight-option";
        fs::write(repository.join(path), "first\n")
            .expect("the option-like test file should be written");

        stage_file(&repository, path).expect("the file should be staged");
        commit(&repository, "Add the option-like file")
            .expect("the baseline commit should be created");

        fs::write(repository.join(path), "second\n")
            .expect("the option-like test file should be changed");
        stage_file(&repository, path).expect("the changed file should be staged");
        unstage_file(&repository, path).expect("the changed file should be unstaged");

        let cached_diff = Command::new("git")
            .args(["diff", "--cached", "--name-only", "-z"])
            .current_dir(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(cached_diff.status.success());
        assert!(cached_diff.stdout.is_empty());

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[test]
    fn commits_with_the_configured_identity_and_requested_message() {
        let repository = temporary_repository("commit");
        fs::write(repository.join("hello.txt"), "hello\n")
            .expect("the test file should be written");
        stage_file(&repository, "hello.txt").expect("the test file should be staged");

        commit(&repository, "Create hello file").expect("the commit should succeed");

        let log = Command::new("git")
            .args(["log", "-1", "--format=%s%n%an%n%ae"])
            .current_dir(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(log.status.success());
        assert_eq!(
            String::from_utf8(log.stdout).expect("Git should return UTF-8 test output"),
            "Create hello file\nBranchlight Tests\nbranchlight@example.invalid\n"
        );

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[test]
    fn rejects_empty_operation_inputs_before_running_git() {
        let repository = temporary_repository("validation");

        assert!(matches!(
            stage_file(&repository, ""),
            Err(GitError::InvalidOperationInput { .. })
        ));
        assert!(matches!(
            unstage_file(&repository, ""),
            Err(GitError::InvalidOperationInput { .. })
        ));
        assert!(matches!(
            commit(&repository, "  \n\t"),
            Err(GitError::InvalidOperationInput { .. })
        ));

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }
}
