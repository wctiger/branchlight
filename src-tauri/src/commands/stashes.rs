use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput, Stash},
};

/// Returns the selected repository's current stash entries.
#[tauri::command]
pub(crate) fn get_stashes(path: String) -> Result<Vec<Stash>, GitError> {
    git::get_stashes(Path::new(&path))
}

/// Creates a stash with an optional message.
#[tauri::command]
pub(crate) fn create_stash(path: String, message: String) -> Result<GitOutput, GitError> {
    git::create_stash(Path::new(&path), &message)
}

/// Applies one selected stash without removing it.
#[tauri::command]
pub(crate) fn apply_stash(path: String, stash_ref: String) -> Result<GitOutput, GitError> {
    git::apply_stash(Path::new(&path), &stash_ref)
}

/// Applies and removes one selected stash on success.
#[tauri::command]
pub(crate) fn pop_stash(path: String, stash_ref: String) -> Result<GitOutput, GitError> {
    git::pop_stash(Path::new(&path), &stash_ref)
}

/// Permanently removes one selected stash.
#[tauri::command]
pub(crate) fn drop_stash(path: String, stash_ref: String) -> Result<GitOutput, GitError> {
    git::drop_stash(Path::new(&path), &stash_ref)
}
