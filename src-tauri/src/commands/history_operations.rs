use crate::{
    git::{
        diagnostics,
        history_operations::{self, HistoryAction},
    },
    models::{GitError, GitOutput},
};
use std::path::Path;

#[tauri::command]
pub(crate) async fn execute_history_action(
    path: String,
    expected_head: String,
    expected_branch: String,
    action: HistoryAction,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        history_operations::execute(Path::new(&path), &expected_head, &expected_branch, action)
    })
    .await
}
#[tauri::command]
pub(crate) async fn abort_history_operation(
    path: String,
    kind: String,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        history_operations::abort(Path::new(&path), &kind)
    })
    .await
}
#[tauri::command]
pub(crate) async fn get_diagnostics(path: String) -> Result<diagnostics::Diagnostics, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        diagnostics::inspect(Path::new(&path))
    })
    .await
}
