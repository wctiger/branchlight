use crate::{
    git::lfs,
    models::{GitError, GitOutput},
};
use std::path::Path;
#[tauri::command]
pub(crate) async fn get_lfs_state(path: String) -> Result<lfs::LfsState, GitError> {
    super::scheduler::run(Some(path.clone()), move || lfs::inspect(Path::new(&path))).await
}
#[tauri::command]
pub(crate) async fn review_lfs_prune(path: String) -> Result<lfs::PruneReview, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        lfs::review_prune(Path::new(&path))
    })
    .await
}
#[tauri::command]
pub(crate) async fn execute_lfs_action(
    path: String,
    action: lfs::LfsAction,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        lfs::execute(Path::new(&path), action)
    })
    .await
}
// Progress reads must bypass repository mutation queues, or a transfer would
// block its own progress UI. This reads bounded in-memory state only.
#[tauri::command]
pub(crate) fn get_lfs_progress(path: String) -> lfs::LfsProgress {
    lfs::progress(Path::new(&path))
}
