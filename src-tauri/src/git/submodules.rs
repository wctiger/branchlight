use super::{
    inspection::{invalid, validate_path},
    runner::{run_git, sanitize_diagnostic},
};
use crate::models::{GitError, GitOutput, Repository, RepositoryOperation};
use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, BTreeMap},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Submodule {
    pub name: String,
    pub path: String,
    pub url: Option<String>,
    pub branch: Option<String>,
    pub expected_oid: Option<String>,
    pub current_oid: Option<String>,
    pub initialized: bool,
    pub dirty: bool,
    pub error: Option<String>,
    // Included in review snapshots, so replacing a child repository invalidates
    // its confirmation even if its commit and working-tree status are identical.
    pub common_directory: Option<String>,
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum SubmoduleAction {
    Add {
        path: String,
        source: String,
    },
    Edit {
        path: String,
        url: String,
        branch: Option<String>,
    },
    Initialize {
        path: String,
    },
    Update {
        path: String,
    },
    Reset {
        path: String,
    },
    Remove {
        path: String,
    },
}
impl SubmoduleAction {
    fn path(&self) -> &str {
        match self {
            Self::Add { path, .. }
            | Self::Edit { path, .. }
            | Self::Initialize { path }
            | Self::Update { path }
            | Self::Reset { path }
            | Self::Remove { path } => path,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubmoduleReview {
    pub action: SubmoduleAction,
    pub token: String,
    pub path: String,
    pub expected_oid: Option<String>,
    pub current_oid: Option<String>,
    pub effects: String,
    pub parent_head: Option<String>,
}
fn digest(value: &[u8]) -> String {
    let mut hash = DefaultHasher::new();
    value.hash(&mut hash);
    format!("{:016x}", hash.finish())
}
fn modules_text(repository: &Path) -> Result<Vec<u8>, GitError> {
    let file = repository.join(".gitmodules");
    match fs::symlink_metadata(&file) {
        Ok(metadata)
            if !metadata.file_type().is_symlink()
                && metadata.is_file()
                && metadata.len() <= 512 * 1024 =>
        {
            fs::read(file).map_err(|e| invalid(&e.to_string()))
        }
        Ok(_) => Err(invalid(
            "Use external Git for symlinked, nonregular, or oversized .gitmodules files.",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(invalid(&error.to_string())),
    }
}
fn optional_config(repository: &Path, arguments: &[&str]) -> Result<Option<String>, GitError> {
    match run_git(repository, arguments) {
        Ok(output) => Ok(Some(output.stdout.trim_end_matches(['\r', '\n']).into())),
        Err(GitError::CommandFailed { output, .. }) if output.exit_code == Some(1) => Ok(None),
        Err(error) => Err(error),
    }
}
fn config(repository: &Path, name: &str, field: &str) -> Result<Option<String>, GitError> {
    optional_config(
        repository,
        &[
            "config",
            "--file",
            ".gitmodules",
            "--get",
            &format!("submodule.{name}.{field}"),
        ],
    )
}
fn child_path(repository: &Path, relative: &str) -> Result<PathBuf, GitError> {
    validate_path(relative)?;
    if relative.contains(['\n', '\r'])
        || relative
            .split('/')
            .any(|part| part.eq_ignore_ascii_case(".git"))
    {
        return Err(invalid(
            "Choose a submodule path without Git metadata components or line breaks.",
        ));
    }
    let root = repository
        .canonicalize()
        .map_err(|e| invalid(&e.to_string()))?;
    let mut path = root.clone();
    for component in Path::new(relative).components() {
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(invalid("Submodule paths must not traverse symlinks."))
            }
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(invalid(&error.to_string())),
        }
    }
    Ok(path)
}
fn initialized_path(repository: &Path, relative: &str) -> Result<Option<PathBuf>, GitError> {
    let path = child_path(repository, relative)?;
    if !path.join(".git").exists() {
        return Ok(None);
    }
    let child = super::repository::open_repository(&path)?;
    let root = Path::new(&child.path)
        .canonicalize()
        .map_err(|e| invalid(&e.to_string()))?;
    if root != path.canonicalize().map_err(|e| invalid(&e.to_string()))? {
        return Err(invalid(
            "Submodule path does not resolve to its own repository root.",
        ));
    }
    Ok(Some(path))
}
fn status_bytes(repository: &Path) -> Result<Vec<u8>, GitError> {
    Ok(run_git(
        repository,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=none",
        ],
    )?
    .stdout_bytes)
}
pub(crate) fn list(repository: &Path) -> Result<Vec<Submodule>, GitError> {
    let text = modules_text(repository)?;
    let mut configured = BTreeMap::new();
    if !text.is_empty() {
        if let Some(output) = optional_config(
            repository,
            &[
                "config",
                "--null",
                "--file",
                ".gitmodules",
                "--get-regexp",
                "^submodule\\..*\\.path$",
            ],
        )? {
            for record in output.split('\0').filter(|record| !record.is_empty()) {
                let (key, path) = record
                    .split_once('\n')
                    .ok_or_else(|| invalid("Malformed submodule configuration."))?;
                let name = key
                    .strip_prefix("submodule.")
                    .and_then(|key| key.strip_suffix(".path"))
                    .ok_or_else(|| invalid("Malformed submodule name."))?;
                if name.is_empty()
                    || name.contains(['\n', '\r', '\0'])
                    || configured
                        .insert(path.to_owned(), name.to_owned())
                        .is_some()
                {
                    return Err(invalid(
                        "Duplicate paths or unsupported submodule names in .gitmodules.",
                    ));
                }
            }
        }
    }
    let index = run_git(repository, &["ls-files", "--stage", "-z"])?;
    let mut expected = BTreeMap::new();
    for record in index.stdout.split('\0').filter(|record| !record.is_empty()) {
        let (metadata, path) = record
            .split_once('\t')
            .ok_or_else(|| invalid("Malformed Git index record."))?;
        let parts: Vec<_> = metadata.split_whitespace().collect();
        if parts.len() == 3 && parts[0] == "160000" {
            configured.entry(path.into()).or_insert_with(|| path.into());
            expected.insert(
                path.to_owned(),
                if parts[2] == "0" {
                    Some(parts[1].to_owned())
                } else {
                    None
                },
            );
        }
    }
    if configured.len() > 256 {
        return Err(invalid(
            "More than 256 direct submodules; manage this repository using external Git.",
        ));
    }
    configured.into_iter().map(|(path, name)| {
        let url = config(repository, &name, "url")?.map(|url| sanitize_diagnostic(&url));
        let branch = config(repository, &name, "branch")?;
        let expected_oid = expected.remove(&path).flatten();
        let mut module = Submodule {
            name, path, url, branch, expected_oid,
            current_oid: None,
            initialized: false,
            dirty: false,
            error: None,
            common_directory: None,
        };
        match initialized_path(repository, &module.path) {
            Ok(Some(child)) => {
                let details = (
                    super::inspection::resolve(&child, "HEAD"),
                    status_bytes(&child),
                    super::runner::repository_identity(&child),
                );
                match details {
                    (Ok(head), Ok(status), Ok(identity)) => {
                        module.current_oid = Some(head);
                        module.dirty = !status.is_empty();
                        module.initialized = true;
                        module.common_directory = Some(identity);
                    }
                    _ => module.error = Some("Cannot inspect this submodule's HEAD, status, or metadata. Use external Git to recover it.".into()),
                }
            }
            Ok(None) => (),
            Err(error) => module.error = Some(error.to_string()),
        }
        Ok(module)
    }).collect()
}

pub(crate) fn lock_paths(repository: &Path) -> Result<Vec<String>, GitError> {
    let mut paths = vec![repository.to_string_lossy().into_owned()];
    for module in list(repository)? {
        if module.initialized {
            paths.push(
                child_path(repository, &module.path)?
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }
    Ok(paths)
}
pub(crate) fn open(repository: &Path, path: &str) -> Result<Repository, GitError> {
    let modules = list(repository)?;
    let module = modules
        .iter()
        .find(|item| item.path == path)
        .ok_or_else(|| invalid("Submodule is no longer configured."))?;
    if !module.initialized {
        return Err(invalid(
            "Initialize this submodule before opening its repository.",
        ));
    }
    super::repository::open_repository(&child_path(repository, path)?)
}
fn guard(repository: &Path) -> Result<(), GitError> {
    if super::conflicts::get_repository_operation(repository)? != RepositoryOperation::None
        || !super::get_repository_status(repository)?
            .conflicts
            .is_empty()
    {
        return Err(invalid(
            "Finish or abort the parent's active Git operation before changing submodules.",
        ));
    }
    Ok(())
}
fn attributes_clean(repository: &Path) -> Result<(), GitError> {
    if !run_git(
        repository,
        &[
            "--literal-pathspecs",
            "status",
            "--porcelain",
            "--",
            ".gitmodules",
        ],
    )?
    .stdout
    .is_empty()
    {
        return Err(invalid("Commit or stash pending .gitmodules changes before this action so unrelated configuration edits are not staged or overwritten."));
    }
    Ok(())
}
fn remove_config_section(
    repository: &Path,
    file_args: &[&str],
    name: &str,
) -> Result<(), GitError> {
    let mut args = vec!["config"];
    args.extend(file_args);
    args.extend(["--null", "--name-only", "--get-regexp", "^submodule\\."]);
    let keys = optional_config(repository, &args)?.unwrap_or_default();
    let section = format!("submodule.{name}");
    for key in keys
        .split('\0')
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter(|key| {
            key.rsplit_once('.')
                .is_some_and(|(prefix, _)| prefix == section)
        })
    {
        let mut unset = vec!["config"];
        unset.extend(file_args);
        unset.extend(["--unset-all", key]);
        run_git(repository, &unset)?;
    }
    Ok(())
}
fn validate_source(source: &str) -> Result<(), GitError> {
    if Path::new(source).is_absolute()
        || source.to_ascii_lowercase().starts_with("file:")
        || source.starts_with("\\\\")
        || (source.as_bytes().get(1) == Some(&b':')
            && source.as_bytes()[0].is_ascii_alphabetic()
            && matches!(source.as_bytes().get(2), Some(b'/' | b'\\')))
    {
        return Err(invalid("Use a remote submodule URL. Local file sources are not supported; Git normally disables file transport for submodule clones."));
    }
    super::repository::validate_clone_source(source)
}
fn source_head(repository: &Path, source: &str) -> Result<String, GitError> {
    validate_source(source)?;
    let out = run_git(
        repository,
        &["ls-remote", "--exit-code", "--", source, "HEAD"],
    )?;
    out.stdout
        .lines()
        .find_map(|line| {
            line.split_once('\t')
                .filter(|(_, name)| *name == "HEAD")
                .map(|(oid, _)| oid.to_owned())
        })
        .filter(|oid| matches!(oid.len(), 40 | 64) && oid.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| invalid("The source remote has no usable default HEAD commit."))
}
fn untracked_paths(child: &Path) -> Result<String, GitError> {
    let mut paths = run_git(child, &["ls-files", "--others", "--exclude-standard", "-z"])?.stdout;
    paths.push_str(
        &run_git(
            child,
            &[
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "-z",
            ],
        )?
        .stdout,
    );
    Ok(paths)
}
fn reset_collisions(child: &Path, target: &str) -> Result<(), GitError> {
    let tree = run_git(child, &["ls-tree", "-r", "--name-only", "-z", target])?;
    let mut tracked = std::collections::HashSet::new();
    let mut directories = std::collections::HashSet::new();
    for path in tree.stdout.split('\0').filter(|path| !path.is_empty()) {
        tracked.insert(path);
        let mut prefix = path;
        while let Some((parent, _)) = prefix.rsplit_once('/') {
            directories.insert(parent);
            prefix = parent;
        }
    }
    let untracked = untracked_paths(child)?;
    for file in untracked.split('\0').filter(|path| !path.is_empty()) {
        let file = file.trim_end_matches('/');
        let mut ancestor_tracked = false;
        let mut prefix = file;
        while let Some((parent, _)) = prefix.rsplit_once('/') {
            if tracked.contains(parent) {
                ancestor_tracked = true;
                break;
            }
            prefix = parent;
        }
        if tracked.contains(file) || directories.contains(file) || ancestor_tracked {
            return Err(invalid("An untracked or ignored path would be overwritten by this reset. Move or save it using external Git before retrying."));
        }
    }
    Ok(())
}
pub(crate) fn review(
    repository: &Path,
    action: SubmoduleAction,
) -> Result<SubmoduleReview, GitError> {
    guard(repository)?;
    let path = child_path(repository, action.path())?;
    let modules = list(repository)?;
    let existing = modules.iter().find(|module| module.path == action.path());
    let mut expected_oid = existing.and_then(|module| module.expected_oid.clone());
    let current_oid = existing.and_then(|module| module.current_oid.clone());
    let effects = if let SubmoduleAction::Add { source, .. } = &action {
        attributes_clean(repository)?;
        if path.exists()
            || existing.is_some()
            || modules
                .iter()
                .any(|module| action.path().starts_with(&format!("{}/", module.path)))
        {
            return Err(invalid("Choose a new submodule path outside existing submodules; existing destinations are never overwritten."));
        }
        validate_source(source)?;
        if !source.contains(':') {
            return Err(invalid("Use a remote URL when adding a submodule."));
        }
        let mut ancestor = path
            .parent()
            .ok_or_else(|| invalid("Choose a new submodule path."))?;
        while !ancestor.exists() {
            ancestor = ancestor
                .parent()
                .ok_or_else(|| invalid("Choose a path inside this repository."))?;
        }
        let owner = super::repository::open_repository(ancestor)?;
        if Path::new(&owner.path)
            .canonicalize()
            .map_err(|e| invalid(&e.to_string()))?
            != repository
                .canonicalize()
                .map_err(|e| invalid(&e.to_string()))?
        {
            return Err(invalid("The destination parent belongs to another repository. Open that repository to manage its submodules."));
        }
        expected_oid = Some(source_head(repository, source)?);
        "Clone the source, check out the reviewed default HEAD commit, and stage only this gitlink and .gitmodules. Existing parent changes remain unchanged. A failed clone retains partial files for inspection."
    } else {
        let module = existing.ok_or_else(|| invalid("Submodule is no longer configured."))?;
        if module.error.is_some() || module.expected_oid.is_none() {
            return Err(invalid("Repair the submodule's configuration or unmerged index entry using external Git first."));
        }
        if let Some(child) = initialized_path(repository, &module.path)? {
            guard(&child)?;
        }
        match &action {
            SubmoduleAction::Edit {url,branch,..} => {
                attributes_clean(repository)?;
                validate_source(url)?;
                if let Some(branch) = branch {
                    if branch.is_empty() || branch.starts_with('-') || branch.contains(['\n','\r','\0']) || branch.contains("@{") {return Err(invalid("Enter a branch name, or clear the branch to use the remote default."));}
                    if branch != "." {run_git(repository,&["check-ref-format","--branch",branch])?;}
                }
                "Change the tracked submodule URL/branch settings and synchronize the URL into local configuration. Configuration changes remain visible for review and commit; no objects are fetched and no commit is checked out."
            },
            SubmoduleAction::Initialize {..} | SubmoduleAction::Update {..} => "Initialize local configuration if needed, fetch missing objects using local Git credentials, and check out the parent's expected index revision with Git's normal local-change protection. Nested submodules are not recursively changed.",
            SubmoduleAction::Reset {..} => {
                let child = initialized_path(repository,&module.path)?.ok_or_else(||invalid("Initialize this submodule before resetting it."))?;
                reset_collisions(&child,module.expected_oid.as_deref().unwrap())?;
                "Discard tracked changes in this submodule and detach HEAD at the parent's expected index revision. Local branch references, unrelated untracked/ignored paths, the parent index, and nested submodule work are preserved. Paths that would overwrite untracked/ignored work are refused."
            },
            SubmoduleAction::Remove {..} => {
                attributes_clean(repository)?;
                if let Some(child) = initialized_path(repository, &module.path)? {
                    if !untracked_paths(&child)?.is_empty() {return Err(invalid("Save or move untracked and ignored submodule files before removal. They are never automatically deleted."));}
                } else if path.is_dir() && fs::read_dir(&path).map_err(|e|invalid(&e.to_string()))?.next().is_some() {
                    return Err(invalid("The uninitialized submodule path contains files. Save or move them before removal."));
                }
                if module.dirty || (module.initialized && module.current_oid != module.expected_oid) {return Err(invalid("Save submodule changes and reconcile its checked-out revision with the parent before removal. Removal never forces deletion."));}
                "Remove this submodule working directory and stage the gitlink/.gitmodules removal using Git's normal safety checks. Git retains its module repository metadata for recovery. Other parent paths and staged work remain unchanged."
            },
            SubmoduleAction::Add {..} => unreachable!(),
        }
    };
    let mut snapshot = serde_json::to_vec(&modules).map_err(|e| invalid(&e.to_string()))?;
    snapshot.extend(modules_text(repository)?);
    snapshot.extend(status_bytes(repository)?);
    snapshot.extend(run_git(repository, &["ls-files", "--stage", "-z"])?.stdout_bytes);
    snapshot.extend(
        optional_config(
            repository,
            &[
                "config",
                "--local",
                "--null",
                "--get-regexp",
                "^submodule\\.",
            ],
        )?
        .unwrap_or_default()
        .as_bytes(),
    );
    snapshot.extend(serde_json::to_vec(&action).map_err(|e| invalid(&e.to_string()))?);
    snapshot.extend(expected_oid.as_deref().unwrap_or_default().as_bytes());
    let parent_head = optional_config(repository, &["rev-parse", "--verify", "--quiet", "HEAD"])?;
    snapshot.extend(parent_head.as_deref().unwrap_or_default().as_bytes());
    Ok(SubmoduleReview {
        parent_head,
        path: action.path().into(),
        action,
        token: digest(&snapshot),
        expected_oid,
        current_oid,
        effects: effects.into(),
    })
}
pub(crate) fn execute(
    repository: &Path,
    action: SubmoduleAction,
    token: &str,
) -> Result<GitOutput, GitError> {
    let fresh = review(repository, action.clone())?;
    if fresh.token != token {
        return Err(invalid("Parent/submodule state or configuration changed. Refresh and review this operation again."));
    }
    let path = action.path();
    match &action {
        SubmoduleAction::Add { source, .. } => {
            let output = run_git(
                repository,
                &[
                    "-c",
                    "submodule.recurse=false",
                    "submodule",
                    "add",
                    "--",
                    source,
                    path,
                ],
            )?;
            let child = initialized_path(repository,path)?.ok_or_else(||invalid("Clone did not create an initialized submodule. Inspect the retained path using external Git."))?;
            run_git(
                &child,
                &[
                    "-c",
                    "submodule.recurse=false",
                    "checkout",
                    "--detach",
                    fresh.expected_oid.as_deref().unwrap(),
                    "--",
                ],
            )?;
            run_git(repository, &["--literal-pathspecs", "add", "--", path])?;
            Ok(output)
        }
        SubmoduleAction::Edit { url, branch, .. } => {
            run_git(
                repository,
                &[
                    "--literal-pathspecs",
                    "submodule",
                    "set-url",
                    "--",
                    path,
                    url,
                ],
            )?;
            match branch {
                Some(branch) => run_git(
                    repository,
                    &[
                        "--literal-pathspecs",
                        "submodule",
                        "set-branch",
                        "--branch",
                        branch,
                        "--",
                        path,
                    ],
                ),
                None => run_git(
                    repository,
                    &[
                        "--literal-pathspecs",
                        "submodule",
                        "set-branch",
                        "--default",
                        "--",
                        path,
                    ],
                ),
            }
        }
        SubmoduleAction::Initialize { .. } | SubmoduleAction::Update { .. } => run_git(
            repository,
            &[
                "--literal-pathspecs",
                "-c",
                "submodule.recurse=false",
                "submodule",
                "update",
                "--init",
                "--checkout",
                "--",
                path,
            ],
        ),
        SubmoduleAction::Reset { .. } => {
            let child = initialized_path(repository, path)?
                .ok_or_else(|| invalid("Submodule is no longer initialized."))?;
            run_git(
                &child,
                &[
                    "-c",
                    "submodule.recurse=false",
                    "checkout",
                    "--detach",
                    "--force",
                    fresh.expected_oid.as_deref().unwrap(),
                    "--",
                ],
            )
        }
        SubmoduleAction::Remove { .. } => {
            let name = list(repository)?
                .into_iter()
                .find(|module| module.path == path)
                .ok_or_else(|| invalid("Submodule is no longer configured."))?
                .name;
            let output = run_git(
                repository,
                &[
                    "--literal-pathspecs",
                    "-c",
                    "submodule.recurse=false",
                    "rm",
                    "--",
                    path,
                ],
            )?;
            // Some Git versions leave the .gitmodules section behind for paths
            // containing glob characters, despite removing the exact gitlink.
            if config(repository, &name, "path")?.is_some() {
                remove_config_section(repository, &["--file", ".gitmodules"], &name)?;
                run_git(
                    repository,
                    &["--literal-pathspecs", "add", "--", ".gitmodules"],
                )?;
            }
            remove_config_section(repository, &["--local"], &name)?;
            Ok(output)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        net::{TcpListener, TcpStream},
        process::{Child, Command, Stdio},
        time::{Duration, Instant},
    };
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    struct Fixture {
        root: PathBuf,
        parent: PathBuf,
        source: PathBuf,
        daemon: Child,
        url: String,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "branchlight-submodules-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            let parent = root.join("parent");
            let source = root.join("source");
            for path in [&parent, &source] {
                fs::create_dir(path).unwrap();
                git(path, &["init", "-b", "main"]);
                git(path, &["config", "user.name", "Submodule Tests"]);
                git(path, &["config", "user.email", "submodule@example.invalid"]);
                fs::write(path.join("file.txt"), "Base content\n").unwrap();
                fs::write(path.join(".gitignore"), "ignored.tmp\n").unwrap();
                git(path, &["add", "."]);
                git(path, &["commit", "-m", "Base"]);
            }
            let port = TcpListener::bind("127.0.0.1:0")
                .unwrap()
                .local_addr()
                .unwrap()
                .port();
            let daemon = Command::new("git")
                .args([
                    "daemon",
                    "--reuseaddr",
                    "--export-all",
                    &format!("--base-path={}", root.display()),
                    "--listen=127.0.0.1",
                    &format!("--port={port}"),
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            let until = Instant::now() + Duration::from_secs(5);
            while TcpStream::connect(("127.0.0.1", port)).is_err() {
                assert!(Instant::now() < until, "Git test daemon did not start");
                std::thread::sleep(Duration::from_millis(20));
            }
            Self {
                root,
                parent,
                source,
                daemon,
                url: format!("git://127.0.0.1:{port}/source"),
            }
        }
        fn add(&self) {
            let action = SubmoduleAction::Add {
                path: "vendor [x]/child space".into(),
                source: self.url.clone(),
            };
            let preview = review(&self.parent, action.clone()).unwrap();
            assert_eq!(
                preview.expected_oid.as_deref(),
                Some(git(&self.source, &["rev-parse", "HEAD"]).as_str())
            );
            execute(&self.parent, action, &preview.token).unwrap();
        }
        fn commit_parent(&self) {
            git(&self.parent, &["commit", "-m", "Add submodule"]);
        }
        fn child(&self) -> PathBuf {
            self.parent.join("vendor [x]/child space")
        }
        fn apply(&self, action: SubmoduleAction) {
            let preview = review(&self.parent, action.clone()).unwrap();
            execute(&self.parent, action, &preview.token).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.daemon.kill();
            let _ = self.daemon.wait();
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn git(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout)
            .trim_end_matches(['\r', '\n'])
            .into()
    }
    fn path() -> String {
        "vendor [x]/child space".into()
    }
    #[test]
    fn adds_inspects_opens_and_edits_without_touching_unrelated_parent_work() {
        let f = Fixture::new();
        fs::write(f.parent.join("staged.txt"), "Keep staged\n").unwrap();
        git(&f.parent, &["add", "staged.txt"]);
        let staged = git(&f.parent, &["show", ":staged.txt"]);
        f.add();
        let modules = list(&f.parent).unwrap();
        assert_eq!(modules.len(), 1);
        let module = &modules[0];
        assert!(module.initialized && !module.dirty);
        assert_eq!(module.expected_oid, module.current_oid);
        assert_eq!(
            Path::new(&open(&f.parent, &path()).unwrap().path)
                .canonicalize()
                .unwrap(),
            f.child().canonicalize().unwrap()
        );
        assert_eq!(git(&f.parent, &["show", ":staged.txt"]), staged);
        f.commit_parent();
        let head = git(&f.child(), &["rev-parse", "HEAD"]);
        f.apply(SubmoduleAction::Edit {
            path: path(),
            url: f.url.clone(),
            branch: Some("main".into()),
        });
        assert_eq!(list(&f.parent).unwrap()[0].branch.as_deref(), Some("main"));
        assert_eq!(git(&f.child(), &["rev-parse", "HEAD"]), head);
        assert!(git(&f.parent, &["status", "--porcelain"]).contains(".gitmodules"));
        assert!(
            review(&f.parent, SubmoduleAction::Remove { path: path() }).is_err(),
            "pending attributes must not be staged as collateral"
        );
        git(&f.parent, &["add", ".gitmodules"]);
        git(&f.parent, &["commit", "-m", "Tracked branch"]);
        f.apply(SubmoduleAction::Edit {
            path: path(),
            url: f.url.clone(),
            branch: None,
        });
        assert!(list(&f.parent).unwrap()[0].branch.is_none());
    }
    #[test]
    fn initializes_clones_updates_expected_revision_and_preserves_local_changes() {
        let f = Fixture::new();
        f.add();
        f.commit_parent();
        let clone = f.root.join("clone");
        git(
            &f.root,
            &[
                "clone",
                "--no-recurse-submodules",
                f.parent.to_str().unwrap(),
                clone.to_str().unwrap(),
            ],
        );
        let uninitialized = list(&clone).unwrap();
        assert!(!uninitialized[0].initialized);
        assert!(uninitialized[0].current_oid.is_none());
        assert!(open(&clone, &path()).is_err());
        let action = SubmoduleAction::Initialize { path: path() };
        let preview = review(&clone, action.clone()).unwrap();
        execute(&clone, action, &preview.token).unwrap();
        assert!(list(&clone).unwrap()[0].initialized);
        fs::write(f.source.join("new.txt"), "New upstream file\n").unwrap();
        git(&f.source, &["add", "new.txt"]);
        git(&f.source, &["commit", "-m", "Next"]);
        let next = git(&f.source, &["rev-parse", "HEAD"]);
        git(&f.child(), &["fetch", "origin"]);
        git(
            &f.parent,
            &[
                "update-index",
                "--cacheinfo",
                &format!("160000,{next},{}", path()),
            ],
        );
        let original_checkout = fs::read_to_string(f.child().join("file.txt")).unwrap();
        fs::write(f.child().join("file.txt"), "Preserve local edit\n").unwrap();
        f.apply(SubmoduleAction::Update { path: path() });
        assert_eq!(git(&f.child(), &["rev-parse", "HEAD"]), next);
        assert_eq!(
            fs::read_to_string(f.child().join("file.txt")).unwrap(),
            "Preserve local edit\n"
        );
        assert!(list(&f.parent).unwrap()[0].dirty);
        fs::write(f.child().join("keep.txt"), "Untracked work\n").unwrap();
        fs::write(f.child().join("ignored.tmp"), "Ignored work\n").unwrap();
        f.apply(SubmoduleAction::Reset { path: path() });
        assert_eq!(
            fs::read_to_string(f.child().join("file.txt")).unwrap(),
            original_checkout
        );
        assert_eq!(
            fs::read_to_string(f.child().join("keep.txt")).unwrap(),
            "Untracked work\n"
        );
        assert_eq!(
            fs::read_to_string(f.child().join("ignored.tmp")).unwrap(),
            "Ignored work\n"
        );
    }
    #[test]
    fn refuses_dirty_or_untracked_removal_and_retains_module_metadata_after_clean_removal() {
        let f = Fixture::new();
        f.add();
        f.commit_parent();
        let metadata = list(&f.parent).unwrap()[0]
            .common_directory
            .clone()
            .unwrap();
        fs::write(f.child().join("ignored.tmp"), "Keep ignored\n").unwrap();
        assert!(review(&f.parent, SubmoduleAction::Remove { path: path() }).is_err());
        fs::remove_file(f.child().join("ignored.tmp")).unwrap();
        fs::write(f.child().join("file.txt"), "Keep edit\n").unwrap();
        assert!(review(&f.parent, SubmoduleAction::Remove { path: path() }).is_err());
        f.apply(SubmoduleAction::Reset { path: path() });
        fs::write(f.parent.join("file.txt"), "Unrelated parent edit\n").unwrap();
        fs::write(f.parent.join("staged.txt"), "Unrelated index\n").unwrap();
        git(&f.parent, &["add", "staged.txt"]);
        f.apply(SubmoduleAction::Remove { path: path() });
        assert!(Path::new(&metadata).is_dir());
        assert!(!f.child().exists());
        assert!(
            list(&f.parent).unwrap().is_empty(),
            "config={} index={}",
            fs::read_to_string(f.parent.join(".gitmodules")).unwrap_or_default(),
            git(&f.parent, &["ls-files", "--stage"])
        );
        assert_eq!(
            fs::read_to_string(f.parent.join("file.txt")).unwrap(),
            "Unrelated parent edit\n"
        );
        assert_eq!(git(&f.parent, &["show", ":staged.txt"]), "Unrelated index");
    }
    #[test]
    fn stale_reviews_and_untracked_reset_collisions_do_not_mutate_work() {
        let f = Fixture::new();
        f.add();
        f.commit_parent();
        let action = SubmoduleAction::Reset { path: path() };
        let preview = review(&f.parent, action.clone()).unwrap();
        git(
            &f.parent,
            &["commit", "--allow-empty", "-m", "Changed HEAD"],
        );
        assert!(execute(&f.parent, action, &preview.token).is_err());
        git(&f.source, &["rm", "file.txt"]);
        git(&f.source, &["commit", "-m", "Delete file"]);
        git(&f.child(), &["fetch", "origin"]);
        git(&f.child(), &["checkout", "--detach", "origin/main"]);
        fs::write(f.child().join("file.txt"), "New untracked work\n").unwrap();
        assert!(review(&f.parent, SubmoduleAction::Reset { path: path() }).is_err());
        assert_eq!(
            fs::read_to_string(f.child().join("file.txt")).unwrap(),
            "New untracked work\n"
        );
        assert!(review(
            &f.parent,
            SubmoduleAction::Add {
                path: "../escape".into(),
                source: f.url.clone()
            }
        )
        .is_err());
        assert!(review(
            &f.parent,
            SubmoduleAction::Add {
                path: ".git/injected".into(),
                source: f.url.clone()
            }
        )
        .is_err());
    }
    #[test]
    fn reset_keeps_nested_repository_work_and_nonempty_uninitialized_removal_is_refused() {
        let f = Fixture::new();
        f.add();
        f.commit_parent();
        git(&f.child(), &["config", "user.name", "Submodule Tests"]);
        git(
            &f.child(),
            &["config", "user.email", "submodule@example.invalid"],
        );
        git(
            &f.child(),
            &["submodule", "add", "--", &f.url, "nested module"],
        );
        git(&f.child(), &["commit", "-m", "Nested repository"]);
        let nested = f.child().join("nested module");
        fs::write(nested.join("file.txt"), "Nested uncommitted work\n").unwrap();
        f.apply(SubmoduleAction::Reset { path: path() });
        assert_eq!(
            fs::read_to_string(nested.join("file.txt")).unwrap(),
            "Nested uncommitted work\n"
        );
        assert!(nested.join(".git").exists());
        assert!(review(&f.parent, SubmoduleAction::Remove { path: path() }).is_err());
        // A separate clean clone has no initialized child, but must still
        // protect files a user placed in that uninitialized path.
        let clone = f.root.join("uninitialized");
        git(
            &f.root,
            &[
                "clone",
                "--no-recurse-submodules",
                f.parent.to_str().unwrap(),
                clone.to_str().unwrap(),
            ],
        );
        let child = clone.join(path());
        fs::create_dir_all(&child).unwrap();
        fs::write(child.join("saved.txt"), "Unrelated work").unwrap();
        assert!(review(&clone, SubmoduleAction::Remove { path: path() }).is_err());
        assert_eq!(
            fs::read_to_string(child.join("saved.txt")).unwrap(),
            "Unrelated work"
        );
    }
    #[test]
    fn local_submodule_sources_are_refused_before_add_or_configuration_changes() {
        let f = Fixture::new();
        for source in [
            f.source.to_string_lossy().into_owned(),
            "file:///tmp/source".into(),
            "C:\\source".into(),
            "\\\\server\\source".into(),
        ] {
            assert!(validate_source(&source).is_err());
            assert!(review(
                &f.parent,
                SubmoduleAction::Add {
                    path: "local-child".into(),
                    source
                }
            )
            .is_err());
            assert!(!f.parent.join("local-child").exists());
        }
        f.add();
        f.commit_parent();
        let original = fs::read(f.parent.join(".gitmodules")).unwrap();
        assert!(review(
            &f.parent,
            SubmoduleAction::Edit {
                path: path(),
                url: f.source.to_string_lossy().into_owned(),
                branch: None
            }
        )
        .is_err());
        assert_eq!(fs::read(f.parent.join(".gitmodules")).unwrap(), original);
    }

    #[test]
    fn reset_collision_index_detects_equal_ancestor_and_descendant_paths() {
        let f = Fixture::new();
        fs::create_dir(f.source.join("nested")).unwrap();
        fs::write(f.source.join("nested/child"), "Tracked nested content").unwrap();
        git(&f.source, &["add", "."]);
        git(&f.source, &["commit", "-m", "Nested tracked tree"]);
        let target = git(&f.source, &["rev-parse", "HEAD"]);
        git(&f.source, &["rm", "--cached", "-r", "."]);
        git(&f.source, &["add", ".gitignore"]);
        assert!(reset_collisions(&f.source, &target).is_err());
        fs::remove_file(f.source.join("file.txt")).unwrap();
        fs::remove_dir_all(f.source.join("nested")).unwrap();
        fs::write(f.source.join("nested"), "Untracked ancestor").unwrap();
        assert!(reset_collisions(&f.source, &target).is_err());
        fs::remove_file(f.source.join("nested")).unwrap();
        fs::create_dir(f.source.join("file.txt")).unwrap();
        fs::write(f.source.join("file.txt/untracked"), "Untracked descendant").unwrap();
        assert!(reset_collisions(&f.source, &target).is_err());
        fs::remove_dir_all(f.source.join("file.txt")).unwrap();
        fs::write(f.source.join("unrelated"), "Preserve unrelated work").unwrap();
        reset_collisions(&f.source, &target).unwrap();
    }

    #[test]
    fn missing_sources_and_destinations_in_other_repositories_do_not_create_files() {
        let f = Fixture::new();
        assert!(review(
            &f.parent,
            SubmoduleAction::Add {
                path: "missing child".into(),
                source: f
                    .root
                    .join("missing-source.git")
                    .to_string_lossy()
                    .into_owned()
            }
        )
        .is_err());
        assert!(!f.parent.join("missing child").exists());
        let other = f.parent.join("unrelated repository");
        fs::create_dir(&other).unwrap();
        git(&other, &["init"]);
        assert!(review(
            &f.parent,
            SubmoduleAction::Add {
                path: "unrelated repository/child".into(),
                source: f.url.clone()
            }
        )
        .is_err());
        assert!(!other.join("child").exists());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&f.source, f.parent.join("alias")).unwrap();
            assert!(review(
                &f.parent,
                SubmoduleAction::Add {
                    path: "alias/child".into(),
                    source: f.url.clone()
                }
            )
            .is_err());
        }
    }
}
