use std::{error::Error, fmt};

use serde::Serialize;

use super::GitOutput;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub(crate) enum GitError {
    WorkingDirectoryUnavailable { message: String },
    ProcessStartFailed { message: String },
    CommandFailed { message: String, output: GitOutput },
}

impl fmt::Display for GitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::WorkingDirectoryUnavailable { message }
            | Self::ProcessStartFailed { message }
            | Self::CommandFailed { message, .. } => message,
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
}
