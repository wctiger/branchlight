use crate::{
    git,
    models::{GitError, GitOutput},
};

#[tauri::command]
pub(crate) fn get_git_version() -> Result<GitOutput, GitError> {
    git::get_git_version()
}
