use crate::{
    git::delivery,
    models::{GitError, GitOutput},
};
use std::path::Path;

#[tauri::command]
pub(crate) async fn get_remotes(path: String) -> Result<Vec<String>, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        delivery::remotes(Path::new(&path))
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_branch_at(
    path: String,
    branch_name: String,
    revision: String,
    checkout: bool,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        delivery::create_at(Path::new(&path), &branch_name, &revision, checkout)
    })
    .await
}

#[tauri::command]
pub(crate) async fn checkout_remote_branch(
    path: String,
    branch_name: String,
    reference: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        delivery::checkout_remote(Path::new(&path), &branch_name, &reference)
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_branch_upstream(
    path: String,
    branch_name: String,
    reference: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        delivery::set_upstream(Path::new(&path), &branch_name, &reference)
    })
    .await
}

#[tauri::command]
pub(crate) async fn review_push(path: String) -> Result<delivery::PushReview, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        delivery::review_push(Path::new(&path))
    })
    .await
}

#[tauri::command]
pub(crate) async fn force_push(
    path: String,
    review: delivery::PushReview,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        delivery::force_push(Path::new(&path), &review)
    })
    .await
}

#[tauri::command]
pub(crate) async fn compose_commit(
    path: String,
    options: delivery::CommitOptions,
) -> Result<delivery::CommitResult, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        delivery::compose_commit(Path::new(&path), &options)
    })
    .await
}
