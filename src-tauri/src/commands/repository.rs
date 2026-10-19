use std::path::Path;

use crate::{
    git,
    models::{GitError, Repository, RepositoryStatus},
};

#[tauri::command]
pub(crate) async fn open_repository(path: String) -> Result<Repository, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::open_repository(Path::new(&path))
    })
    .await
}

/// Returns a typed snapshot of the repository's branch and file status.
#[tauri::command]
pub(crate) async fn get_repository_status(path: String) -> Result<RepositoryStatus, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::get_repository_status(Path::new(&path))
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_repository(
    destination: String,
    source: Option<String>,
) -> Result<Repository, GitError> {
    super::scheduler::run(None, move || {
        git::create_repository(Path::new(&destination), source.as_deref())
    })
    .await
}
