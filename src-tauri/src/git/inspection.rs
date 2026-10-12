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
    let context;
    let resolved;
    match kind {
        "staged" => {
            args.push("--cached");
            context = "HEAD → index (empty tree before first commit)".to_owned();
        }
        "unstaged" => {
            context = "Index → working tree".to_owned();
        }
        "revisions" => {
            resolved = pair(repository, base, target)?;
            args.extend([resolved.0.as_str(), resolved.1.as_str()]);
            context = format!("{} → {}", resolved.0, resolved.1);
        }
        _ => return Err(invalid("Choose staged, unstaged, or revision changes.")),
    }
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
