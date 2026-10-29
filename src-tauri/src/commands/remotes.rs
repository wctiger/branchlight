use std::path::Path;

use crate::{
    git,
    models::{GitError, GitOutput},
};

/// Fetches configured remotes for the selected repository.
#[tauri::command]
pub(crate) async fn fetch_remote(
    path: String,
    remote: Option<String>,
    prune: Option<bool>,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || match remote {
        Some(remote) => {
            git::delivery::fetch_options(Path::new(&path), &remote, prune.unwrap_or(false))
        }
        None => git::fetch(Path::new(&path)),
    })
    .await
}

/// Pulls the current branch using the user's Git configuration.
#[tauri::command]
pub(crate) async fn pull_remote(
    path: String,
    strategy: Option<git::delivery::PullStrategy>,
) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || match strategy {
        Some(strategy) => git::delivery::pull_options(Path::new(&path), strategy),
        None => git::pull(Path::new(&path)),
    })
    .await
}

/// Pushes the current branch to its configured upstream.
#[tauri::command]
pub(crate) async fn push_remote(path: String) -> Result<GitOutput, GitError> {
    super::scheduler::run(Some(path.clone()), move || git::push(Path::new(&path))).await
}
