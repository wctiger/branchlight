use std::env;

use crate::models::{GitError, GitOutput};

use super::runner::run_git;

pub(crate) fn get_git_version() -> Result<GitOutput, GitError> {
    let working_directory =
        env::current_dir().map_err(|error| GitError::WorkingDirectoryUnavailable {
            message: format!("Unable to determine a working directory for system Git: {error}"),
        })?;

    run_git(&working_directory, &["--version"])
}
