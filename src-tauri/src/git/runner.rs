use std::{
    fmt::Write,
    io::Read,
    path::Path,
    process::{Command, Stdio},
    str,
};

use crate::models::{GitError, GitOutput};

pub(super) fn run_git(repository: &Path, arguments: &[&str]) -> Result<GitOutput, GitError> {
    let mut child = Command::new("git")
        .current_dir(repository)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| GitError::ProcessStartFailed {
            message: format!(
                "Unable to start system Git in '{}': {error}",
                repository.display()
            ),
        })?;
    // Drain both streams concurrently. Keep at most 8 MiB per stream, even when Git
    // produces enormous diffs; draining beyond the cap avoids pipe deadlocks.
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let (stdout, stderr) = std::thread::scope(|scope| {
        let out = scope.spawn(|| read_bounded(stdout));
        let err = scope.spawn(|| read_bounded(stderr));
        (
            out.join().expect("stdout reader"),
            err.join().expect("stderr reader"),
        )
    });
    let status = child.wait().map_err(|error| GitError::ProcessStartFailed {
        message: error.to_string(),
    })?;
    let (stdout_bytes, stdout_overflow) = stdout.map_err(|error| GitError::ProcessStartFailed {
        message: error.to_string(),
    })?;
    let (stderr_bytes, stderr_overflow) = stderr.map_err(|error| GitError::ProcessStartFailed {
        message: error.to_string(),
    })?;
    let succeeded = status.success();
    let mut output = GitOutput {
        stdout: decode_git_bytes(&stdout_bytes),
        stderr: decode_git_bytes(&stderr_bytes),
        exit_code: status.code(),
        stdout_bytes,
    };
    if stdout_overflow || stderr_overflow {
        return Err(GitError::InvalidOperationInput { message: "Git output exceeds the 8 MiB capture limit. Inspect this operation using an external Git tool; refresh status before retrying mutations.".to_owned() });
    }

    if succeeded {
        Ok(output)
    } else {
        output.stdout = sanitize_diagnostic(&output.stdout);
        output.stderr = sanitize_diagnostic(&output.stderr);
        let status = output
            .exit_code
            .map_or_else(|| "a signal".to_owned(), |code| format!("exit code {code}"));

        Err(GitError::CommandFailed {
            message: format!("System Git failed with {status}."),
            output,
        })
    }
}

/// Remote transports and hooks may echo credential-bearing URLs. Keep their
/// useful host/path/error details, but never serialize HTTP userinfo or tokens.
fn sanitize_diagnostic(value: &str) -> String {
    value
        .split_inclusive(char::is_whitespace)
        .map(|part| {
            let mut word = part.to_owned();
            if let Some(scheme) = word.find("://") {
                let start = scheme + 3;
                let end = word[start..]
                    .find(['/', '?', '#'])
                    .map_or(word.len(), |offset| start + offset);
                if let Some(at) = word[start..end].rfind('@') {
                    word.replace_range(start..start + at + 1, "[redacted]@");
                }
                // Query/fragment contents are unnecessary for Git error recovery.
                if let Some(query) = word[start..].find(['?', '#']) {
                    let end = word.trim_end().len();
                    word.replace_range(start + query..end, "?[redacted]");
                }
            }
            word
        })
        .collect()
}

fn read_bounded(mut reader: impl Read) -> std::io::Result<(Vec<u8>, bool)> {
    const LIMIT: usize = 8 * 1024 * 1024;
    let mut retained = Vec::new();
    let mut buffer = [0; 16 * 1024];
    let mut overflow = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let keep = count.min(LIMIT - retained.len());
        retained.extend_from_slice(&buffer[..keep]);
        overflow |= keep < count;
    }
    Ok((retained, overflow))
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

/// Canonical common Git directory coordinates linked worktrees and path aliases.
pub(crate) fn repository_identity(path: &Path) -> Result<String, GitError> {
    let output = run_git(
        path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let directory = output.stdout.trim_end_matches(['\r', '\n']);
    std::fs::canonicalize(directory)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| GitError::InvalidRepositoryPath {
            message: error.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use std::env;

    use super::*;

    #[test]
    fn transport_diagnostics_redact_url_credentials_and_tokens() {
        let message = "fatal: https://user:secret@example.invalid/repo?token=private failed\nssh://login@host/repo\n";
        let safe = sanitize_diagnostic(message);
        assert!(!safe.contains("secret"));
        assert!(!safe.contains("private"));
        assert!(safe.contains("example.invalid/repo"));
        assert!(safe.contains("failed\n"));
    }

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
