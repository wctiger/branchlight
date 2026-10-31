use crate::{
    git::tags,
    models::{GitError, GitOutput},
};
use std::path::Path;
#[tauri::command]
pub(crate) async fn get_local_tags(path: String) -> Result<Vec<tags::LocalTag>, GitError> {
    super::scheduler::run(Some(path.clone()), move || tags::list(Path::new(&path))).await
}
#[tauri::command]
pub(crate) async fn inspect_local_tag(
    path: String,
    name: String,
) -> Result<tags::TagDetails, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        tags::inspect(Path::new(&path), &name)
    })
    .await
}
#[tauri::command]
pub(crate) async fn create_local_tag(
    path: String,
    name: String,
    revision: String,
    annotation: Option<String>,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        tags::create(Path::new(&path), &name, &revision, annotation.as_deref())
    })
    .await
}
#[tauri::command]
pub(crate) async fn delete_local_tag(
    path: String,
    name: String,
    expected_oid: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        tags::delete(Path::new(&path), &name, &expected_oid)
    })
    .await
}
