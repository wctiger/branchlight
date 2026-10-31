use crate::{
    git::submodules,
    models::{GitError, GitOutput, Repository},
};
use std::path::Path;

#[tauri::command]
pub(crate) async fn get_submodules(path: String) -> Result<Vec<submodules::Submodule>, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        submodules::list(Path::new(&path))
    })
    .await
}
#[tauri::command]
pub(crate) async fn open_submodule(
    path: String,
    submodule_path: String,
) -> Result<Repository, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        submodules::open(Path::new(&path), &submodule_path)
    })
    .await
}
async fn paths(path: &str) -> Result<Vec<String>, GitError> {
    let root = path.to_owned();
    super::scheduler::run(Some(root.clone()), move || {
        submodules::lock_paths(Path::new(&root))
    })
    .await
}
#[tauri::command]
pub(crate) async fn review_submodule_action(
    path: String,
    action: submodules::SubmoduleAction,
) -> Result<submodules::SubmoduleReview, GitError> {
    let paths = paths(&path).await?;
    super::scheduler::run_repositories(paths, move || submodules::review(Path::new(&path), action))
        .await
}
#[tauri::command]
pub(crate) async fn execute_submodule_action(
    path: String,
    action: submodules::SubmoduleAction,
    token: String,
) -> Result<GitOutput, GitError> {
    let paths = paths(&path).await?;
    super::scheduler::run_repositories(paths, move || {
        submodules::execute(Path::new(&path), action, &token)
    })
    .await
}
