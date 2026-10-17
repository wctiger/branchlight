use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput, Stash},
};

/// Returns the selected repository's current stash entries.
#[tauri::command]
pub(crate) async fn get_stashes(path: String) -> Result<Vec<Stash>, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::get_stashes(Path::new(&path))
    })
    .await
}

/// Creates a stash with an optional message.
#[tauri::command]
pub(crate) async fn create_stash(path: String, message: String) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::create_stash(Path::new(&path), &message)
    })
    .await
}

/// Applies one selected stash without removing it.
#[tauri::command]
pub(crate) async fn apply_stash(path: String, stash: Stash) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::apply_stash(Path::new(&path), &stash)
    })
    .await
}

/// Applies and removes one selected stash on success.
#[tauri::command]
pub(crate) async fn pop_stash(path: String, stash: Stash) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::pop_stash(Path::new(&path), &stash)
    })
    .await
}

/// Permanently removes one selected stash.
#[tauri::command]
pub(crate) async fn drop_stash(path: String, stash: Stash) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::drop_stash(Path::new(&path), &stash)
    })
    .await
}
