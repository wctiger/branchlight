use std::path::Path;

use crate::{
    git,
    models::{Branches, GitError, GitOutput},
};

/// Returns local and remote branch refs for the selected repository.
#[tauri::command]
pub(crate) fn get_branches(path: String) -> Result<Branches, GitError> {
    git::get_branches(Path::new(&path))
}

/// Switches to an existing local branch.
#[tauri::command]
pub(crate) fn switch_branch(path: String, branch_name: String) -> Result<GitOutput, GitError> {
    git::switch_branch(Path::new(&path), &branch_name)
}

/// Creates and checks out a new local branch.
#[tauri::command]
pub(crate) fn create_branch(path: String, branch_name: String) -> Result<GitOutput, GitError> {
    git::create_branch(Path::new(&path), &branch_name)
}

/// Renames an existing local branch.
#[tauri::command]
pub(crate) fn rename_branch(
    path: String,
    old_name: String,
    new_name: String,
) -> Result<GitOutput, GitError> {
    git::rename_branch(Path::new(&path), &old_name, &new_name)
}

/// Safely deletes a fully merged local branch.
#[tauri::command]
pub(crate) fn delete_branch(path: String, branch_name: String) -> Result<GitOutput, GitError> {
    git::delete_branch(Path::new(&path), &branch_name)
}
