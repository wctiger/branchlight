use std::{fmt::Write, path::Path, process::Command, str};

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
    let stdout_bytes = process_output.stdout;
    let output = GitOutput {
        stdout: decode_git_bytes(&stdout_bytes),
        stderr: decode_git_bytes(&process_output.stderr),
        exit_code: process_output.status.code(),
        stdout_bytes,
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

/// Preserves valid UTF-8 and reversibly escapes bytes that cannot be serialized as text.
pub(super) fn decode_git_bytes(bytes: &[u8]) -> String {
    if let Ok(value) = str::from_utf8(bytes) {
        return value.to_owned();
    }

    let mut escaped = String::with_capacity(bytes.len());
    for byte in bytes {
        match byte {
            b'\\' => escaped.push_str("\\\\"),
            b' '..=b'~' => escaped.push(char::from(*byte)),
            _ => write!(escaped, "\\x{byte:02x}").expect("writing to a String cannot fail"),
        }
    }

    escaped
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
    fn escapes_invalid_utf8_without_changing_valid_utf8() {
        assert_eq!(decode_git_bytes("café.txt".as_bytes()), "café.txt");
        assert_eq!(
            decode_git_bytes(b"invalid-\xff-\\-name.txt"),
            "invalid-\\xff-\\\\-name.txt"
        );
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
