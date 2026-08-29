use std::path::Path;

use crate::{
    git,
    models::{GitError, Repository, RepositoryStatus},
};

#[tauri::command]
pub(crate) fn open_repository(path: String) -> Result<Repository, GitError> {
    git::open_repository(Path::new(&path))
}

/// Returns a typed snapshot of the repository's branch and file status.
#[tauri::command]
pub(crate) fn get_repository_status(path: String) -> Result<RepositoryStatus, GitError> {
    git::get_repository_status(Path::new(&path))
}
