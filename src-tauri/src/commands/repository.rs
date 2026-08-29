use std::path::Path;

use crate::{
    git,
    models::{GitError, Repository},
};

#[tauri::command]
pub(crate) fn open_repository(path: String) -> Result<Repository, GitError> {
    git::open_repository(Path::new(&path))
}
