use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput},
};

/// Fetches configured remotes for the selected repository.
#[tauri::command]
pub(crate) fn fetch_remote(path: String) -> Result<GitOutput, GitError> {
    git::fetch(Path::new(&path))
}

/// Pulls the current branch using the user's Git configuration.
#[tauri::command]
pub(crate) fn pull_remote(path: String) -> Result<GitOutput, GitError> {
    git::pull(Path::new(&path))
}

/// Pushes the current branch to its configured upstream.
#[tauri::command]
pub(crate) fn push_remote(path: String) -> Result<GitOutput, GitError> {
    git::push(Path::new(&path))
}
