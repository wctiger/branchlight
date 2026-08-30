use std::path::Path;

use crate::models::{Branch, Branches, GitError, GitOutput};

use super::runner::{decode_git_bytes, run_git};

const LOCAL_PREFIX: &[u8] = b"refs/heads/";
const REMOTE_PREFIX: &[u8] = b"refs/remotes/";

/// Reads local and remote branch refs using stable, machine-oriented fields.
pub(crate) fn get_branches(repository: &Path) -> Result<Branches, GitError> {
    let output = run_git(
        repository,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(objectname)%00%(HEAD)%00%(upstream)%00%(symref)",
            "refs/heads/",
            "refs/remotes/",
        ],
    )?;
    let mut branches = parse_branch_refs(&output.stdout_bytes).map_err(|message| {
        GitError::InvalidBranchesResponse {
            message,
            output: output.clone(),
        }
    })?;

    // An unborn branch has no refs/heads entry yet, so add it from symbolic HEAD.
    if !branches.local.iter().any(|branch| branch.is_current) {
        match run_git(repository, &["symbolic-ref", "--quiet", "HEAD"]) {
            Ok(head_output) => add_unborn_head(&mut branches, &head_output)?,
            Err(GitError::CommandFailed { output, .. }) if output.exit_code == Some(1) => {
                // A detached HEAD intentionally has no current local branch.
            }
            Err(error) => return Err(error),
        }
    }

    sort_branches(&mut branches);
    Ok(branches)
}

/// Switches to an existing local branch.
pub(crate) fn switch_branch(repository: &Path, branch_name: &str) -> Result<GitOutput, GitError> {
    validate_branch_name(branch_name)?;
    run_git(repository, &["switch", "--", branch_name])
}

/// Creates a local branch at HEAD and switches to it.
pub(crate) fn create_branch(repository: &Path, branch_name: &str) -> Result<GitOutput, GitError> {
    validate_branch_name(branch_name)?;
    run_git(repository, &["switch", "-c", branch_name])
}

/// Renames one local branch without overwriting an existing ref.
pub(crate) fn rename_branch(
    repository: &Path,
    old_name: &str,
    new_name: &str,
) -> Result<GitOutput, GitError> {
    validate_branch_name(old_name)?;
    validate_branch_name(new_name)?;
    run_git(repository, &["branch", "-m", "--", old_name, new_name])
}

/// Deletes a fully merged local branch. Force deletion is intentionally unavailable.
pub(crate) fn delete_branch(repository: &Path, branch_name: &str) -> Result<GitOutput, GitError> {
    validate_branch_name(branch_name)?;
    run_git(repository, &["branch", "-d", "--", branch_name])
}

/// Merges one local source branch into the currently checked-out branch.
pub(crate) fn merge_branch(repository: &Path, source_branch: &str) -> Result<GitOutput, GitError> {
    validate_integration_source(repository, source_branch)?;
    let source_ref = format!("refs/heads/{source_branch}");
    run_git(repository, &["merge", "--", &source_ref])
}

/// Rebases the currently checked-out branch onto one local source branch.
pub(crate) fn rebase_onto_branch(
    repository: &Path,
    source_branch: &str,
) -> Result<GitOutput, GitError> {
    validate_integration_source(repository, source_branch)?;
    let source_ref = format!("refs/heads/{source_branch}");
    run_git(repository, &["rebase", "--", &source_ref])
}

/// Restricts merge/rebase sources to existing non-current local branches.
fn validate_integration_source(repository: &Path, source_branch: &str) -> Result<(), GitError> {
    validate_branch_name(source_branch)?;
    let branches = get_branches(repository)?;
    let has_current_branch = branches.local.iter().any(|branch| branch.is_current);
    let valid_source = branches
        .local
        .iter()
        .any(|branch| branch.name == source_branch && !branch.is_current);

    if has_current_branch && valid_source {
        Ok(())
    } else {
        Err(GitError::InvalidOperationInput {
            message: "Choose a non-current local branch to merge or rebase.".to_owned(),
        })
    }
}

/// Rejects missing or NUL-containing branch names before invoking Git.
fn validate_branch_name(branch_name: &str) -> Result<(), GitError> {
    if branch_name.trim().is_empty() || branch_name.contains('\0') {
        Err(GitError::InvalidOperationInput {
            message: "Enter a local branch name before continuing.".to_owned(),
        })
    } else {
        Ok(())
    }
}

/// Parses the NUL-delimited fields emitted by `git for-each-ref`.
fn parse_branch_refs(output: &[u8]) -> Result<Branches, String> {
    let mut branches = Branches {
        local: Vec::new(),
        remote: Vec::new(),
    };

    for raw_record in output.split(|byte| *byte == b'\n') {
        let record = raw_record.strip_suffix(b"\r").unwrap_or(raw_record);
        if record.is_empty() {
            continue;
        }

        let fields: Vec<_> = record.split(|byte| *byte == b'\0').collect();
        if fields.len() != 5 {
            return Err(format!(
                "Git returned a malformed branch ref with {} of 5 fields.",
                fields.len()
            ));
        }

        let full_ref_bytes = fields[0];
        let (kind, name_bytes) = if let Some(name) = full_ref_bytes.strip_prefix(LOCAL_PREFIX) {
            (BranchKind::Local, name)
        } else if let Some(name) = full_ref_bytes.strip_prefix(REMOTE_PREFIX) {
            (BranchKind::Remote, name)
        } else {
            return Err(format!(
                "Git returned an unexpected branch ref: {}",
                decode_git_bytes(full_ref_bytes)
            ));
        };

        if name_bytes.is_empty() || fields[1].is_empty() {
            return Err("Git returned a branch with an empty name or commit.".to_owned());
        }

        // refs/remotes/<remote>/HEAD aliases are symbolic references, not branches.
        if !fields[4].is_empty() {
            continue;
        }

        let is_current = match fields[2] {
            b"*" => true,
            b"" | b" " => false,
            value => {
                return Err(format!(
                    "Git returned an invalid current-branch marker: {}",
                    decode_git_bytes(value)
                ))
            }
        };
        let branch = Branch {
            name: decode_git_bytes(name_bytes),
            full_ref: decode_git_bytes(full_ref_bytes),
            commit: Some(decode_git_bytes(fields[1])),
            is_current,
            upstream: (!fields[3].is_empty()).then(|| short_ref_name(fields[3])),
        };

        match kind {
            BranchKind::Local => branches.local.push(branch),
            BranchKind::Remote => branches.remote.push(branch),
        }
    }

    sort_branches(&mut branches);
    Ok(branches)
}

/// Adds the symbolic `HEAD` branch when it does not yet point to a commit.
fn add_unborn_head(branches: &mut Branches, output: &GitOutput) -> Result<(), GitError> {
    let full_ref_bytes = output
        .stdout_bytes
        .strip_suffix(b"\n")
        .unwrap_or(&output.stdout_bytes);
    let full_ref_bytes = full_ref_bytes.strip_suffix(b"\r").unwrap_or(full_ref_bytes);
    let Some(name_bytes) = full_ref_bytes.strip_prefix(LOCAL_PREFIX) else {
        return Err(GitError::InvalidBranchesResponse {
            message: "System Git returned an invalid symbolic HEAD ref.".to_owned(),
            output: output.clone(),
        });
    };

    if name_bytes.is_empty() {
        return Err(GitError::InvalidBranchesResponse {
            message: "System Git returned an empty symbolic HEAD ref.".to_owned(),
            output: output.clone(),
        });
    }

    let full_ref = decode_git_bytes(full_ref_bytes);
    if let Some(branch) = branches
        .local
        .iter_mut()
        .find(|branch| branch.full_ref == full_ref)
    {
        branch.is_current = true;
        return Ok(());
    }

    branches.local.push(Branch {
        name: decode_git_bytes(name_bytes),
        full_ref,
        commit: None,
        is_current: true,
        upstream: None,
    });
    Ok(())
}

/// Removes a known local or remote prefix for compact display.
fn short_ref_name(full_ref: &[u8]) -> String {
    full_ref
        .strip_prefix(REMOTE_PREFIX)
        .or_else(|| full_ref.strip_prefix(LOCAL_PREFIX))
        .map_or_else(|| decode_git_bytes(full_ref), decode_git_bytes)
}

/// Orders the current local branch first and all remaining refs by name.
fn sort_branches(branches: &mut Branches) {
    branches.local.sort_by(|left, right| {
        right
            .is_current
            .cmp(&left.is_current)
            .then_with(|| left.name.cmp(&right.name))
    });
    branches
        .remote
        .sort_by(|left, right| left.name.cmp(&right.name));
}

#[derive(Clone, Copy)]
enum BranchKind {
    Local,
    Remote,
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn temporary_repository(label: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        let repository = env::temp_dir().join(format!(
            "branchlight-branches-{label}-{}-{unique}",
            std::process::id()
        ));

        fs::create_dir_all(&repository).expect("the test repository should be created");
        let init = Command::new("git")
            .args(["init", "-b", "main"])
            .arg(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(init.status.success());

        for (key, value) in [
            ("user.name", "Branchlight Tests"),
            ("user.email", "branchlight@example.invalid"),
        ] {
            let config = Command::new("git")
                .args(["config", key, value])
                .current_dir(&repository)
                .output()
                .expect("system Git should be available while building Branchlight");
            assert!(config.status.success());
        }

        repository
    }

    fn commit_file(repository: &Path, path: &str, contents: &str, message: &str) {
        fs::write(repository.join(path), contents).expect("the test file should be written");
        let commit = Command::new("git")
            .args(["add", "--", path])
            .current_dir(repository)
            .output()
            .and_then(|_| {
                Command::new("git")
                    .args(["commit", "-m", message])
                    .current_dir(repository)
                    .output()
            })
            .expect("system Git should be available while building Branchlight");
        assert!(commit.status.success());
    }

    #[test]
    fn parses_local_and_remote_refs_and_ignores_remote_head_aliases() {
        let output = concat!(
            "refs/heads/main\0abc123\0*\0refs/remotes/origin/main\0\n",
            "refs/heads/topic\0def456\0 \0\0\n",
            "refs/remotes/origin/HEAD\0abc123\0 \0\0refs/remotes/origin/main\n",
            "refs/remotes/origin/main\0abc123\0 \0\0\n",
        );

        let branches = parse_branch_refs(output.as_bytes()).expect("the refs should parse");

        assert_eq!(branches.local.len(), 2);
        assert_eq!(branches.local[0].name, "main");
        assert!(branches.local[0].is_current);
        assert_eq!(branches.local[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(branches.local[0].commit.as_deref(), Some("abc123"));
        assert_eq!(branches.remote.len(), 1);
        assert_eq!(branches.remote[0].name, "origin/main");
    }

    #[test]
    fn rejects_malformed_machine_output() {
        let error = parse_branch_refs(b"refs/heads/main\0abc123\0*\n")
            .expect_err("an incomplete ref should not parse");

        assert!(error.contains("3 of 5 fields"));
    }

    #[test]
    fn reads_an_unborn_current_branch() {
        let repository = temporary_repository("unborn");

        let branches = get_branches(&repository).expect("branches should be read");

        assert_eq!(branches.local.len(), 1);
        assert_eq!(branches.local[0].name, "main");
        assert!(branches.local[0].is_current);
        assert_eq!(branches.local[0].commit, None);

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[test]
    fn creates_switches_renames_and_safely_deletes_local_branches() {
        let repository = temporary_repository("mutations");
        commit_file(&repository, "base.txt", "base\n", "Create base");

        create_branch(&repository, "feature/first").expect("the branch should be created");
        rename_branch(&repository, "feature/first", "feature/renamed")
            .expect("the branch should be renamed");
        switch_branch(&repository, "main").expect("main should be checked out");
        delete_branch(&repository, "feature/renamed")
            .expect("a fully merged branch should be deleted");

        let branches = get_branches(&repository).expect("branches should refresh");
        assert_eq!(branches.local.len(), 1);
        assert_eq!(branches.local[0].name, "main");
        assert!(branches.local[0].is_current);

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[test]
    fn refuses_to_delete_the_current_or_an_unmerged_branch() {
        let repository = temporary_repository("safe-delete");
        commit_file(&repository, "base.txt", "base\n", "Create base");
        create_branch(&repository, "feature/unmerged").expect("the branch should be created");

        let current_error = delete_branch(&repository, "feature/unmerged")
            .expect_err("the current branch should not be deleted");
        assert!(matches!(current_error, GitError::CommandFailed { .. }));

        commit_file(&repository, "feature.txt", "feature\n", "Create feature");
        switch_branch(&repository, "main").expect("main should be checked out");
        let unmerged_error = delete_branch(&repository, "feature/unmerged")
            .expect_err("an unmerged branch should not be deleted");
        assert!(matches!(unmerged_error, GitError::CommandFailed { .. }));

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[test]
    fn rejects_empty_branch_names_before_running_git() {
        let repository = temporary_repository("validation");

        assert!(matches!(
            create_branch(&repository, " \n\t"),
            Err(GitError::InvalidOperationInput { .. })
        ));
        assert!(matches!(
            rename_branch(&repository, "main", ""),
            Err(GitError::InvalidOperationInput { .. })
        ));
        assert!(matches!(
            delete_branch(&repository, "\0bad"),
            Err(GitError::InvalidOperationInput { .. })
        ));
        assert!(matches!(
            merge_branch(&repository, "main"),
            Err(GitError::InvalidOperationInput { .. })
        ));
        assert!(matches!(
            rebase_onto_branch(&repository, "missing"),
            Err(GitError::InvalidOperationInput { .. })
        ));

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[test]
    fn merges_a_local_source_into_the_current_branch() {
        let repository = temporary_repository("merge");
        commit_file(&repository, "base.txt", "base\n", "Create base");
        create_branch(&repository, "feature/merge").expect("the feature branch should be created");
        commit_file(&repository, "feature.txt", "feature\n", "Create feature");
        switch_branch(&repository, "main").expect("main should be checked out");
        let tag = Command::new("git")
            .args(["tag", "feature/merge"])
            .current_dir(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(tag.status.success());

        merge_branch(&repository, "feature/merge").expect("the feature should merge into main");

        assert_eq!(
            fs::read_to_string(repository.join("feature.txt"))
                .expect("the merged file should exist"),
            "feature\n"
        );
        assert!(get_branches(&repository)
            .expect("branches should refresh")
            .local
            .iter()
            .any(|branch| branch.name == "main" && branch.is_current));

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[test]
    fn rebases_the_current_branch_onto_a_local_source() {
        let repository = temporary_repository("rebase");
        commit_file(&repository, "base.txt", "base\n", "Create base");
        create_branch(&repository, "feature/rebase").expect("the feature branch should be created");
        commit_file(&repository, "feature.txt", "feature\n", "Create feature");
        switch_branch(&repository, "main").expect("main should be checked out");
        commit_file(&repository, "main.txt", "main\n", "Update main");
        let tag = Command::new("git")
            .args(["tag", "feature/rebase"])
            .current_dir(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(tag.status.success());

        rebase_onto_branch(&repository, "feature/rebase")
            .expect("main should rebase onto the feature branch");

        let ancestry = Command::new("git")
            .args([
                "merge-base",
                "--is-ancestor",
                "refs/heads/feature/rebase",
                "HEAD",
            ])
            .current_dir(&repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(ancestry.status.success());
        assert!(repository.join("feature.txt").exists());
        assert!(repository.join("main.txt").exists());

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }
}
