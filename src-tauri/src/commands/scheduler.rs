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
    run_repositories(path.into_iter().collect(), operation).await
}

/// Acquire every participating repository lock in a stable order. Submodule
/// lifecycle operations supply both parent and initialized child paths.
pub(super) async fn run_repositories<T: Send + 'static>(
    paths: Vec<String>,
    operation: impl FnOnce() -> Result<T, GitError> + Send + 'static,
) -> Result<T, GitError> {
    let identities = if paths.is_empty() {
        Vec::new()
    } else {
        let identity_worker = WORKERS.acquire().await.map_err(join_error)?;
        tauri::async_runtime::spawn_blocking(move || {
            let _worker = identity_worker;
            let mut identities = Vec::new();
            for path in paths {
                identities.extend(git::repository_lock_identities(std::path::Path::new(
                    &path,
                ))?);
            }
            identities.sort_unstable();
            identities.dedup();
            Ok::<_, GitError>(identities)
        })
        .await
        .map_err(join_error)??
    };
    let contexts: Vec<_> = {
        let mut contexts = CONTEXTS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        contexts.retain(|_, context| context.strong_count() > 0);
        identities
            .into_iter()
            .map(|identity| {
                let context = contexts
                    .get(&identity)
                    .and_then(Weak::upgrade)
                    .unwrap_or_else(|| Arc::new(AsyncMutex::new(())));
                contexts.insert(identity, Arc::downgrade(&context));
                context
            })
            .collect()
    };
    let mut context_guards = Vec::new();
    for context in contexts {
        context_guards.push(context.lock_owned().await);
    }
    let worker = WORKERS
        .acquire()
        .await
        .map_err(|error| GitError::ProcessStartFailed {
            message: error.to_string(),
        })?;
    tauri::async_runtime::spawn_blocking(move || {
        // The worker owns guards even if its caller is dropped during an operation.
        let _context_guards = context_guards;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        process::Command,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    struct Repositories(PathBuf);
    impl Repositories {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "branchlight-scheduler-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                crate::git::fixture_nonce()
            ));
            fs::create_dir(&root).unwrap();
            for name in ["a", "b"] {
                let path = root.join(name);
                git::create_repository(&path, None).unwrap();
                for args in [
                    vec!["config", "user.name", "Scheduler Example"],
                    vec!["config", "user.email", "scheduler@example.invalid"],
                    vec![
                        "-c",
                        "commit.gpgsign=false",
                        "commit",
                        "--allow-empty",
                        "-m",
                        "Initial",
                    ],
                ] {
                    assert!(Command::new("git")
                        .current_dir(&path)
                        .args(args)
                        .output()
                        .unwrap()
                        .status
                        .success());
                }
            }
            assert!(Command::new("git")
                .current_dir(root.join("a"))
                .args(["worktree", "add", "-b", "linked"])
                .arg(root.join("linked"))
                .output()
                .unwrap()
                .status
                .success());
            Self(root)
        }
        fn path(&self, name: &str) -> String {
            self.0.join(name).to_string_lossy().into_owned()
        }
    }
    impl Drop for Repositories {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn limits_simultaneous_workers_and_drains_queued_operations() {
        let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let (started, started_rx) = mpsc::channel();
        let mut workers = Vec::new();
        for _ in 0..12 {
            let gate = gate.clone();
            let started = started.clone();
            workers.push(tauri::async_runtime::spawn(run(None, move || {
                started.send(()).unwrap();
                let (lock, condition) = &*gate;
                let (released, timeout) = condition
                    .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(10), |released| {
                        !*released
                    })
                    .unwrap();
                assert!(*released && !timeout.timed_out());
                Ok(())
            })));
        }
        for _ in 0..8 {
            started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        assert!(
            started_rx.recv_timeout(Duration::from_millis(200)).is_err(),
            "only eight workers may run at once"
        );
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        for worker in workers {
            tauri::async_runtime::block_on(worker).unwrap().unwrap();
        }
        assert_eq!(started_rx.try_iter().count(), 4);
    }

    #[test]
    fn cancelled_callers_retain_linked_worktree_locks_without_blocking_independent_repositories() {
        let repositories = Repositories::new();
        let active = Arc::new(AtomicBool::new(false));
        let (started, started_rx) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        let (finished, finished_rx) = mpsc::channel();
        let first_active = active.clone();
        let path = repositories.path("a");
        let first = tauri::async_runtime::spawn(run(Some(path), move || {
            first_active.store(true, Ordering::SeqCst);
            started.send(()).unwrap();
            // A timeout bounds a failed test even if its caller panics before releasing us.
            let result = release_rx.recv_timeout(Duration::from_secs(10));
            first_active.store(false, Ordering::SeqCst);
            finished.send(()).unwrap();
            result.unwrap();
            Ok(())
        }));
        started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        first.abort();
        let (linked_done, linked_rx) = mpsc::channel();
        let path = repositories.path("linked");
        let linked = tauri::async_runtime::spawn(run(Some(path), move || {
            linked_done.send(active.load(Ordering::SeqCst)).unwrap();
            Ok(())
        }));
        let (independent_done, independent_rx) = mpsc::channel();
        let path = repositories.path("b");
        let independent = tauri::async_runtime::spawn(run(Some(path), move || {
            independent_done.send(()).unwrap();
            Ok(())
        }));
        independent_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("independent repository must progress while A is held");
        assert!(linked_rx.recv_timeout(Duration::from_millis(200)).is_err());
        release.send(()).unwrap();
        finished_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(
            !linked_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            "linked worktree must not overlap the cancelled caller's operation"
        );
        tauri::async_runtime::block_on(independent)
            .unwrap()
            .unwrap();
        tauri::async_runtime::block_on(linked).unwrap().unwrap();
    }
    #[test]
    fn parent_and_submodule_share_locks_while_unrelated_repositories_progress() {
        let repositories = Repositories::new();
        let parent = repositories.path("a");
        let source = repositories.path("b");
        let output = Command::new("git")
            .current_dir(&parent)
            .args([
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                "--",
                &source,
                "nested child",
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let child = repositories.path("a/nested child");
        let identities = git::repository_lock_identities(std::path::Path::new(&child)).unwrap();
        assert_eq!(identities.len(), 2);
        assert!(identities
            .contains(&git::repository_lock_identities(std::path::Path::new(&parent)).unwrap()[0]));
        let (started, started_rx) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        let first = tauri::async_runtime::spawn(run(Some(parent.clone()), move || {
            started.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            Ok(())
        }));
        started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let (child_done, child_rx) = mpsc::channel();
        let child_operation = tauri::async_runtime::spawn(run(Some(child.clone()), move || {
            child_done.send(()).unwrap();
            Ok(())
        }));
        let independent = tauri::async_runtime::spawn(run(Some(source), || Ok(())));
        tauri::async_runtime::block_on(independent)
            .unwrap()
            .unwrap();
        assert!(child_rx.recv_timeout(Duration::from_millis(200)).is_err());
        release.send(()).unwrap();
        tauri::async_runtime::block_on(first).unwrap().unwrap();
        child_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        tauri::async_runtime::block_on(child_operation)
            .unwrap()
            .unwrap();
        // Duplicate identities and opposite input ordering cannot self-deadlock.
        tauri::async_runtime::block_on(run_repositories(vec![child, parent], || Ok(()))).unwrap();
    }
}
