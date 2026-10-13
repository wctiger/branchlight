use super::runner::{decode_git_bytes, run_git};
use crate::models::GitError;
use serde::Serialize;
use std::path::{Component, Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangedPath {
    pub path: String,
    pub original_path: Option<String>,
    pub status: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Comparison {
    pub base: String,
    pub target: String,
    pub files: Vec<ChangedPath>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextDiff {
    pub context: String,
    pub text: String,
    pub truncated: bool,
    pub binary: bool,
}

pub(super) fn invalid(message: &str) -> GitError {
    GitError::InvalidOperationInput {
        message: message.to_owned(),
    }
}
pub(super) fn validate_path(path: &str) -> Result<(), GitError> {
    if path.is_empty()
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || path.contains('\0')
    {
        return Err(invalid(
            "Choose a repository-relative file path without traversal.",
        ));
    }
    Ok(())
}
fn resolve(repository: &Path, revision: &str) -> Result<String, GitError> {
    if revision.is_empty() || revision.contains('\0') {
        return Err(invalid("Choose a revision."));
    }
    Ok(run_git(
        repository,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{revision}^{{commit}}"),
        ],
    )?
    .stdout
    .trim()
    .to_owned())
}
fn empty_tree(repository: &Path) -> Result<String, GitError> {
    Ok(
        run_git(repository, &["hash-object", "-t", "tree", "--stdin"])?
            .stdout
            .trim()
            .to_owned(),
    )
}
fn pair(repository: &Path, base: &str, target: &str) -> Result<(String, String), GitError> {
    let target = resolve(repository, target)?;
    let base = if base == "@parent" {
        let parents = run_git(repository, &["rev-list", "--parents", "-n", "1", &target])?;
        match parents.stdout.split_whitespace().nth(1) {
            Some(parent) => parent.to_owned(),
            None => empty_tree(repository)?,
        }
    } else if base == empty_tree(repository)? {
        base.to_owned()
    } else {
        resolve(repository, base)?
    };
    Ok((base, target))
}
pub(crate) fn compare(repository: &Path, base: &str, target: &str) -> Result<Comparison, GitError> {
    let (base, target) = pair(repository, base, target)?;
    let output = run_git(
        repository,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--name-status",
            "-z",
            "-M",
            &base,
            &target,
            "--",
        ],
    )?;
    let mut fields = output
        .stdout_bytes
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty());
    let mut files = Vec::new();
    while let Some(status) = fields.next() {
        let first = fields
            .next()
            .ok_or_else(|| invalid("Malformed changed path response."))?;
        let renamed = matches!(status.first(), Some(b'R' | b'C'));
        let path = if renamed {
            fields
                .next()
                .ok_or_else(|| invalid("Malformed rename response."))?
        } else {
            first
        };
        files.push(ChangedPath {
            path: decode_git_bytes(path),
            original_path: renamed.then(|| decode_git_bytes(first)),
            status: decode_git_bytes(status),
        });
    }
    Ok(Comparison {
        base,
        target,
        files,
    })
}
pub(crate) fn diff(
    repository: &Path,
    kind: &str,
    path: &str,
    base: &str,
    target: &str,
) -> Result<TextDiff, GitError> {
    validate_path(path)?;
    let literal = format!(":(literal){path}");
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "--no-color", "-M"];
    let resolved;
    let context = match kind {
        "staged" => {
            args.push("--cached");
            "HEAD → index (empty tree before first commit)".to_owned()
        }
        "unstaged" => "Index → working tree".to_owned(),
        "revisions" => {
            resolved = pair(repository, base, target)?;
            args.extend([resolved.0.as_str(), resolved.1.as_str()]);
            format!("{} → {}", resolved.0, resolved.1)
        }
        _ => return Err(invalid("Choose staged, unstaged, or revision changes.")),
    };
    let original = if kind == "revisions" {
        compare(repository, base, target)?
            .files
            .into_iter()
            .find(|file| file.path == path)
            .and_then(|file| file.original_path)
    } else {
        let status = super::get_repository_status(repository)?;
        let files = if kind == "staged" {
            status.staged
        } else {
            status.unstaged
        };
        files
            .into_iter()
            .find(|file| file.path == path)
            .and_then(|file| file.original_path)
    };
    let original_literal = original.map(|path| format!(":(literal){path}"));
    args.extend(["--", &literal]);
    if let Some(original) = &original_literal {
        args.push(original);
    }
    let output = run_git(repository, &args)?;
    let binary =
        output.stdout.contains("Binary files ") || output.stdout.contains("GIT binary patch");
    let limit = 512 * 1024;
    let truncated = output.stdout.len() > limit;
    let mut end = output.stdout.len().min(limit);
    while !output.stdout.is_char_boundary(end) {
        end -= 1;
    }
    Ok(TextDiff {
        context,
        text: output.stdout[..end].to_owned(),
        truncated,
        binary,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileCommit {
    pub hash: String,
    pub author: String,
    pub timestamp: String,
    pub subject: String,
}
pub(crate) fn file_history(
    repository: &Path,
    path: &str,
    revision: &str,
) -> Result<Vec<FileCommit>, GitError> {
    validate_path(path)?;
    let revision = resolve(repository, revision)?;
    let literal = format!(":(literal){path}");
    let output = run_git(
        repository,
        &[
            "log",
            "-n",
            "100",
            "--format=%H%x00%an%x00%at%x00%s%x00",
            &revision,
            "--",
            &literal,
        ],
    )?;
    let mut commits = Vec::new();
    for line in output.stdout.lines() {
        let fields: Vec<_> = line.split('\0').collect();
        if fields.len() != 5 {
            return Err(invalid("Malformed file history response."));
        }
        commits.push(FileCommit {
            hash: fields[0].to_owned(),
            author: fields[1].to_owned(),
            timestamp: fields[2].to_owned(),
            subject: fields[3].to_owned(),
        });
    }
    Ok(commits)
}
pub(crate) fn blame(repository: &Path, path: &str, revision: &str) -> Result<TextDiff, GitError> {
    validate_path(path)?;
    let revision = resolve(repository, revision)?;
    let output = run_git(
        repository,
        &["blame", "--line-porcelain", &revision, "--", path],
    )?;
    let limit = 512 * 1024;
    let truncated = output.stdout.len() > limit;
    let mut end = output.stdout.len().min(limit);
    while !output.stdout.is_char_boundary(end) {
        end -= 1;
    }
    Ok(TextDiff {
        context: format!("{path} at {revision}; committed contents only"),
        text: output.stdout[..end].to_owned(),
        truncated,
        binary: false,
    })
}

/// Whole-file discard is intentionally unavailable for adds, renames, conflicts and directories.
/// Tracked files reset both index and worktree to HEAD; untracked files are removed individually.
pub(crate) fn discard(
    repository: &Path,
    path: &str,
    expected: &str,
) -> Result<crate::models::GitOutput, GitError> {
    use crate::models::{FileStatus, RepositoryOperation};
    validate_path(path)?;
    let status = super::get_repository_status(repository)?;
    if status.operation != RepositoryOperation::None || !status.conflicts.is_empty() {
        return Err(invalid(
            "Resolve or abort the active operation before discarding changes.",
        ));
    }
    let changes: Vec<_> = status
        .staged
        .iter()
        .chain(&status.unstaged)
        .filter(|change| change.path == path)
        .collect();
    if changes.is_empty() {
        return Err(invalid(
            "This file's status changed. Refresh and review it again.",
        ));
    }
    if expected == "untracked"
        && changes
            .iter()
            .all(|change| change.status == FileStatus::Untracked)
    {
        // No symlink traversal: canonicalize the parent, then unlink only the named leaf.
        let root =
            std::fs::canonicalize(repository).map_err(|error| invalid(&error.to_string()))?;
        let file = root.join(path);
        let parent =
            std::fs::canonicalize(file.parent().ok_or_else(|| invalid("Missing parent."))?)
                .map_err(|error| invalid(&error.to_string()))?;
        if !parent.starts_with(&root) {
            return Err(invalid(
                "The file's parent resolves outside this repository.",
            ));
        }
        let metadata =
            std::fs::symlink_metadata(&file).map_err(|error| invalid(&error.to_string()))?;
        if metadata.is_dir() {
            return Err(invalid(
                "Directory discard is unavailable. Select individual untracked files.",
            ));
        }
        std::fs::remove_file(file).map_err(|error| invalid(&error.to_string()))?;
        return Ok(crate::models::GitOutput {
            stdout: "Removed selected untracked file.".to_owned(),
            stderr: String::new(),
            exit_code: Some(0),
            stdout_bytes: Vec::new(),
        });
    }
    if expected != "tracked"
        || changes.iter().any(|change| {
            !matches!(
                change.status,
                FileStatus::Modified | FileStatus::Deleted | FileStatus::TypeChanged
            )
        })
    {
        return Err(invalid("Discard is unavailable for additions, copies, renames, conflicts and directory entries. Review their staged state manually."));
    }
    let literal = format!(":(literal){path}");
    run_git(
        repository,
        &[
            "restore",
            "--source=HEAD",
            "--staged",
            "--worktree",
            "--",
            &literal,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct Repository(PathBuf);
    impl Repository {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "branchlight-inspection-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            super::super::create_repository(&path, None).unwrap();
            let repo = Self(path);
            repo.git(&["config", "user.name", "Inspection Example"]);
            repo.git(&["config", "user.email", "inspection@example.invalid"]);
            repo.git(&["config", "core.autocrlf", "false"]);
            repo
        }
        fn git(&self, args: &[&str]) -> String {
            run_git(&self.0, args).unwrap().stdout.trim().to_owned()
        }
        fn write(&self, path: &str, text: &str) {
            fs::write(self.0.join(path), text).unwrap();
        }
        fn commit(&self, message: &str) -> String {
            self.git(&["add", "-A"]);
            self.git(&["commit", "-m", message]);
            self.git(&["rev-parse", "HEAD"])
        }
    }
    impl Drop for Repository {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn root_commit_comparison_diff_history_and_blame_use_explicit_context() {
        let repo = Repository::new();
        repo.write("file with spaces.txt", "first\nsecond\n");
        let first = repo.commit("Initial file");
        let comparison = compare(&repo.0, "@parent", &first).unwrap();
        assert_eq!(comparison.target, first);
        assert_eq!(comparison.files[0].status, "A");
        let preview = diff(
            &repo.0,
            "revisions",
            "file with spaces.txt",
            &comparison.base,
            &comparison.target,
        )
        .unwrap();
        assert!(preview.text.contains("+first"));
        let history = file_history(&repo.0, "file with spaces.txt", "HEAD").unwrap();
        assert_eq!(history[0].subject, "Initial file");
        assert_eq!(history[0].author, "Inspection Example");
        let attribution = blame(&repo.0, "file with spaces.txt", "HEAD").unwrap();
        assert!(attribution.text.contains("author Inspection Example"));
        assert!(attribution.text.contains("\tsecond"));
        assert!(compare(&repo.0, "HEAD", "HEAD").unwrap().files.is_empty());
        assert!(compare(&repo.0, "missing-ref", "HEAD").is_err());
        assert!(file_history(&repo.0, "unavailable.txt", "HEAD")
            .unwrap()
            .is_empty());
        assert!(blame(&repo.0, "unavailable.txt", "HEAD").is_err());
    }

    #[test]
    fn rename_reverse_deletion_and_first_parent_comparisons_are_coherent() {
        let repo = Repository::new();
        repo.write("old.txt", "unchanged content\n");
        let initial = repo.commit("Initial");
        repo.git(&["mv", "old.txt", "new.txt"]);
        let renamed = repo.commit("Rename");
        let changes = compare(&repo.0, &initial, &renamed).unwrap();
        assert_eq!(changes.files[0].original_path.as_deref(), Some("old.txt"));
        assert_eq!(changes.files[0].path, "new.txt");
        let preview = diff(&repo.0, "revisions", "new.txt", &initial, &renamed).unwrap();
        assert!(preview.text.contains("rename from old.txt"));
        assert_eq!(
            compare(&repo.0, &renamed, &initial).unwrap().files[0].path,
            "old.txt"
        );
        repo.git(&["rm", "new.txt"]);
        let deleted = repo.commit("Delete");
        assert_eq!(
            compare(&repo.0, &renamed, &deleted).unwrap().files[0].status,
            "D"
        );
        assert!(diff(&repo.0, "revisions", "new.txt", &renamed, &deleted)
            .unwrap()
            .text
            .contains("-unchanged content"));
        repo.git(&["checkout", "-b", "side", &initial]);
        repo.write("side.txt", "side\n");
        let side = repo.commit("Side");
        repo.git(&["checkout", "-b", "merge-target", &deleted]);
        repo.git(&["merge", "--no-ff", "side", "-m", "Merge side"]);
        let merged = compare(&repo.0, "@parent", "HEAD").unwrap();
        assert_eq!(merged.base, deleted);
        assert_ne!(merged.base, side);
        assert_eq!(merged.files[0].path, "side.txt");
    }

    #[test]
    fn literal_paths_and_discard_preserve_unselected_files() {
        let repo = Repository::new();
        for path in ["[selected].txt", "other.txt", "--option"] {
            repo.write(path, "base\n");
        }
        repo.commit("Initial");
        for path in ["[selected].txt", "other.txt", "--option"] {
            repo.write(path, "staged\n");
        }
        super::super::stage_file(&repo.0, "[selected].txt").unwrap();
        assert_eq!(
            repo.git(&["diff", "--cached", "--name-only"]),
            "[selected].txt"
        );
        repo.write("[selected].txt", "unstaged\n");
        assert!(diff(&repo.0, "staged", "[selected].txt", "", "")
            .unwrap()
            .text
            .contains("+staged"));
        assert!(diff(&repo.0, "unstaged", "[selected].txt", "", "")
            .unwrap()
            .text
            .contains("+unstaged"));
        discard(&repo.0, "[selected].txt", "tracked").unwrap();
        assert_eq!(
            fs::read_to_string(repo.0.join("[selected].txt")).unwrap(),
            "base\n"
        );
        assert_eq!(
            fs::read_to_string(repo.0.join("other.txt")).unwrap(),
            "staged\n"
        );
        assert!(repo.git(&["diff", "--cached", "--name-only"]).is_empty());
        fs::remove_file(repo.0.join("--option")).unwrap();
        discard(&repo.0, "--option", "tracked").unwrap();
        assert!(repo.0.join("--option").exists());
        repo.write("untracked.txt", "remove only me\n");
        discard(&repo.0, "untracked.txt", "untracked").unwrap();
        assert!(!repo.0.join("untracked.txt").exists());
        repo.write("added.txt", "keep me\n");
        super::super::stage_file(&repo.0, "added.txt").unwrap();
        assert!(discard(&repo.0, "added.txt", "tracked").is_err());
        assert!(repo.0.join("added.txt").exists());
        assert!(discard(&repo.0, "../outside", "untracked").is_err());
        assert!(discard(&repo.0, "other.txt", "untracked").is_err());
    }

    #[test]
    fn binary_and_large_previews_have_explicit_bounds() {
        let repo = Repository::new();
        fs::write(repo.0.join("binary.dat"), [0, 1, 2, 0]).unwrap();
        repo.write("large.txt", &"line of text\n".repeat(55_000));
        repo.git(&["add", "-A"]);
        assert!(
            diff(&repo.0, "staged", "binary.dat", "", "")
                .unwrap()
                .binary
        );
        let preview = diff(&repo.0, "staged", "large.txt", "", "").unwrap();
        assert!(preview.truncated);
        assert!(preview.text.len() <= 512 * 1024);
    }

    #[test]
    fn oversized_git_output_returns_an_actionable_error() {
        let repo = Repository::new();
        repo.write("oversized.txt", &"long line of text\n".repeat(550_000));
        repo.git(&["add", "-A"]);
        let error = diff(&repo.0, "staged", "oversized.txt", "", "")
            .err()
            .unwrap();
        assert!(
            matches!(error, GitError::InvalidOperationInput { message } if message.contains("8 MiB"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn untracked_symlink_discard_unlinks_only_the_selected_leaf() {
        use std::os::unix::fs::symlink;
        let repo = Repository::new();
        let outside = Repository::new();
        outside.write("keep.txt", "outside contents\n");
        symlink(outside.0.join("keep.txt"), repo.0.join("leaf-link")).unwrap();
        discard(&repo.0, "leaf-link", "untracked").unwrap();
        assert!(!repo.0.join("leaf-link").exists());
        assert_eq!(
            fs::read_to_string(outside.0.join("keep.txt")).unwrap(),
            "outside contents\n"
        );
        symlink(&outside.0, repo.0.join("parent-link")).unwrap();
        assert!(discard(&repo.0, "parent-link/keep.txt", "untracked").is_err());
        assert!(outside.0.join("keep.txt").exists());
        fs::create_dir(repo.0.join("directory")).unwrap();
        repo.write("directory/file.txt", "keep directory\n");
        assert!(discard(&repo.0, "directory/", "untracked").is_err());
        assert!(repo.0.join("directory/file.txt").exists());
    }

    #[test]
    fn creation_reserves_destinations_and_retains_failed_clones() {
        let repo = Repository::new();
        repo.write("keep.txt", "source\n");
        repo.commit("Source");
        assert!(super::super::create_repository(&repo.0, None).is_err());
        assert_eq!(
            fs::read_to_string(repo.0.join("keep.txt")).unwrap(),
            "source\n"
        );
        let destination = repo.0.join("clone");
        super::super::create_repository(&destination, Some(repo.0.to_str().unwrap())).unwrap();
        // Clone honors the destination's Git configuration, including Windows
        // core.autocrlf. Source repository config is not inherited by a clone.
        assert_eq!(
            fs::read_to_string(destination.join("keep.txt"))
                .unwrap()
                .lines()
                .collect::<Vec<_>>(),
            ["source"]
        );
        let failed = repo.0.join("failed-clone");
        assert!(super::super::create_repository(
            &failed,
            Some(repo.0.join("missing").to_str().unwrap())
        )
        .is_err());
        assert!(failed.is_dir());
    }
}
