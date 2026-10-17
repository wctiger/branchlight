use std::path::Path;

use crate::{
    git,
    models::{Commit, GitError},
};

/// Returns up to 200 topologically ordered commits reachable from all refs.
#[tauri::command]
pub(crate) async fn get_history(path: String) -> Result<Vec<Commit>, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::get_history(Path::new(&path))
    })
    .await
}
