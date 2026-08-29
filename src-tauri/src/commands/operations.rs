use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput},
};

/// Stages one whole file in the selected repository.
#[tauri::command]
pub(crate) fn stage_file(path: String, file_path: String) -> Result<GitOutput, GitError> {
    git::stage_file(Path::new(&path), &file_path)
}

/// Unstages one whole file in the selected repository.
#[tauri::command]
pub(crate) fn unstage_file(path: String, file_path: String) -> Result<GitOutput, GitError> {
    git::unstage_file(Path::new(&path), &file_path)
}

/// Creates a commit using the selected repository's Git configuration.
#[tauri::command]
pub(crate) fn commit(path: String, message: String) -> Result<GitOutput, GitError> {
    git::commit(Path::new(&path), &message)
}
