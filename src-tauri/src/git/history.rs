use std::{collections::HashMap, path::Path};

use crate::models::{Commit, GitError};

use super::runner::{decode_git_bytes, run_git};

const HISTORY_LIMIT: usize = 200;
const COMMIT_FORMAT: &str = "--format=%H%x00%P%x00%s%x00%an%x00%at%x00";
const REF_FORMAT: &str = "--format=%(objectname)%00%(refname)%00%(symref)%00";

/// Returns a topologically ordered, bounded snapshot of commits reachable from all refs.
pub(crate) fn get_history(repository: &Path) -> Result<Vec<Commit>, GitError> {
    let limit = HISTORY_LIMIT.to_string();
    let output = run_git(
        repository,
        &["log", "--all", "--topo-order", "-n", &limit, COMMIT_FORMAT],
    )?;
    let mut commits = parse_commits(&output.stdout_bytes)
        .map_err(|message| GitError::InvalidHistoryResponse { message, output })?;
    if commits.is_empty() {
        return Ok(commits);
    }

    let refs_output = run_git(
        repository,
        &["for-each-ref", REF_FORMAT, "refs/heads/", "refs/remotes/"],
    )?;
    let refs = parse_refs(&refs_output.stdout_bytes).map_err(|message| {
        GitError::InvalidHistoryResponse {
            message,
            output: refs_output,
        }
    })?;

    for commit in &mut commits {
        commit.refs = refs.get(&commit.hash).cloned().unwrap_or_default();
    }

    Ok(commits)
}

/// Parses one newline-delimited record containing five NUL-delimited commit fields.
fn parse_commits(output: &[u8]) -> Result<Vec<Commit>, String> {
    let mut commits = Vec::new();

    for raw_record in output.split(|byte| *byte == b'\n') {
        let record = raw_record.strip_suffix(b"\r").unwrap_or(raw_record);
        if record.is_empty() {
            continue;
        }
        let fields: Vec<_> = record.split(|byte| *byte == b'\0').collect();
        if fields.len() != 6 || !fields[5].is_empty() {
            return Err(format!(
                "Git returned a malformed history entry with {} of 5 fields.",
                fields.len().saturating_sub(1)
            ));
        }

        let hash = parse_object_id(fields[0], "commit hash")?;
        let parents = if fields[1].is_empty() {
            Vec::new()
        } else {
            fields[1]
                .split(|byte| *byte == b' ')
                .map(|parent| parse_object_id(parent, "parent hash"))
                .collect::<Result<Vec<_>, _>>()?
        };
        let timestamp = parse_timestamp(fields[4])?;

        commits.push(Commit {
            hash,
            parents,
            refs: Vec::new(),
            subject: decode_git_bytes(fields[2]),
            author: decode_git_bytes(fields[3]),
            timestamp,
        });
    }

    if commits.len() > HISTORY_LIMIT {
        return Err(format!(
            "Git returned more than the requested {HISTORY_LIMIT} history entries."
        ));
    }

    Ok(commits)
}

/// Maps exact local and remote branch refs to the commit objects they currently name.
fn parse_refs(output: &[u8]) -> Result<HashMap<String, Vec<String>>, String> {
    let mut refs_by_commit: HashMap<String, Vec<String>> = HashMap::new();

    for raw_record in output.split(|byte| *byte == b'\n') {
        let record = raw_record.strip_suffix(b"\r").unwrap_or(raw_record);
        if record.is_empty() {
            continue;
        }
        let fields: Vec<_> = record.split(|byte| *byte == b'\0').collect();
        if fields.len() != 4 || !fields[3].is_empty() {
            return Err(format!(
                "Git returned a malformed history ref with {} of 3 fields.",
                fields.len().saturating_sub(1)
            ));
        }
        if !fields[2].is_empty() {
            continue;
        }

        let hash = parse_object_id(fields[0], "ref target")?;
        let label = if let Some(name) = fields[1].strip_prefix(b"refs/heads/") {
            decode_ref_name(name, "local")?
        } else if let Some(name) = fields[1].strip_prefix(b"refs/remotes/") {
            decode_ref_name(name, "remote")?
        } else {
            return Err(format!(
                "Git returned an unexpected history ref: {}",
                decode_git_bytes(fields[1])
            ));
        };
        refs_by_commit.entry(hash).or_default().push(label);
    }

    for refs in refs_by_commit.values_mut() {
        refs.sort();
    }
    Ok(refs_by_commit)
}

/// Validates SHA-1 and SHA-256 object IDs before exposing them to the UI.
fn parse_object_id(value: &[u8], label: &str) -> Result<String, String> {
    if matches!(value.len(), 40 | 64) && value.iter().all(u8::is_ascii_hexdigit) {
        Ok(decode_git_bytes(value))
    } else {
        Err(format!("Git returned an invalid {label}."))
    }
}

/// Parses the Unix author timestamp emitted by `%at`.
fn parse_timestamp(value: &[u8]) -> Result<i64, String> {
    std::str::from_utf8(value)
        .ok()
        .and_then(|timestamp| timestamp.parse::<i64>().ok())
        .ok_or_else(|| "Git returned an invalid commit timestamp.".to_owned())
}

/// Decodes a non-empty short ref name after its namespace has been validated.
fn decode_ref_name(value: &[u8], kind: &str) -> Result<String, String> {
    if value.is_empty() {
        Err(format!("Git returned an empty {kind} branch ref."))
    } else {
        Ok(decode_git_bytes(value))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        process::{Command, Output},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn temporary_repository(label: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        let repository = env::temp_dir().join(format!(
            "branchlight-history-{label}-{}-{unique}",
            std::process::id()
        ));

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
            assert!(git(&repository, &["config", key, value]).status.success());
        }
        repository
    }

    fn git(repository: &Path, arguments: &[&str]) -> Output {
        Command::new("git")
            .args(arguments)
            .current_dir(repository)
            .output()
            .expect("system Git should be available while building Branchlight")
    }

    #[test]
    fn parses_commit_parents_metadata_and_exact_branch_refs() {
        let first = "a".repeat(40);
        let second = "b".repeat(40);
        let record = format!(
            "{}\0{} {}\0Subject | with punctuation\0Ada Lovelace\x001700000000\0\n",
            "c".repeat(40),
            first,
            second
        );
        let mut commits = parse_commits(record.as_bytes()).expect("the commit should parse");
        let refs = format!(
            "{}\0refs/heads/main\0\0\n{}\0refs/remotes/origin/HEAD\0refs/remotes/origin/main\0\n",
            "c".repeat(40),
            "c".repeat(40)
        );
        let refs_by_commit = parse_refs(refs.as_bytes()).expect("the refs should parse");
        commits[0].refs = refs_by_commit
            .get(&commits[0].hash)
            .cloned()
            .unwrap_or_default();

        assert_eq!(commits[0].parents, vec![first, second]);
        assert_eq!(commits[0].subject, "Subject | with punctuation");
        assert_eq!(commits[0].author, "Ada Lovelace");
        assert_eq!(commits[0].timestamp, 1_700_000_000);
        assert_eq!(commits[0].refs, vec!["main"]);
    }

    #[test]
    fn rejects_malformed_history_output() {
        let error = parse_commits(b"not-a-hash\0\0subject\0author\x001700000000\0\n")
            .expect_err("an invalid hash should not parse");
        assert!(error.contains("invalid commit hash"));

        let error = parse_refs(b"abc\0refs/heads/main\0\0\n")
            .expect_err("an invalid ref target should not parse");
        assert!(error.contains("invalid ref target"));
    }

    #[test]
    fn returns_an_empty_history_for_an_unborn_repository() {
        let repository = temporary_repository("empty");

        let commits = get_history(&repository).expect("empty history should be valid");
        assert!(commits.is_empty());

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[test]
    fn keeps_merge_parents_and_branch_labels_from_real_git_history() {
        let repository = temporary_repository("merge");
        assert!(git(&repository, &["commit", "--allow-empty", "-m", "Base"])
            .status
            .success());
        assert!(git(&repository, &["switch", "-c", "feature"])
            .status
            .success());
        assert!(git(
            &repository,
            &["commit", "--allow-empty", "-m", "Feature work"]
        )
        .status
        .success());
        assert!(git(&repository, &["switch", "main"]).status.success());
        assert!(
            git(&repository, &["commit", "--allow-empty", "-m", "Main work"])
                .status
                .success()
        );
        assert!(git(
            &repository,
            &["merge", "--no-ff", "feature", "-m", "Merge feature"]
        )
        .status
        .success());

        let commits = get_history(&repository).expect("history should load");
        assert_eq!(commits[0].subject, "Merge feature");
        assert_eq!(commits[0].parents.len(), 2);
        assert_eq!(commits[0].refs, vec!["main"]);
        assert!(commits
            .iter()
            .any(|commit| commit.subject == "Feature work" && commit.refs == vec!["feature"]));

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }

    #[test]
    fn caps_history_at_two_hundred_commits() {
        let repository = temporary_repository("limit");
        for index in 0..205 {
            let message = format!("Commit {index}");
            assert!(
                git(&repository, &["commit", "--allow-empty", "-m", &message])
                    .status
                    .success()
            );
        }

        let commits = get_history(&repository).expect("bounded history should load");
        assert_eq!(commits.len(), HISTORY_LIMIT);
        assert_eq!(commits[0].subject, "Commit 204");
        assert_eq!(commits[HISTORY_LIMIT - 1].subject, "Commit 5");

        fs::remove_dir_all(repository).expect("the test repository should be removed");
    }
}
