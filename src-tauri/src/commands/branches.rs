use std::path::Path;

use crate::{
    git,
    models::{Branches, GitError, GitOutput},
};

/// Returns local and remote branch refs for the selected repository.
#[tauri::command]
pub(crate) async fn get_branches(path: String) -> Result<Branches, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::get_branches(Path::new(&path))
    })
    .await
}

/// Switches to an existing local branch.
#[tauri::command]
pub(crate) async fn switch_branch(
    path: String,
    branch_name: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::switch_branch(Path::new(&path), &branch_name)
    })
    .await
}

/// Creates and checks out a new local branch.
#[tauri::command]
pub(crate) async fn create_branch(
    path: String,
    branch_name: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::create_branch(Path::new(&path), &branch_name)
    })
    .await
}

/// Renames an existing local branch.
#[tauri::command]
pub(crate) async fn rename_branch(
    path: String,
    old_name: String,
    new_name: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::rename_branch(Path::new(&path), &old_name, &new_name)
    })
    .await
}

/// Safely deletes a fully merged local branch.
#[tauri::command]
pub(crate) async fn delete_branch(
    path: String,
    branch_name: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::delete_branch(Path::new(&path), &branch_name)
    })
    .await
}

/// Merges one local source branch into the currently checked-out branch.
#[tauri::command]
pub(crate) async fn merge_branch(
    path: String,
    source_branch: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::merge_branch(Path::new(&path), &source_branch)
    })
    .await
}

/// Rebases the current branch onto one local source branch.
#[tauri::command]
pub(crate) async fn rebase_onto_branch(
    path: String,
    source_branch: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        git::rebase_onto_branch(Path::new(&path), &source_branch)
    })
    .await
}
