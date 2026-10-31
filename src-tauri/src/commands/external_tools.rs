use crate::{git::external_tools, models::GitError};
use std::path::Path;
#[tauri::command]
pub(crate) async fn launch_external_tool(
    path: String,
    request: external_tools::ToolRequest,
) -> Result<external_tools::ToolLaunch, GitError> {
    super::scheduler::run(Some(path.clone()), move || {
        external_tools::launch(Path::new(&path), request)
    })
    .await
}
#[tauri::command]
pub(crate) async fn get_launcher_status(
    job_id: u64,
) -> Result<external_tools::LauncherStatus, GitError> {
    super::scheduler::run(None, move || external_tools::status(job_id)).await
}
