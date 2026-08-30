use std::{error::Error, fmt};

use serde::Serialize;

use super::GitOutput;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub(crate) enum GitError {
    WorkingDirectoryUnavailable { message: String },
    ProcessStartFailed { message: String },
    CommandFailed { message: String, output: GitOutput },
    InvalidRepositoryPath { message: String },
    RepositoryUnavailable { message: String, output: GitOutput },
    InvalidRepositoryResponse { message: String, output: GitOutput },
    InvalidStatusResponse { message: String, output: GitOutput },
    InvalidBranchesResponse { message: String, output: GitOutput },
    InvalidStashesResponse { message: String, output: GitOutput },
    InvalidHistoryResponse { message: String, output: GitOutput },
    InvalidOperationInput { message: String },
}

impl fmt::Display for GitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::WorkingDirectoryUnavailable { message }
            | Self::ProcessStartFailed { message }
            | Self::CommandFailed { message, .. }
            | Self::InvalidRepositoryPath { message }
            | Self::RepositoryUnavailable { message, .. }
            | Self::InvalidRepositoryResponse { message, .. }
            | Self::InvalidStatusResponse { message, .. }
            | Self::InvalidBranchesResponse { message, .. }
            | Self::InvalidStashesResponse { message, .. }
            | Self::InvalidHistoryResponse { message, .. }
            | Self::InvalidOperationInput { message } => message,
        };

        formatter.write_str(message)
    }
}

impl Error for GitError {}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn command_failure_serializes_for_the_tauri_client() {
        let error = GitError::CommandFailed {
            message: "System Git failed with exit code 1.".to_owned(),
            output: GitOutput {
                stdout: String::new(),
                stderr: "failure".to_owned(),
                exit_code: Some(1),
                stdout_bytes: Vec::new(),
            },
        };

        let serialized = serde_json::to_value(error).expect("the error should serialize");

        assert_eq!(
            serialized,
            json!({
                "code": "commandFailed",
                "message": "System Git failed with exit code 1.",
                "output": {
                    "stdout": "",
                    "stderr": "failure",
                    "exitCode": 1
                }
            })
        );
    }

    #[test]
    fn repository_failure_serializes_with_actionable_context() {
        let error = GitError::RepositoryUnavailable {
            message: "Choose a folder inside an existing Git repository.".to_owned(),
            output: GitOutput {
                stdout: String::new(),
                stderr: "fatal: not a git repository".to_owned(),
                exit_code: Some(128),
                stdout_bytes: Vec::new(),
            },
        };

        let serialized = serde_json::to_value(error).expect("the error should serialize");

        assert_eq!(
            serialized,
            json!({
                "code": "repositoryUnavailable",
                "message": "Choose a folder inside an existing Git repository.",
                "output": {
                    "stdout": "",
                    "stderr": "fatal: not a git repository",
                    "exitCode": 128
                }
            })
        );
    }
}
