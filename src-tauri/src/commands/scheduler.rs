use crate::{git, models::GitError};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, Weak},
};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};

type Contexts = Mutex<HashMap<String, Weak<AsyncMutex<()>>>>;
static CONTEXTS: OnceLock<Contexts> = OnceLock::new();
static WORKERS: Semaphore = Semaphore::const_new(8);

/// Queue before taking a worker permit: busy repositories cannot exhaust workers.
/// All commands share a common-directory lock, including reads for coherent snapshots.
pub(super) async fn run<T: Send + 'static>(
    path: Option<String>,
    operation: impl FnOnce() -> Result<T, GitError> + Send + 'static,
) -> Result<T, GitError> {
    let context = if let Some(path) = path {
        let identity_worker = WORKERS.acquire().await.map_err(join_error)?;
        let identity = tauri::async_runtime::spawn_blocking(move || {
            let _worker = identity_worker;
            git::repository_identity(std::path::Path::new(&path))
        })
        .await
        .map_err(join_error)??;
        let mut contexts = CONTEXTS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        contexts.retain(|_, context| context.strong_count() > 0);
        let context = contexts
            .get(&identity)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| Arc::new(AsyncMutex::new(())));
        contexts.insert(identity, Arc::downgrade(&context));
        Some(context)
    } else {
        None
    };
    let context_guard = match context {
        Some(context) => Some(context.lock_owned().await),
        None => None,
    };
    let worker = WORKERS
        .acquire()
        .await
        .map_err(|error| GitError::ProcessStartFailed {
            message: error.to_string(),
        })?;
    tauri::async_runtime::spawn_blocking(move || {
        // The worker owns guards even if its caller is dropped during an operation.
        let _context_guard = context_guard;
        let _worker = worker;
        operation()
    })
    .await
    .map_err(join_error)?
}

fn join_error(error: impl std::fmt::Display) -> GitError {
    GitError::ProcessStartFailed {
        message: format!("Repository worker failed: {error}"),
    }
}
