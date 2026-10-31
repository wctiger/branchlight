use super::{
    inspection::{invalid, validate_path},
    runner::{run_git, run_git_observed, sanitize_diagnostic},
};
use crate::models::{GitError, GitOutput, RepositoryOperation};
use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

#[derive(Serialize, Deserialize)]
pub(crate) struct LfsPattern {
    pub pattern: String,
    pub source: String,
    pub tracked: bool,
    pub lockable: bool,
}
#[derive(Serialize, Deserialize)]
pub(crate) struct LfsFile {
    pub name: String,
    pub oid: String,
    pub size: u64,
    pub checkout: bool,
    pub downloaded: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LfsState {
    pub available: bool,
    pub version: String,
    pub filter_configured: bool,
    pub hook_path: String,
    pub hook_installed: bool,
    pub storage_path: String,
    pub prune_allowed: bool,
    pub prune_reason: String,
    pub patterns: Vec<LfsPattern>,
    pub files: Vec<LfsFile>,
    pub head: Option<String>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LfsProgress {
    pub active: bool,
    pub message: String,
}
#[derive(Default)]
struct ProgressEntry {
    public: LfsProgress,
    pending: [Vec<u8>; 2],
    dropping: [bool; 2],
}
static PROGRESS: OnceLock<Mutex<HashMap<PathBuf, ProgressEntry>>> = OnceLock::new();
fn key(repository: &Path) -> PathBuf {
    repository
        .canonicalize()
        .unwrap_or_else(|_| repository.to_owned())
}
fn report(repository: &Path, active: bool, message: &str) {
    if let Ok(mut entries) = PROGRESS.get_or_init(Default::default).lock() {
        if entries.len() >= 64 {
            entries.retain(|_, entry| entry.public.active);
        }
        entries.insert(
            key(repository),
            ProgressEntry {
                public: LfsProgress {
                    active,
                    message: message.into(),
                },
                ..Default::default()
            },
        );
    }
}
fn observe(repository: &Path, stderr: bool, bytes: &[u8]) {
    if let Ok(mut entries) = PROGRESS.get_or_init(Default::default).lock() {
        if let Some(entry) = entries.get_mut(&key(repository)) {
            let stream = usize::from(stderr);
            for byte in bytes {
                if matches!(byte, b'\n' | b'\r') {
                    if !entry.dropping[stream] && !entry.pending[stream].is_empty() {
                        let line =
                            sanitize_diagnostic(&String::from_utf8_lossy(&entry.pending[stream]));
                        entry.public.message = line.chars().take(4096).collect();
                    }
                    entry.pending[stream].clear();
                    entry.dropping[stream] = false;
                } else if !entry.dropping[stream] {
                    entry.pending[stream].push(*byte);
                    if entry.pending[stream].len() > 16384 {
                        entry.pending[stream].clear();
                        entry.dropping[stream] = true;
                    }
                }
            }
        }
    }
}
pub(crate) fn progress(repository: &Path) -> LfsProgress {
    PROGRESS
        .get_or_init(Default::default)
        .lock()
        .ok()
        .and_then(|entries| {
            entries
                .get(&key(repository))
                .map(|entry| entry.public.clone())
        })
        .unwrap_or_default()
}
fn version(repository: &Path) -> Result<String, GitError> {
    Ok(run_git(repository, &["lfs", "version"])?
        .stdout
        .trim()
        .into())
}
fn git_path(repository: &Path, name: &str) -> Result<PathBuf, GitError> {
    let output = run_git(repository, &["rev-parse", "--git-path", name])?;
    let path = PathBuf::from(output.stdout.trim_end_matches(['\r', '\n']));
    Ok(if path.is_absolute() {
        path
    } else {
        repository.join(path)
    })
}
fn storage(repository: &Path) -> Result<(String, bool), GitError> {
    let environment = run_git(repository, &["lfs", "env"])?;
    let reported = environment
        .stdout
        .lines()
        .find_map(|line| line.strip_prefix("LocalMediaDir="))
        .ok_or_else(|| invalid("Git LFS did not report its object storage path."))?;
    let common = run_git(
        repository,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let common = PathBuf::from(common.stdout.trim_end_matches(['\r', '\n']))
        .canonicalize()
        .map_err(|e| invalid(&e.to_string()))?;
    let actual = PathBuf::from(reported);
    let actual = actual.canonicalize().unwrap_or(actual);
    let expected = common.join("lfs").join("objects");
    Ok((reported.into(), actual == expected))
}
fn json_records<T: serde::de::DeserializeOwned>(
    repository: &Path,
    args: &[&str],
    field: &str,
) -> Result<Vec<T>, GitError> {
    let output = run_git(repository, args)?;
    let value: serde_json::Value = serde_json::from_str(&output.stdout).map_err(|_| invalid("Installed Git LFS did not return supported JSON metadata. Upgrade Git LFS using its official setup guide."))?;
    let values = value
        .get(field)
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    serde_json::from_value(values).map_err(|_| {
        invalid(
            "Git LFS returned unsupported metadata fields. Upgrade using the official setup guide.",
        )
    })
}
pub(crate) fn inspect(repository: &Path) -> Result<LfsState, GitError> {
    let detected = version(repository);
    let head = run_git(repository, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .ok()
        .map(|out| out.stdout.trim().into());
    let hook = git_path(repository, "hooks/pre-push")?;
    let available = detected.is_ok();
    let filter_configured = run_git(repository, &["config", "--get", "filter.lfs.process"])
        .is_ok_and(|out| !out.stdout.trim().is_empty());
    let hook_installed = fs::read_to_string(&hook).is_ok_and(|content| {
        content.contains("git-lfs pre-push") || content.contains("git lfs pre-push")
    });
    let (storage_path, prune_allowed) = if available {
        storage(repository)?
    } else {
        (String::new(), false)
    };
    Ok(LfsState {
        available, version: detected.unwrap_or_else(|_| "Git LFS is not available in the application's system-Git environment.".into()), filter_configured,
        hook_path: hook.to_string_lossy().into(), hook_installed, storage_path, prune_allowed,
        prune_reason: if prune_allowed {"Default repository storage; Git retains current/recent/unpushed/stashed and other-worktree objects. Remote verification is required before deletion."} else {"Pruning is unavailable for missing tooling or custom/shared/symlinked storage. Use an external Git LFS tool after reviewing storage ownership."}.into(),
        patterns: if available {json_records(repository, &["lfs", "track", "--json"], "patterns")?} else {Vec::new()},
        files: if available && head.is_some() {json_records(repository, &["lfs", "ls-files", "--json"], "files")?} else {Vec::new()}, head,
    })
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum LfsAction {
    Initialize,
    Track {
        directory: String,
        pattern: String,
    },
    Untrack {
        directory: String,
        pattern: String,
    },
    Fetch {
        remote: String,
        #[serde(rename = "expectedHead")]
        expected_head: String,
    },
    Pull {
        remote: String,
        #[serde(rename = "expectedHead")]
        expected_head: String,
    },
    Push {
        remote: String,
        #[serde(rename = "expectedHead")]
        expected_head: String,
    },
    Checkout {
        #[serde(rename = "expectedHead")]
        expected_head: String,
    },
    Prune {
        token: String,
    },
}
#[derive(Serialize)]
pub(crate) struct PruneReview {
    pub report: String,
    pub token: String,
}
fn digest(value: &str) -> String {
    let mut hash = DefaultHasher::new();
    value.hash(&mut hash);
    format!("{:016x}", hash.finish())
}
pub(crate) fn review_prune(repository: &Path) -> Result<PruneReview, GitError> {
    if !storage(repository)?.1 {
        return Err(invalid(
            "Refusing to prune custom/shared/symlinked LFS object storage.",
        ));
    }
    let output = run_git(repository, &["lfs", "prune", "--dry-run", "--verbose"])?;
    let head = run_git(repository, &["rev-parse", "--verify", "HEAD"])?;
    let remote = run_git(repository, &["config", "--get", "lfs.pruneremotetocheck"])
        .map(|out| out.stdout.trim().to_owned())
        .unwrap_or_else(|_| "origin".into());
    let endpoint = run_git(repository, &["remote", "get-url", &remote])
        .map(|out| out.stdout.trim().to_owned())
        .unwrap_or_else(|_| "No configured URL".into());
    let report = format!(
        "Verification remote: {remote} ({endpoint})\n{}{}",
        output.stdout, output.stderr
    );
    // Bind the confirmation to the effective LFS/remote configuration as well
    // as HEAD and object eligibility. Values stay inside the opaque token.
    let config = match run_git(
        repository,
        &["config", "--null", "--get-regexp", "^(lfs\\.|remote\\.)"],
    ) {
        Ok(output) => output.stdout,
        Err(GitError::CommandFailed { output, .. }) if output.exit_code == Some(1) => String::new(),
        Err(error) => return Err(error),
    };
    let mut eligibility: Vec<_> = report
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    eligibility.sort_unstable();
    let token = digest(&format!(
        "{:?}{}{}{}",
        eligibility,
        head.stdout,
        storage(repository)?.0,
        config
    ));
    Ok(PruneReview {
        report: sanitize_diagnostic(&report),
        token,
    })
}
fn expected_head(repository: &Path, expected: &str) -> Result<(), GitError> {
    if run_git(repository, &["rev-parse", "--verify", "HEAD"])?
        .stdout
        .trim()
        != expected
    {
        return Err(invalid(
            "HEAD changed. Refresh LFS status and review this action again.",
        ));
    }
    Ok(())
}
fn remote(repository: &Path, name: &str) -> Result<(), GitError> {
    if name.starts_with('-')
        || !super::delivery::remotes(repository)?
            .iter()
            .any(|remote| remote == name)
    {
        return Err(invalid("Choose an existing configured remote."));
    }
    Ok(())
}
fn attributes_directory(repository: &Path, directory: &str) -> Result<PathBuf, GitError> {
    let root = repository
        .canonicalize()
        .map_err(|e| invalid(&e.to_string()))?;
    let directory = if directory.is_empty() {
        root.clone()
    } else {
        validate_path(directory)?;
        root.join(directory)
    };
    let directory = directory
        .canonicalize()
        .map_err(|e| invalid(&e.to_string()))?;
    if !directory.starts_with(&root) || !directory.is_dir() {
        return Err(invalid(
            "Choose an attributes directory inside this worktree.",
        ));
    }
    let top = run_git(&directory, &["rev-parse", "--show-toplevel"])?;
    if PathBuf::from(top.stdout.trim_end_matches(['\r', '\n']))
        .canonicalize()
        .map_err(|e| invalid(&e.to_string()))?
        != root
    {
        return Err(invalid(
            "That directory belongs to another repository or worktree.",
        ));
    }
    let attributes = directory.join(".gitattributes");
    if let Ok(metadata) = fs::symlink_metadata(&attributes) {
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 512 * 1024 {
            return Err(invalid(
                "Use external Git for symlinked, nonregular, or oversized .gitattributes files.",
            ));
        }
        let text = fs::read_to_string(attributes).map_err(|e| invalid(&e.to_string()))?;
        if text.contains('\0') || text.lines().any(|line| line.len() > 60000) {
            return Err(invalid(
                "Use external Git for unsupported .gitattributes content.",
            ));
        }
    }
    Ok(directory)
}
pub(crate) fn execute(repository: &Path, action: LfsAction) -> Result<GitOutput, GitError> {
    version(repository).map_err(|_| invalid("Install Git LFS using its official setup guide, then restart Branchlight so system Git can find it."))?;
    if super::conflicts::get_repository_operation(repository)? != RepositoryOperation::None
        || !super::get_repository_status(repository)?
            .conflicts
            .is_empty()
    {
        return Err(invalid(
            "Finish or abort the active Git operation before changing LFS state.",
        ));
    }
    let tracking = matches!(action, LfsAction::Track { .. });
    let transfer_command = match &action {
        LfsAction::Fetch { .. } => "fetch",
        LfsAction::Pull { .. } => "pull",
        _ => "push",
    };
    if !matches!(action, LfsAction::Initialize) {
        let state = inspect(repository)?;
        if !state.filter_configured
            || (matches!(action, LfsAction::Push { .. }) && !state.hook_installed)
        {
            return Err(invalid(
                "Configure LFS filters before changing LFS state; pushing also requires the LFS pre-push hook.",
            ));
        }
    }
    let mut cwd = repository.to_owned();
    let arguments: Vec<String> = match action {
        LfsAction::Initialize => vec!["lfs".into(), "install".into(), "--local".into()],
        LfsAction::Track { directory, pattern } | LfsAction::Untrack { directory, pattern } => {
            if pattern.is_empty()
                || pattern.contains(['\0', '\n', '\r'])
                || pattern.starts_with('/')
                || Path::new(&pattern).is_absolute()
                || pattern.split('/').any(|part| part == "..")
            {
                return Err(invalid(
                    "Enter a repository-relative LFS pattern without traversal or line breaks.",
                ));
            }
            cwd = attributes_directory(repository, &directory)?;
            vec![
                "lfs".into(),
                if tracking { "track" } else { "untrack" }.into(),
                "--".into(),
                pattern,
            ]
        }
        LfsAction::Fetch {
            remote: name,
            expected_head: head,
        }
        | LfsAction::Pull {
            remote: name,
            expected_head: head,
        }
        | LfsAction::Push {
            remote: name,
            expected_head: head,
        } => {
            let command = transfer_command;
            expected_head(repository, &head)?;
            remote(repository, &name)?;
            let mut args = vec!["lfs".into(), command.into(), "--".into(), name];
            if command != "pull" {
                args.push("HEAD".into());
            }
            args
        }
        LfsAction::Checkout {
            expected_head: head,
        } => {
            expected_head(repository, &head)?;
            vec!["lfs".into(), "checkout".into()]
        }
        LfsAction::Prune { token } => {
            if review_prune(repository)?.token != token {
                return Err(invalid(
                    "LFS prune eligibility changed. Generate a fresh preview before pruning.",
                ));
            }
            vec![
                "lfs".into(),
                "prune".into(),
                "--verbose".into(),
                "--verify-remote".into(),
                "--verify-unreachable".into(),
                "--when-unverified=halt".into(),
            ]
        }
    };
    report(repository, true, "Starting Git LFS operation…");
    let observer = |stderr, bytes: &[u8]| observe(repository, stderr, bytes);
    let result = run_git_observed(
        &cwd,
        &arguments.iter().map(String::as_str).collect::<Vec<_>>(),
        &[
            ("GIT_LFS_FORCE_PROGRESS", "1"),
            ("GIT_TERMINAL_PROMPT", "0"),
        ],
        Some(&observer),
    );
    report(
        repository,
        false,
        if result.is_ok() {
            "Git LFS operation completed."
        } else {
            "Git LFS stopped with an error. Review the refreshed state and Git error."
        },
    );
    result.map(|mut output| {
        output.stdout = sanitize_diagnostic(&output.stdout);
        output.stderr = sanitize_diagnostic(&output.stderr);
        output
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::{Command, Stdio};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "branchlight-lfs-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                crate::git::fixture_nonce()
            ));
            fs::create_dir(&root).unwrap();
            let f = Self(root);
            f.git(&["init", "-b", "main"]);
            f.git(&["config", "user.name", "LFS Tests"]);
            f.git(&["config", "user.email", "lfs@example.invalid"]);
            f.git(&["commit", "--allow-empty", "-m", "Base"]);
            f
        }
        fn git(&self, args: &[&str]) -> String {
            let out = Command::new("git")
                .current_dir(&self.0)
                .args(args)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "{:?}: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).trim().into()
        }
        fn installed(&self) -> bool {
            if version(&self.0).is_ok() {
                true
            } else {
                eprintln!(
                    "Git LFS unavailable; run this integration test with system git-lfs on PATH."
                );
                false
            }
        }
        fn head(&self) -> String {
            self.git(&["rev-parse", "HEAD"])
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn progress_redacts_complete_lines_across_chunks_without_joining_streams() {
        let f = Fixture::new();
        report(&f.0, true, "Starting");
        observe(&f.0, false, b"https://user:sec");
        assert_eq!(progress(&f.0).message, "Starting");
        observe(&f.0, true, b"Uploading 50%\r");
        assert_eq!(progress(&f.0).message, "Uploading 50%");
        observe(&f.0, false, b"ret@example.invalid/a\n");
        assert!(!progress(&f.0).message.contains("secret"));
        observe(&f.0, false, &vec![b'x'; 17000]);
        observe(&f.0, false, b"discarded\nSafe progress\n");
        assert_eq!(progress(&f.0).message, "Safe progress");
    }

    #[test]
    fn tracks_nested_attributes_and_hydrates_pointers_without_overwriting_edits() {
        let f = Fixture::new();
        if !f.installed() {
            return;
        }
        execute(&f.0, LfsAction::Initialize).unwrap();
        let state = inspect(&f.0).unwrap();
        assert!(state.filter_configured && state.hook_installed && state.prune_allowed);
        fs::create_dir(f.0.join("nested space")).unwrap();
        execute(
            &f.0,
            LfsAction::Track {
                directory: "nested space".into(),
                pattern: "*.bin".into(),
            },
        )
        .unwrap();
        let attrs = f.0.join("nested space/.gitattributes");
        assert!(fs::read_to_string(&attrs).unwrap().contains("filter=lfs"));
        assert!(f.git(&["status", "--porcelain"]).contains("nested space"));
        let file = f.0.join("nested space/file [x].bin");
        fs::write(&file, "Original large content").unwrap();
        f.git(&["add", "."]);
        f.git(&["commit", "-m", "Tracked content"]);
        let pointer = f.git(&["show", "HEAD:nested space/file [x].bin"]);
        assert!(pointer.starts_with("version https://git-lfs.github.com/spec/v1"));
        let state = inspect(&f.0).unwrap();
        assert_eq!(state.files.len(), 1);
        assert!(state.files[0].checkout && state.files[0].downloaded);
        fs::write(&file, format!("{pointer}\n")).unwrap();
        assert!(!inspect(&f.0).unwrap().files[0].checkout);
        execute(
            &f.0,
            LfsAction::Checkout {
                expected_head: f.head(),
            },
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "Original large content");
        fs::write(&file, "Unrelated user edits").unwrap();
        execute(
            &f.0,
            LfsAction::Checkout {
                expected_head: f.head(),
            },
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "Unrelated user edits");
        execute(
            &f.0,
            LfsAction::Untrack {
                directory: "nested space".into(),
                pattern: "*.bin".into(),
            },
        )
        .unwrap();
        assert!(!fs::read_to_string(attrs).unwrap().contains("filter=lfs"));
        assert!(execute(
            &f.0,
            LfsAction::Checkout {
                expected_head: "outdated".into()
            }
        )
        .is_err());
        assert!(execute(
            &f.0,
            LfsAction::Track {
                directory: "../outside".into(),
                pattern: "*.bin".into()
            }
        )
        .is_err());
    }

    #[test]
    fn transfers_objects_to_local_remote_and_prunes_only_verified_orphans() {
        let f = Fixture::new();
        if !f.installed() {
            return;
        }
        execute(&f.0, LfsAction::Initialize).unwrap();
        let remote = f.0.join("remote.git");
        f.git(&["init", "--bare", remote.to_str().unwrap()]);
        f.git(&["remote", "add", "origin", remote.to_str().unwrap()]);
        execute(
            &f.0,
            LfsAction::Track {
                directory: "".into(),
                pattern: "*.bin".into(),
            },
        )
        .unwrap();
        fs::write(f.0.join("file.bin"), "Retained content").unwrap();
        f.git(&["add", ".gitattributes", "file.bin"]);
        f.git(&["commit", "-m", "LFS content"]);
        execute(
            &f.0,
            LfsAction::Push {
                remote: "origin".into(),
                expected_head: f.head(),
            },
        )
        .unwrap();
        f.git(&["push", "origin", "main"]);
        let mut child = Command::new("git")
            .current_dir(&f.0)
            .args(["lfs", "clean", "orphan.bin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(b"Unreferenced content")
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let pointer = String::from_utf8(output.stdout).unwrap();
        let oid = pointer
            .lines()
            .find_map(|line| line.strip_prefix("oid sha256:"))
            .unwrap();
        let object = PathBuf::from(inspect(&f.0).unwrap().storage_path)
            .join(&oid[..2])
            .join(&oid[2..4])
            .join(oid);
        assert!(object.exists());
        assert!(execute(
            &f.0,
            LfsAction::Prune {
                token: "stale".into()
            }
        )
        .is_err());
        // A local standalone transfer adapter reports batch entries as available
        // without an HTTP existence check. Exercise a real batch missing-object
        // response to verify that the CLI refusal propagates without deletion.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        f.git(&["config", "lfs.url", &format!("http://{address}/lfs")]);
        let preview = review_prune(&f.0).unwrap();
        let response_oid = oid.to_owned();
        let server = std::thread::spawn(move || {
            use std::io::Read;
            listener.set_nonblocking(true).unwrap();
            let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
            let (mut stream, _) = loop {
                match listener.accept() {
                    Ok(connection) => break connection,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && std::time::Instant::now() < until =>
                    {
                        std::thread::sleep(std::time::Duration::from_millis(20))
                    }
                    Err(error) => panic!("LFS batch server did not receive a request: {error}"),
                }
            };
            // Windows can inherit the listener's nonblocking mode on accept.
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .unwrap();
            let mut buffer = [0; 8192];
            let mut request = Vec::new();
            let header_end = loop {
                let count = stream.read(&mut buffer).unwrap();
                assert!(count > 0, "LFS batch request closed before its headers");
                request.extend_from_slice(&buffer[..count]);
                assert!(request.len() <= 65536, "LFS test request exceeds its bound");
                if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    break end + 4;
                }
            };
            let headers = String::from_utf8_lossy(&request[..header_end]);
            assert!(headers.starts_with("POST /lfs/objects/batch "));
            let length: usize = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse().unwrap())
                })
                .unwrap();
            assert!(header_end + length <= 65536);
            if headers
                .to_ascii_lowercase()
                .contains("expect: 100-continue")
            {
                stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").unwrap();
            }
            while request.len() < header_end + length {
                let count = stream.read(&mut buffer).unwrap();
                assert!(count > 0, "LFS batch request closed before its body");
                request.extend_from_slice(&buffer[..count]);
            }
            let body = serde_json::json!({"objects":[{"oid":response_oid,"size":20,"error":{"code":404,"message":"Missing object"}}]}).to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.git-lfs+json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        assert!(execute(
            &f.0,
            LfsAction::Prune {
                token: preview.token
            }
        )
        .is_err());
        server.join().unwrap();
        f.git(&["config", "--unset", "lfs.url"]);
        assert!(object.exists(), "unverified content must survive pruning");
        f.git(&["lfs", "push", "--object-id", "origin", oid]);
        let preview = review_prune(&f.0).unwrap();
        execute(
            &f.0,
            LfsAction::Prune {
                token: preview.token,
            },
        )
        .unwrap();
        assert!(!object.exists(), "verified orphan should be removed");
        let state = inspect(&f.0).unwrap();
        let retained_oid = &state.files[0].oid;
        let retained = PathBuf::from(&state.storage_path)
            .join(&retained_oid[..2])
            .join(&retained_oid[2..4])
            .join(retained_oid);
        fs::remove_file(retained).unwrap();
        fs::write(
            git_path(&f.0, "hooks/pre-push").unwrap(),
            "#!/bin/sh\necho Shared hook\n",
        )
        .unwrap();
        assert!(!inspect(&f.0).unwrap().hook_installed);
        execute(
            &f.0,
            LfsAction::Fetch {
                remote: "origin".into(),
                expected_head: f.head(),
            },
        )
        .unwrap();
        assert!(inspect(&f.0).unwrap().files[0].downloaded);
        fs::write(f.0.join("file.bin"), "Preserve modified content").unwrap();
        execute(
            &f.0,
            LfsAction::Pull {
                remote: "origin".into(),
                expected_head: f.head(),
            },
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(f.0.join("file.bin")).unwrap(),
            "Preserve modified content"
        );
        f.git(&["config", "lfs.storage", "custom-shared-storage"]);
        assert!(!inspect(&f.0).unwrap().prune_allowed);
        assert!(review_prune(&f.0).is_err());
    }
    #[test]
    fn non_push_actions_work_with_configured_filters_and_an_unrelated_shared_hook() {
        let f = Fixture::new();
        if !f.installed() {
            return;
        }
        execute(&f.0, LfsAction::Initialize).unwrap();
        let hooks = f.0.join("shared-hooks");
        fs::create_dir(&hooks).unwrap();
        fs::write(
            hooks.join("pre-push"),
            "#!/bin/sh\necho Existing shared hook\n",
        )
        .unwrap();
        f.git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
        let state = inspect(&f.0).unwrap();
        assert!(state.filter_configured && !state.hook_installed);
        execute(
            &f.0,
            LfsAction::Track {
                directory: "".into(),
                pattern: "*.bin".into(),
            },
        )
        .unwrap();
        execute(
            &f.0,
            LfsAction::Untrack {
                directory: "".into(),
                pattern: "*.bin".into(),
            },
        )
        .unwrap();
        execute(
            &f.0,
            LfsAction::Checkout {
                expected_head: f.head(),
            },
        )
        .unwrap();
        assert!(execute(
            &f.0,
            LfsAction::Push {
                remote: "origin".into(),
                expected_head: f.head()
            }
        )
        .is_err());
        assert!(fs::read_to_string(hooks.join("pre-push"))
            .unwrap()
            .contains("Existing shared hook"));
    }
    #[test]
    fn preserves_existing_hooks_and_rejects_symlinked_attributes_and_active_operations() {
        let f = Fixture::new();
        if !f.installed() {
            return;
        }
        let hook = git_path(&f.0, "hooks/pre-push").unwrap();
        fs::create_dir_all(hook.parent().unwrap()).unwrap();
        fs::write(&hook, "#!/bin/sh\necho Existing user hook\n").unwrap();
        assert!(execute(&f.0, LfsAction::Initialize).is_err());
        assert!(fs::read_to_string(&hook)
            .unwrap()
            .contains("Existing user hook"));
        fs::remove_file(&hook).unwrap();
        execute(&f.0, LfsAction::Initialize).unwrap();
        #[cfg(unix)]
        {
            let outside = f.0.join("preserved-attributes");
            fs::write(&outside, "unrelated text\n").unwrap();
            std::os::unix::fs::symlink(&outside, f.0.join(".gitattributes")).unwrap();
            assert!(execute(
                &f.0,
                LfsAction::Track {
                    directory: "".into(),
                    pattern: "*.bin".into()
                }
            )
            .is_err());
            assert_eq!(fs::read_to_string(outside).unwrap(), "unrelated text\n");
        }
        fs::write(git_path(&f.0, "MERGE_HEAD").unwrap(), f.head()).unwrap();
        assert!(execute(&f.0, LfsAction::Initialize).is_err());
    }
}
