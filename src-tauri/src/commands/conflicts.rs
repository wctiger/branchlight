use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput},
};

#[tauri::command]
pub(crate) async fn get_conflict_file(
    path: String,
    file_path: String,
) -> Result<git::resolution::ConflictFile, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::resolution::inspect(Path::new(&path), &file_path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_conflict_file(
    path: String,
    file_path: String,
    token: String,
    output: String,
    mark_resolved: bool,
) -> Result<(), GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::resolution::save(Path::new(&path), &file_path, &token, &output, mark_resolved)
    })
    .await
}

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
