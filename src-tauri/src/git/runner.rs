use std::{path::Path, process::Command};

use crate::models::{GitError, GitOutput};

pub(super) fn run_git(repository: &Path, arguments: &[&str]) -> Result<GitOutput, GitError> {
    let process_output = Command::new("git")
        .current_dir(repository)
        .args(arguments)
        .output()
        .map_err(|error| GitError::ProcessStartFailed {
            message: format!(
                "Unable to start system Git in '{}': {error}",
                repository.display()
            ),
        })?;

    let succeeded = process_output.status.success();
    let output = GitOutput {
        stdout: String::from_utf8_lossy(&process_output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&process_output.stderr).into_owned(),
        exit_code: process_output.status.code(),
    };

    if succeeded {
        Ok(output)
    } else {
        let status = output
            .exit_code
            .map_or_else(|| "a signal".to_owned(), |code| format!("exit code {code}"));

        Err(GitError::CommandFailed {
            message: format!("System Git failed with {status}."),
            output,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::env;

    use super::*;

    #[test]
    fn runs_system_git_and_returns_structured_output() {
        let repository = env::current_dir().expect("the test working directory should exist");

        let output = run_git(&repository, &["--version"])
            .expect("system Git should be available while building Branchlight");

        assert!(output.stdout.starts_with("git version "));
        assert!(output.stderr.is_empty());
        assert_eq!(output.exit_code, Some(0));
    }

    #[test]
    fn returns_output_when_git_exits_unsuccessfully() {
        let repository = env::current_dir().expect("the test working directory should exist");

        let error = run_git(&repository, &["--branchlight-invalid-option"])
            .expect_err("an invalid Git option should fail");

        match error {
            GitError::CommandFailed { output, .. } => {
                assert_ne!(output.exit_code, Some(0));
                assert!(!output.stderr.is_empty());
            }
            other => panic!("expected a command failure, received {other:?}"),
        }
    }

    #[test]
    fn reports_a_missing_working_directory_as_a_start_failure() {
        let missing_repository = env::temp_dir().join(format!(
            "branchlight-missing-test-repository-{}",
            std::process::id()
        ));

        let error = run_git(&missing_repository, &["--version"])
            .expect_err("Git should not start in a missing directory");

        assert!(matches!(error, GitError::ProcessStartFailed { .. }));
    }
}
