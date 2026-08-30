use std::path::Path;

use crate::models::{GitError, GitOutput, Stash};

use super::runner::{decode_git_bytes, run_git};

/// Lists stash entries using stable, machine-oriented fields.
pub(crate) fn get_stashes(repository: &Path) -> Result<Vec<Stash>, GitError> {
    let output = run_git(repository, &["stash", "list", "--format=%gd%x00%H%x00%gs"])?;
    parse_stashes(&output.stdout_bytes)
        .map_err(|message| GitError::InvalidStashesResponse { message, output })
}

/// Creates a stash with an optional user-provided message.
pub(crate) fn create_stash(repository: &Path, message: &str) -> Result<GitOutput, GitError> {
    let message = message.trim();
    if message.is_empty() {
        run_git(repository, &["stash", "push"])
    } else {
        run_git(repository, &["stash", "push", "-m", message])
    }
}

/// Applies a selected stash while preserving it in the stash list.
pub(crate) fn apply_stash(repository: &Path, stash_ref: &str) -> Result<GitOutput, GitError> {
    validate_stash_ref(stash_ref)?;
    run_git(repository, &["stash", "apply", stash_ref])
}

/// Applies and removes a selected stash when Git completes successfully.
pub(crate) fn pop_stash(repository: &Path, stash_ref: &str) -> Result<GitOutput, GitError> {
    validate_stash_ref(stash_ref)?;
    run_git(repository, &["stash", "pop", stash_ref])
}

/// Permanently removes one selected stash entry.
pub(crate) fn drop_stash(repository: &Path, stash_ref: &str) -> Result<GitOutput, GitError> {
    validate_stash_ref(stash_ref)?;
    run_git(repository, &["stash", "drop", stash_ref])
}

/// Parses NUL-delimited stash fields separated by one record newline.
fn parse_stashes(output: &[u8]) -> Result<Vec<Stash>, String> {
    let mut stashes = Vec::new();

    for raw_record in output.split(|byte| *byte == b'\n') {
        let record = raw_record.strip_suffix(b"\r").unwrap_or(raw_record);
        if record.is_empty() {
            continue;
        }

        let fields: Vec<_> = record.split(|byte| *byte == b'\0').collect();
        if fields.len() != 3 {
            return Err(format!(
                "Git returned a malformed stash entry with {} of 3 fields.",
                fields.len()
            ));
        }
        if fields.iter().any(|field| field.is_empty()) {
            return Err("Git returned a stash entry with an empty field.".to_owned());
        }

        let reference = decode_git_bytes(fields[0]);
        validate_stash_ref(&reference).map_err(|error| error.to_string())?;
        stashes.push(Stash {
            reference,
            commit: decode_git_bytes(fields[1]),
            message: decode_git_bytes(fields[2]),
        });
    }

    Ok(stashes)
}

/// Accepts only the `stash@{n}` references returned by `git stash list`.
fn validate_stash_ref(stash_ref: &str) -> Result<(), GitError> {
    let index = stash_ref
        .strip_prefix("stash@{")
        .and_then(|value| value.strip_suffix('}'));
    if index
        .is_some_and(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
    {
        Ok(())
    } else {
        Err(GitError::InvalidOperationInput {
            message: "Choose a valid stash entry before continuing.".to_owned(),
        })
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

    /// Creates a disposable repository with one committed tracked file.
    fn temporary_repository(label: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        let repository = env::temp_dir().join(format!(
            "branchlight-stashes-{label}-{}-{unique}",
            std::process::id()
        ));

        fs::create_dir_all(&repository).expect("the stash test repository should be created");
        for arguments in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Branchlight Tests"],
            vec!["config", "user.email", "branchlight@example.invalid"],
        ] {
            let output = Command::new("git")
                .args(arguments)
                .current_dir(&repository)
                .output()
                .expect("system Git should be available while building Branchlight");
            assert!(output.status.success());
        }

        fs::write(repository.join("tracked.txt"), "base\n")
            .expect("the tracked fixture file should be written");
        for arguments in [
            vec!["add", "--", "tracked.txt"],
            vec!["commit", "-m", "Create base"],
        ] {
            let output = Command::new("git")
                .args(arguments)
                .current_dir(&repository)
                .output()
                .expect("system Git should be available while building Branchlight");
            assert!(output.status.success());
        }

        repository
    }

    /// Restores the fixture worktree to `HEAD` between stash applications.
    fn reset_worktree(repository: &Path) {
        let output = Command::new("git")
            .args(["reset", "--hard", "HEAD"])
            .current_dir(repository)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(output.status.success());
    }

    #[test]
    fn creates_lists_applies_and_pops_a_stash() {
        let repository = temporary_repository("lifecycle");
        fs::write(repository.join("tracked.txt"), "stashed\n")
            .expect("the tracked fixture file should change");

        create_stash(&repository, "Work in progress").expect("the stash should be created");
        let stashes = get_stashes(&repository).expect("the stash list should load");
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].reference, "stash@{0}");
        assert!(stashes[0].message.contains("Work in progress"));
        assert_eq!(
            fs::read_to_string(repository.join("tracked.txt"))
                .expect("the tracked fixture file should exist"),
            "base\n"
        );

        apply_stash(&repository, "stash@{0}").expect("the stash should apply");
        assert_eq!(
            get_stashes(&repository).expect("stashes should load").len(),
            1
        );
        assert_eq!(
            fs::read_to_string(repository.join("tracked.txt"))
                .expect("the applied fixture file should exist"),
            "stashed\n"
        );

        reset_worktree(&repository);
        pop_stash(&repository, "stash@{0}").expect("the stash should pop");
        assert!(get_stashes(&repository)
            .expect("the stash list should refresh")
            .is_empty());

        fs::remove_dir_all(repository).expect("the stash test repository should be removed");
    }

    #[test]
    fn drops_a_stash_and_rejects_arbitrary_revisions() {
        let repository = temporary_repository("drop");
        fs::write(repository.join("tracked.txt"), "drop me\n")
            .expect("the tracked fixture file should change");
        create_stash(&repository, "Drop me").expect("the stash should be created");

        assert!(matches!(
            apply_stash(&repository, "HEAD"),
            Err(GitError::InvalidOperationInput { .. })
        ));
        drop_stash(&repository, "stash@{0}").expect("the stash should be dropped");
        assert!(get_stashes(&repository)
            .expect("the stash list should refresh")
            .is_empty());

        fs::remove_dir_all(repository).expect("the stash test repository should be removed");
    }

    #[test]
    fn rejects_malformed_stash_output() {
        let error = parse_stashes(b"stash@{0}\0abc123\n")
            .expect_err("an incomplete stash record should not parse");
        assert!(error.contains("2 of 3 fields"));
    }
}
