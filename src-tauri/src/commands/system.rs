use crate::{
    git,
    models::{GitError, GitOutput},
};

#[tauri::command]
pub(crate) async fn get_git_version() -> Result<GitOutput, GitError> {
    super::scheduler::run(None, git::get_git_version).await
}
