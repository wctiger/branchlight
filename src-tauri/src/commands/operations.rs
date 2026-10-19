use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput},
};

/// Stages one whole file in the selected repository.
#[tauri::command]
pub(crate) async fn stage_file(path: String, file_path: String) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::stage_file(Path::new(&path), &file_path)
    })
    .await
}

/// Unstages one whole file in the selected repository.
#[tauri::command]
pub(crate) async fn unstage_file(path: String, file_path: String) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::unstage_file(Path::new(&path), &file_path)
    })
    .await
}

/// Creates a commit using the selected repository's Git configuration.
#[tauri::command]
pub(crate) async fn commit(path: String, message: String) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::commit(Path::new(&path), &message)
    })
    .await
}
