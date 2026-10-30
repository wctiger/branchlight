use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput},
};

#[tauri::command]
pub(crate) async fn recover_rebase(
    path: String,
    action: git::RebaseRecovery,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::recover_rebase(Path::new(&path), action)
    })
    .await
}

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
