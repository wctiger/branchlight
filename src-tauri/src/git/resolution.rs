use super::{
    conflicts::get_repository_operation,
    inspection::{invalid, validate_path},
    runner::run_git,
};
use crate::models::GitError;
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const LIMIT: usize = 512 * 1024;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConflictFile {
    pub file_path: String,
    pub operation: String,
    pub base: String,
    pub current: String,
    pub incoming: String,
    pub output: String,
    pub token: String,
}
fn regular_path(repository: &Path, file: &str) -> Result<PathBuf, GitError> {
    validate_path(file)?;
    let root = repository
        .canonicalize()
        .map_err(|e| invalid(&e.to_string()))?;
    let mut path = root.clone();
    for component in Path::new(file).components() {
        path.push(component);
        let metadata = fs::symlink_metadata(&path).map_err(|e| {
            invalid(&format!(
                "Cannot open conflict path: {e}. Deleted-file conflicts require external Git."
            ))
        })?;
        if metadata.file_type().is_symlink() {
            return Err(invalid("Symlink conflicts require an external Git tool."));
        }
    }
    if !path.is_file()
        || !path
            .canonicalize()
            .map_err(|e| invalid(&e.to_string()))?
            .starts_with(root)
    {
        return Err(invalid(
            "Choose an ordinary conflicted file inside this worktree.",
        ));
    }
    Ok(path)
}
fn text(bytes: Vec<u8>) -> Result<String, GitError> {
    if bytes.len() > LIMIT || bytes.contains(&0) {
        return Err(invalid(
            "Binary or over-512-KiB conflict files require an external Git tool.",
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| invalid("Non-UTF-8 conflicts require an external Git tool."))
}
fn working_text(path: &Path) -> Result<String, GitError> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|f| f.take((LIMIT + 1) as u64).read_to_end(&mut bytes))
        .map_err(|e| invalid(&e.to_string()))?;
    text(bytes)
}
/// Read the three index stages by object ID; never interpret a filename as a revision.
pub(crate) fn inspect(repository: &Path, file: &str) -> Result<ConflictFile, GitError> {
    let path = regular_path(repository, file)?;
    let index = run_git(
        repository,
        &[
            "ls-files",
            "--unmerged",
            "-z",
            "--",
            &format!(":(literal){file}"),
        ],
    )?;
    let mut stages: [Option<String>; 3] = [None, None, None];
    for record in index
        .stdout_bytes
        .split(|b| *b == 0)
        .filter(|r| !r.is_empty())
    {
        let tab = record
            .iter()
            .position(|b| *b == b'\t')
            .ok_or_else(|| invalid("Malformed conflict index entry."))?;
        if &record[tab + 1..] != file.as_bytes() {
            return Err(invalid("Conflict path changed. Refresh status."));
        }
        let header =
            std::str::from_utf8(&record[..tab]).map_err(|_| invalid("Invalid index metadata."))?;
        let fields: Vec<_> = header.split_whitespace().collect();
        if fields.len() != 3 || !matches!(fields[0], "100644" | "100755") {
            return Err(invalid(
                "Only ordinary text conflicts are supported; use external Git for this file.",
            ));
        }
        let stage = fields[2]
            .parse::<usize>()
            .map_err(|_| invalid("Invalid index stage."))?;
        if !(1..=3).contains(&stage) || stages[stage - 1].is_some() {
            return Err(invalid("Unexpected conflict index stages."));
        }
        stages[stage - 1] = Some(fields[1].into());
    }
    if stages.iter().any(Option::is_none) {
        return Err(invalid("This file lacks base/current/incoming stages. Deleted-file and add/add conflicts require external Git."));
    }
    let read = |oid: &str| -> Result<String, GitError> {
        let size = run_git(repository, &["cat-file", "-s", oid])?
            .stdout
            .trim()
            .parse::<usize>()
            .map_err(|_| invalid("Invalid blob size."))?;
        if size > LIMIT {
            return Err(invalid("Over-512-KiB conflict sides require external Git."));
        }
        text(run_git(repository, &["cat-file", "blob", oid])?.stdout_bytes)
    };
    let output = working_text(&path)?;
    let operation = match get_repository_operation(repository)? {
        crate::models::RepositoryOperation::Rebase => "rebase",
        crate::models::RepositoryOperation::Merge => "merge",
        crate::models::RepositoryOperation::CherryPick => "cherryPick",
        crate::models::RepositoryOperation::Revert => "revert",
        crate::models::RepositoryOperation::None => "none",
    }
    .to_owned();
    let mut digest = std::collections::hash_map::DefaultHasher::new();
    index.stdout_bytes.hash(&mut digest);
    output.hash(&mut digest);
    operation.hash(&mut digest);
    run_git(repository, &["rev-parse", "--verify", "HEAD"])?
        .stdout
        .hash(&mut digest);
    Ok(ConflictFile {
        file_path: file.into(),
        operation,
        base: read(stages[0].as_ref().unwrap())?,
        current: read(stages[1].as_ref().unwrap())?,
        incoming: read(stages[2].as_ref().unwrap())?,
        output,
        token: format!("{:016x}", digest.finish()),
    })
}
/// Reject stale snapshots and unsafe paths before atomically replacing a text file.
pub(crate) fn save(
    repository: &Path,
    file: &str,
    token: &str,
    output: &str,
    mark_resolved: bool,
) -> Result<(), GitError> {
    if output.len() > LIMIT || output.contains('\0') {
        return Err(invalid(
            "Resolution must be UTF-8 text up to 512 KiB without NUL bytes.",
        ));
    }
    let snapshot = inspect(repository, file)?;
    if snapshot.token != token {
        return Err(invalid("The conflict or working file changed externally. Reload it before saving; your draft has been preserved."));
    }
    if mark_resolved
        && output.lines().any(|line| {
            line.starts_with("<<<<<<< ")
                || line.starts_with("=======")
                || line.starts_with(">>>>>>> ")
                || line.starts_with("||||||| ")
        })
    {
        return Err(invalid("Remove conflict markers before marking this file resolved. You can still save the draft."));
    }
    let path = regular_path(repository, file)?;
    let temp = path.with_file_name(format!(
        ".branchlight-resolution-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let result = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| invalid(&e.to_string()))?;
        f.write_all(output.as_bytes())
            .map_err(|e| invalid(&e.to_string()))?;
        f.set_permissions(
            fs::metadata(&path)
                .map_err(|e| invalid(&e.to_string()))?
                .permissions(),
        )
        .map_err(|e| invalid(&e.to_string()))?;
        f.sync_all().map_err(|e| invalid(&e.to_string()))?;
        drop(f);
        if inspect(repository, file)?.token != token {
            return Err(invalid(
                "File changed while preparing the save. Reload before retrying.",
            ));
        }
        fs::rename(&temp, &path)
            .map_err(|e| invalid(&format!("Unable to replace conflict file: {e}")))?;
        if mark_resolved {
            if working_text(&path)? != output {
                return Err(invalid(
                    "The saved file changed externally. Refresh before marking resolved.",
                ));
            }
            run_git(repository, &["add", "--", &format!(":(literal){file}")])?;
        }
        Ok(())
    })();
    let _ = fs::remove_file(temp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Output};
    struct Fixture(PathBuf);
    static NEXT_FIXTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "branchlight-resolution-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            let fixture = Self(path);
            fixture.git(&["init", "-b", "main"]);
            fixture.git(&["config", "user.name", "Resolution Tests"]);
            fixture.git(&["config", "user.email", "resolution@example.invalid"]);
            fixture.commit("base\n", "Base");
            fixture.git(&["switch", "-c", "incoming"]);
            fixture.commit("incoming\n", "Incoming");
            fixture.git(&["switch", "main"]);
            fixture.commit("current\n", "Current");
            assert!(!fixture.output(&["merge", "incoming"]).status.success());
            fixture
        }
        fn output(&self, args: &[&str]) -> Output {
            Command::new("git")
                .current_dir(&self.0)
                .args(args)
                .output()
                .unwrap()
        }
        fn git(&self, args: &[&str]) -> String {
            let result = self.output(args);
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            String::from_utf8_lossy(&result.stdout).trim().into()
        }
        fn commit(&self, contents: &str, message: &str) {
            fs::write(self.0.join("--conflict [x].txt"), contents).unwrap();
            self.git(&["add", "--", "--conflict [x].txt"]);
            self.git(&["commit", "-m", message]);
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    const FILE: &str = "--conflict [x].txt";
    #[test]
    fn exposes_exact_index_stages_and_draft_save_keeps_conflicts_until_explicit_stage() {
        let f = Fixture::new();
        let snapshot = inspect(&f.0, FILE).unwrap();
        assert_eq!(
            (
                snapshot.base.as_str(),
                snapshot.current.as_str(),
                snapshot.incoming.as_str()
            ),
            ("base\n", "current\n", "incoming\n")
        );
        assert_eq!(snapshot.operation, "merge");
        save(&f.0, FILE, &snapshot.token, "chosen output\n", false).unwrap();
        assert!(!f.git(&["ls-files", "--unmerged"]).is_empty());
        let updated = inspect(&f.0, FILE).unwrap();
        assert_eq!(updated.output, "chosen output\n");
        save(&f.0, FILE, &updated.token, "final output\n", true).unwrap();
        assert!(f.git(&["ls-files", "--unmerged"]).is_empty());
        assert_eq!(f.git(&["show", &format!(":{FILE}")]), "final output");
        assert_eq!(
            get_repository_operation(&f.0).unwrap(),
            crate::models::RepositoryOperation::Merge
        );
    }
    #[test]
    fn rejects_stale_working_files_and_unresolved_markers_without_overwriting() {
        let f = Fixture::new();
        let snapshot = inspect(&f.0, FILE).unwrap();
        fs::write(f.0.join(FILE), "external edit\n").unwrap();
        assert!(save(&f.0, FILE, &snapshot.token, "overwrite\n", true).is_err());
        assert_eq!(
            fs::read_to_string(f.0.join(FILE)).unwrap(),
            "external edit\n"
        );
        let snapshot = inspect(&f.0, FILE).unwrap();
        assert!(save(
            &f.0,
            FILE,
            &snapshot.token,
            "<<<<<<< HEAD\nnot resolved\n=======\nother\n>>>>>>> incoming\n",
            true
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(f.0.join(FILE)).unwrap(),
            "external edit\n"
        );
        assert!(inspect(&f.0, "../outside").is_err());
    }
    #[test]
    fn refuses_unsupported_binary_deleted_and_oversized_working_files() {
        let f = Fixture::new();
        fs::write(f.0.join(FILE), [b'a', 0, b'b']).unwrap();
        assert!(inspect(&f.0, FILE).is_err());
        fs::write(f.0.join(FILE), vec![b'a'; LIMIT + 1]).unwrap();
        assert!(inspect(&f.0, FILE).is_err());
        fs::remove_file(f.0.join(FILE)).unwrap();
        assert!(inspect(&f.0, FILE).is_err());
        assert!(!f.git(&["ls-files", "--unmerged"]).is_empty());
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_without_writing_their_target() {
        let f = Fixture::new();
        let snapshot = inspect(&f.0, FILE).unwrap();
        fs::write(f.0.join("outside"), "untouched").unwrap();
        fs::remove_file(f.0.join(FILE)).unwrap();
        std::os::unix::fs::symlink(f.0.join("outside"), f.0.join(FILE)).unwrap();
        assert!(save(&f.0, FILE, &snapshot.token, "bad", true).is_err());
        assert_eq!(
            fs::read_to_string(f.0.join("outside")).unwrap(),
            "untouched"
        );
    }
}
