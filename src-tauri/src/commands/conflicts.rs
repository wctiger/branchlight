use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput},
};

/// Aborts the active merge after verifying repository operation state.
#[tauri::command]
pub(crate) fn abort_merge(path: String) -> Result<GitOutput, GitError> {
    git::abort_merge(Path::new(&path))
}

/// Aborts the active rebase after verifying repository operation state.
#[tauri::command]
pub(crate) fn abort_rebase(path: String) -> Result<GitOutput, GitError> {
    git::abort_rebase(Path::new(&path))
}
