use std::path::Path;

use crate::models::{BranchStatus, FileChange, FileStatus, GitError, RepositoryStatus};

use super::runner::{decode_git_bytes, run_git};

/// Reads and parses the complete working-tree status reported by system Git.
pub(crate) fn get_repository_status(repository: &Path) -> Result<RepositoryStatus, GitError> {
    let output = run_git(
        repository,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--show-stash",
            "--untracked-files=normal",
            "-z",
        ],
    )?;
    let parsed = parse_porcelain_v2(&output.stdout_bytes);

    match parsed {
        Ok(status) => Ok(status),
        Err(message) => Err(GitError::InvalidStatusResponse { message, output }),
    }
}

/// Converts NUL-delimited porcelain-v2 output into Branchlight's domain model.
fn parse_porcelain_v2(output: &[u8]) -> Result<RepositoryStatus, String> {
    let mut branch_name = None;
    let mut oid = None;
    let mut is_detached = false;
    let mut upstream = None;
    let mut ahead = None;
    let mut behind = None;
    let mut stash_count = 0;
    let mut saw_branch_head = false;
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut conflicts = Vec::new();
    let mut records = output
        .split(|byte| *byte == b'\0')
        .filter(|record| !record.is_empty());

    while let Some(record) = records.next() {
        if let Some(value) = record.strip_prefix(b"# branch.oid ") {
            oid = (value != b"(initial)").then(|| decode_git_bytes(value));
        } else if let Some(value) = record.strip_prefix(b"# branch.head ") {
            saw_branch_head = true;
            is_detached = value == b"(detached)";
            branch_name = (!is_detached).then(|| decode_git_bytes(value));
        } else if let Some(value) = record.strip_prefix(b"# branch.upstream ") {
            upstream = Some(decode_git_bytes(value));
        } else if let Some(value) = record.strip_prefix(b"# branch.ab ") {
            let (parsed_ahead, parsed_behind) =
                parse_ahead_behind(parse_text_field(value, "ahead/behind header")?)?;
            ahead = Some(parsed_ahead);
            behind = Some(parsed_behind);
        } else if let Some(value) = record.strip_prefix(b"# stash ") {
            stash_count = parse_text_field(value, "stash header")?
                .parse::<u32>()
                .map_err(|_| {
                    format!(
                        "Invalid stash count in Git status header: {}",
                        decode_git_bytes(value)
                    )
                })?;
        } else if record.starts_with(b"# ") || record.starts_with(b"! ") {
            continue;
        } else if let Some(payload) = record.strip_prefix(b"1 ") {
            let fields = split_fields(payload, 8, "ordinary change")?;
            push_tracked_change(fields[0], fields[7], None, &mut staged, &mut unstaged)?;
        } else if let Some(payload) = record.strip_prefix(b"2 ") {
            let fields = split_fields(payload, 9, "renamed or copied change")?;
            let original_path = records.next().ok_or_else(|| {
                format!(
                    "Git omitted the original path for renamed file '{}'.",
                    decode_git_bytes(fields[8])
                )
            })?;
            push_tracked_change(
                fields[0],
                fields[8],
                Some(original_path),
                &mut staged,
                &mut unstaged,
            )?;
        } else if let Some(payload) = record.strip_prefix(b"u ") {
            let fields = split_fields(payload, 10, "unmerged change")?;
            validate_xy(fields[0])?;
            validate_path(fields[9])?;
            conflicts.push(FileChange {
                path: decode_git_bytes(fields[9]),
                original_path: None,
                status: FileStatus::Conflicted,
            });
        } else if let Some(path) = record.strip_prefix(b"? ") {
            validate_path(path)?;
            unstaged.push(FileChange {
                path: decode_git_bytes(path),
                original_path: None,
                status: FileStatus::Untracked,
            });
        } else {
            return Err(format!(
                "System Git returned an unknown porcelain-v2 record: {}",
                decode_git_bytes(record)
            ));
        }
    }

    if !saw_branch_head {
        return Err("System Git did not report the current branch state.".to_owned());
    }

    staged.sort_by(|left, right| left.path.cmp(&right.path));
    unstaged.sort_by(|left, right| left.path.cmp(&right.path));
    conflicts.sort_by(|left, right| left.path.cmp(&right.path));

    Ok(RepositoryStatus {
        branch: BranchStatus {
            name: branch_name,
            oid,
            is_detached,
            upstream,
            ahead,
            behind,
        },
        staged,
        unstaged,
        conflicts,
        stash_count,
    })
}

fn parse_ahead_behind(value: &str) -> Result<(u32, u32), String> {
    let mut counts = value.split(' ');
    let ahead = parse_prefixed_count(counts.next(), '+', "ahead")?;
    let behind = parse_prefixed_count(counts.next(), '-', "behind")?;

    if counts.next().is_some() {
        return Err(format!(
            "Invalid ahead/behind counts in Git status header: {value}"
        ));
    }

    Ok((ahead, behind))
}

fn parse_text_field<'a>(value: &'a [u8], label: &str) -> Result<&'a str, String> {
    std::str::from_utf8(value).map_err(|_| format!("Git returned non-UTF-8 bytes in the {label}."))
}

fn parse_prefixed_count(value: Option<&str>, prefix: char, label: &str) -> Result<u32, String> {
    value
        .and_then(|count| count.strip_prefix(prefix))
        .and_then(|count| count.parse::<u32>().ok())
        .ok_or_else(|| format!("Invalid {label} count in Git status output."))
}

fn split_fields<'a>(
    payload: &'a [u8],
    expected: usize,
    record_name: &str,
) -> Result<Vec<&'a [u8]>, String> {
    let fields: Vec<_> = payload.splitn(expected, |byte| *byte == b' ').collect();

    if fields.len() != expected {
        return Err(format!(
            "Git returned a malformed {record_name} record with {} of {expected} fields.",
            fields.len()
        ));
    }

    Ok(fields)
}

fn push_tracked_change(
    xy: &[u8],
    path: &[u8],
    original_path: Option<&[u8]>,
    staged: &mut Vec<FileChange>,
    unstaged: &mut Vec<FileChange>,
) -> Result<(), String> {
    let (index_status, worktree_status) = validate_xy(xy)?;
    validate_path(path)?;

    if let Some(status) = file_status(index_status)? {
        staged.push(FileChange {
            path: decode_git_bytes(path),
            original_path: original_path.map(decode_git_bytes),
            status,
        });
    }

    if let Some(status) = file_status(worktree_status)? {
        unstaged.push(FileChange {
            path: decode_git_bytes(path),
            original_path: original_path.map(decode_git_bytes),
            status,
        });
    }

    Ok(())
}

fn validate_xy(xy: &[u8]) -> Result<(u8, u8), String> {
    if xy.len() != 2 || !xy.iter().all(u8::is_ascii) {
        return Err(format!(
            "Git returned an invalid XY status field: {}",
            decode_git_bytes(xy)
        ));
    }

    Ok((xy[0], xy[1]))
}

fn file_status(status: u8) -> Result<Option<FileStatus>, String> {
    let status = match status {
        b'.' => None,
        b'A' => Some(FileStatus::Added),
        b'M' => Some(FileStatus::Modified),
        b'D' => Some(FileStatus::Deleted),
        b'R' => Some(FileStatus::Renamed),
        b'C' => Some(FileStatus::Copied),
        b'T' => Some(FileStatus::TypeChanged),
        b'U' => Some(FileStatus::Conflicted),
        other => {
            return Err(format!(
                "Git returned an unknown file status: {}",
                decode_git_bytes(&[other])
            ))
        }
    };

    Ok(status)
}

fn validate_path(path: &[u8]) -> Result<(), String> {
    if path.is_empty() {
        Err("Git returned a status record with an empty path.".to_owned())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    const ORDINARY_METADATA: &str = "N... 100644 100644 100644 abcdef1 abcdef2";
    const UNMERGED_METADATA: &str = "N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc";

    fn temporary_directory(label: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        env::temp_dir().join(format!(
            "branchlight-status-{label}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn parses_branch_headers_and_groups_ordinary_changes() {
        let output = format!(
            "# branch.oid abc123\0# branch.head feature/status\0# branch.upstream origin/feature/status\0# branch.ab +2 -3\0# stash 4\01 M. {ORDINARY_METADATA} staged file.txt\01 .D {ORDINARY_METADATA} deleted file.txt\01 MM {ORDINARY_METADATA} both.txt\0? folder/untracked file\nwith newline.txt\0"
        );

        let status = parse_porcelain_v2(output.as_bytes()).expect("the status should parse");

        assert_eq!(status.branch.name.as_deref(), Some("feature/status"));
        assert_eq!(status.branch.oid.as_deref(), Some("abc123"));
        assert!(!status.branch.is_detached);
        assert_eq!(
            status.branch.upstream.as_deref(),
            Some("origin/feature/status")
        );
        assert_eq!(status.branch.ahead, Some(2));
        assert_eq!(status.branch.behind, Some(3));
        assert_eq!(status.stash_count, 4);
        assert_eq!(status.staged.len(), 2);
        assert_eq!(status.unstaged.len(), 3);
        assert_eq!(status.unstaged[2].status, FileStatus::Untracked);
        assert_eq!(
            status.unstaged[2].path,
            "folder/untracked file\nwith newline.txt"
        );
    }

    #[test]
    fn parses_renames_and_conflicts_with_nul_delimited_paths() {
        let output = format!(
            "# branch.oid abc123\0# branch.head main\02 R. {ORDINARY_METADATA} R100 new name.txt\0old name.txt\0u UU {UNMERGED_METADATA} conflicted name.txt\0"
        );

        let status = parse_porcelain_v2(output.as_bytes()).expect("the status should parse");

        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.staged[0].status, FileStatus::Renamed);
        assert_eq!(status.staged[0].path, "new name.txt");
        assert_eq!(
            status.staged[0].original_path.as_deref(),
            Some("old name.txt")
        );
        assert_eq!(status.conflicts.len(), 1);
        assert_eq!(status.conflicts[0].status, FileStatus::Conflicted);
        assert_eq!(status.conflicts[0].path, "conflicted name.txt");
    }

    #[test]
    fn represents_detached_head_without_an_upstream() {
        let output = "# branch.oid deadbeef\0# branch.head (detached)\0";

        let status = parse_porcelain_v2(output.as_bytes()).expect("the status should parse");

        assert!(status.branch.is_detached);
        assert_eq!(status.branch.name, None);
        assert_eq!(status.branch.oid.as_deref(), Some("deadbeef"));
        assert_eq!(status.branch.upstream, None);
        assert_eq!(status.branch.ahead, None);
        assert_eq!(status.branch.behind, None);
    }

    #[test]
    fn represents_an_initial_branch_without_an_upstream() {
        let output = "# branch.oid (initial)\0# branch.head main\0";

        let status = parse_porcelain_v2(output.as_bytes()).expect("the status should parse");

        assert_eq!(status.branch.name.as_deref(), Some("main"));
        assert_eq!(status.branch.oid, None);
        assert!(!status.branch.is_detached);
        assert_eq!(status.branch.upstream, None);
    }

    #[test]
    fn rejects_a_rename_without_an_original_path() {
        let output = format!(
            "# branch.oid abc123\0# branch.head main\02 R. {ORDINARY_METADATA} R100 new.txt\0"
        );

        let error = parse_porcelain_v2(output.as_bytes())
            .expect_err("a rename without its original path should not parse");

        assert!(error.contains("omitted the original path"));
    }

    #[test]
    fn reads_status_from_an_actual_repository() {
        let repository = temporary_directory("integration");
        fs::create_dir_all(&repository).expect("the test repository should be created");
        let git_init = Command::new("git")
            .args(["init", "-b", "main"])
            .arg(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(git_init.status.success());

        let initial_status = get_repository_status(&repository)
            .expect("the initial repository status should be read");
        assert!(initial_status.unstaged.is_empty());

        let hide_untracked = Command::new("git")
            .args(["config", "status.showUntrackedFiles", "no"])
            .current_dir(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(hide_untracked.status.success());

        fs::write(repository.join("untracked file.txt"), "hello")
            .expect("the untracked test file should be written");

        let refreshed_status = get_repository_status(&repository)
            .expect("status should reflect an external file change");

        assert_eq!(refreshed_status.branch.name.as_deref(), Some("main"));
        assert_eq!(refreshed_status.branch.upstream, None);
        assert_eq!(refreshed_status.unstaged.len(), 1);
        assert_eq!(refreshed_status.unstaged[0].path, "untracked file.txt");
        assert_eq!(refreshed_status.unstaged[0].status, FileStatus::Untracked);

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn escapes_invalid_utf8_in_file_paths_without_replacement_characters() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt};

        let repository = temporary_directory("invalid-utf8");
        fs::create_dir_all(&repository).expect("the test repository should be created");
        let git_init = Command::new("git")
            .args(["init", "-b", "main"])
            .arg(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(git_init.status.success());

        let invalid_name = OsString::from_vec(b"invalid-\xff.txt".to_vec());
        fs::write(repository.join(invalid_name), "hello")
            .expect("the invalid UTF-8 test file should be written");

        let status = get_repository_status(&repository)
            .expect("status should preserve the invalid path bytes");

        assert_eq!(status.unstaged.len(), 1);
        assert_eq!(status.unstaged[0].path, "invalid-\\xff.txt");
        assert!(!status.unstaged[0].path.contains('\u{fffd}'));

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }
}
