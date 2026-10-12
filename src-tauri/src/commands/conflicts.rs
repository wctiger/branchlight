use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput},
};

/// Aborts the active merge after verifying repository operation state.
#[tauri::command]
pub(crate) async fn abort_merge(path: String) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::abort_merge(Path::new(&path))
    })
    .await
}

/// Aborts the active rebase after verifying repository operation state.
#[tauri::command]
pub(crate) async fn abort_rebase(path: String) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::abort_rebase(Path::new(&path))
    })
    .await
}
