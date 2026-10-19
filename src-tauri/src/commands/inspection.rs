use crate::{
    git::inspection::{self, Comparison, FileCommit, TextDiff},
    models::GitError,
};
use std::path::Path;
#[tauri::command]
pub(crate) async fn compare_revisions(
    path: String,
    base: String,
    target: String,
) -> Result<Comparison, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        inspection::compare(Path::new(&path), &base, &target)
    })
    .await
}
#[tauri::command]
pub(crate) async fn get_text_diff(
    path: String,
    kind: String,
    file_path: String,
    base: String,
    target: String,
) -> Result<TextDiff, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        inspection::diff(Path::new(&path), &kind, &file_path, &base, &target)
    })
    .await
}
#[tauri::command]
pub(crate) async fn get_file_history(
    path: String,
    file_path: String,
    revision: String,
) -> Result<Vec<FileCommit>, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        inspection::file_history(Path::new(&path), &file_path, &revision)
    })
    .await
}
#[tauri::command]
pub(crate) async fn get_file_blame(
    path: String,
    file_path: String,
    revision: String,
) -> Result<TextDiff, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        inspection::blame(Path::new(&path), &file_path, &revision)
    })
    .await
}
#[tauri::command]
pub(crate) async fn discard_file(
    path: String,
    file_path: String,
    expected: String,
) -> Result<crate::models::GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        inspection::discard(Path::new(&path), &file_path, &expected)
    })
    .await
}
