use super::{
    inspection::{invalid, resolve},
    runner::{run_git, run_git_with_env},
};
use crate::models::{GitError, GitOutput, RepositoryOperation};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum HistoryAction {
    InteractiveRebase {
        revision: String,
        steps: Vec<super::rebase_plan::PlanStep>,
    },
    Amend {
        message: String,
    },
    Reword {
        revision: String,
        message: String,
    },
    CherryPick {
        revision: String,
    },
    Revert {
        revision: String,
    },
    Reset {
        revision: String,
        mode: ResetMode,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

fn message_valid(message: &str) -> Result<(), GitError> {
    if message.trim().is_empty() || message.contains('\0') {
        return Err(invalid("Enter a nonempty commit message."));
    }
    Ok(())
}
fn clean(repository: &Path) -> Result<(), GitError> {
    if !run_git(repository, &["status", "--porcelain"])?
        .stdout
        .is_empty()
    {
        return Err(invalid(
            "Commit or stash all changes before this history operation.",
        ));
    }
    Ok(())
}
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Validates the reviewed branch/HEAD and executes one serialized history action.
pub(crate) fn execute(
    repository: &Path,
    expected_head: &str,
    expected_branch: &str,
    action: HistoryAction,
) -> Result<GitOutput, GitError> {
    if super::conflicts::get_repository_operation(repository)? != RepositoryOperation::None {
        return Err(invalid("Finish or abort the active Git operation first."));
    }
    let head = resolve(repository, "HEAD")?;
    if head != expected_head {
        return Err(invalid(
            "HEAD changed. Refresh and review the operation again.",
        ));
    }
    // History rewriting is scoped to a checked-out local branch.
    let branch = run_git(repository, &["symbolic-ref", "--quiet", "HEAD"])?;
    if branch.stdout.trim() != format!("refs/heads/{expected_branch}") {
        return Err(invalid(
            "The checked-out branch changed. Refresh and review the operation again.",
        ));
    }
    match action {
        HistoryAction::InteractiveRebase { revision, steps } => {
            super::rebase_plan::execute(repository, &revision, steps)
        }
        HistoryAction::Amend { message } => {
            message_valid(&message)?;
            run_git(repository, &["commit", "--amend", "-m", &message])
        }
        HistoryAction::Reword { revision, message } => {
            message_valid(&message)?;
            let oid = resolve(repository, &revision)?;
            run_git(repository, &["merge-base", "--is-ancestor", &oid, "HEAD"])?;
            if oid == head {
                return run_git(repository, &["commit", "--amend", "--only", "-m", &message]);
            }
            clean(repository)?;
            let parents = run_git(repository, &["rev-list", "--parents", "-n", "1", &oid])?;
            let parent = parents.stdout.split_whitespace().nth(1);
            let range = parent.map_or_else(|| "HEAD".to_owned(), |p| format!("{p}..HEAD"));
            if !run_git(repository, &["rev-list", "--merges", &range])?
                .stdout
                .is_empty()
            {
                return Err(invalid(
                    "Reword across merge commits requires an external Git tool.",
                ));
            }
            // Git runs editor commands through its own shell on macOS and Windows.
            // Only the first replayed commit is reworded; normal hooks remain enabled.
            let sequence = "sed '1s/^pick /reword /' \"$1\" > \"$1.branchlight\" && mv \"$1.branchlight\" \"$1\"";
            let sequence_command = format!("sh -c {} --", quote(sequence));
            let editor = format!("printf '%s\\n' {} >", quote(&message));
            let mut args = vec![
                "-c",
                "rebase.autoStash=false",
                "-c",
                "rebase.abbreviateCommands=false",
                "-c",
                "rebase.instructionFormat=%s",
                "-c",
                "commit.cleanup=whitespace",
                "rebase",
                "--interactive",
                "--no-autosquash",
                "--no-update-refs",
                "--reapply-cherry-picks",
                "--keep-empty",
            ];
            if let Some(parent) = parent {
                args.push(parent);
            } else {
                args.push("--root");
            }
            run_git_with_env(
                repository,
                &args,
                &[
                    ("GIT_SEQUENCE_EDITOR", &sequence_command),
                    ("GIT_EDITOR", &editor),
                    ("GIT_TERMINAL_PROMPT", "0"),
                ],
            )
        }
        HistoryAction::CherryPick { revision } => apply(repository, "cherry-pick", &revision),
        HistoryAction::Revert { revision } => apply(repository, "revert", &revision),
        HistoryAction::Reset { revision, mode } => {
            let oid = resolve(repository, &revision)?;
            let mode = match mode {
                ResetMode::Soft => "--soft",
                ResetMode::Mixed => "--mixed",
                ResetMode::Hard => "--hard",
            };
            run_git(repository, &["reset", mode, &oid, "--"])
        }
    }
}

/// Aborts only the matching active cherry-pick or revert.
pub(crate) fn abort(repository: &Path, kind: &str) -> Result<GitOutput, GitError> {
    let expected = match kind {
        "cherryPick" => RepositoryOperation::CherryPick,
        "revert" => RepositoryOperation::Revert,
        _ => return Err(invalid("Choose cherry-pick or revert to abort.")),
    };
    if super::conflicts::get_repository_operation(repository)? != expected {
        return Err(invalid(
            "The active operation changed. Refresh before aborting.",
        ));
    }
    run_git(
        repository,
        &[
            if kind == "cherryPick" {
                "cherry-pick"
            } else {
                "revert"
            },
            "--abort",
        ],
    )
}

/// Applies one non-merge commit only after verifying the worktree is clean.
fn apply(repository: &Path, command: &str, revision: &str) -> Result<GitOutput, GitError> {
    clean(repository)?;
    let oid = resolve(repository, revision)?;
    let parents = run_git(repository, &["rev-list", "--parents", "-n", "1", &oid])?;
    if parents.stdout.split_whitespace().count() > 2 {
        return Err(invalid(
            "Select a non-merge commit; choosing a merge mainline requires external Git.",
        ));
    }
    run_git_with_env(
        repository,
        &[command, "--no-edit", &oid],
        &[("GIT_EDITOR", "true")],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };
    fn execute(
        repository: &Path,
        expected_head: &str,
        action: HistoryAction,
    ) -> Result<GitOutput, GitError> {
        super::execute(repository, expected_head, "main", action)
    }
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "branchlight-history-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                crate::git::fixture_nonce()
            ));
            fs::create_dir(&path).unwrap();
            let f = Self(path);
            f.git(&["init", "-b", "main"]);
            f.git(&["config", "user.name", "History Test"]);
            f.git(&["config", "user.email", "history@example.invalid"]);
            f.commit("base", "base");
            f
        }
        fn git(&self, args: &[&str]) -> String {
            let output = Command::new("git")
                .current_dir(&self.0)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        }
        fn head(&self) -> String {
            self.git(&["rev-parse", "HEAD"])
        }
        fn commit(&self, text: &str, message: &str) {
            fs::write(self.0.join("file"), text).unwrap();
            self.git(&["add", "file"]);
            self.git(&["commit", "-m", message]);
        }
        fn execute(&self, action: HistoryAction) {
            execute(&self.0, &self.head(), action).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn plan_step(
        hash: &str,
        action: super::super::rebase_plan::PlanAction,
        message: Option<&str>,
    ) -> super::super::rebase_plan::PlanStep {
        super::super::rebase_plan::PlanStep {
            hash: hash.into(),
            action,
            message: message.map(str::to_owned),
        }
    }

    #[test]
    fn interactive_plan_reorders_independent_changes_and_preserves_all_commit_identities() {
        use super::super::rebase_plan::{inspect, PlanAction::*};
        let f = Fixture::new();
        fs::write(f.0.join("alpha"), "alpha").unwrap();
        f.git(&["add", "alpha"]);
        f.git(&["commit", "-m", "Alpha"]);
        let alpha = f.head();
        fs::write(f.0.join("beta"), "beta").unwrap();
        f.git(&["add", "beta"]);
        f.git(&["commit", "-m", "Beta"]);
        let beta = f.head();
        let plan = inspect(&f.0, &alpha).unwrap();
        assert_eq!(
            plan.iter().map(|c| c.hash.as_str()).collect::<Vec<_>>(),
            vec![alpha.as_str(), beta.as_str()]
        );
        f.execute(HistoryAction::InteractiveRebase {
            revision: alpha.clone(),
            steps: vec![plan_step(&beta, Pick, None), plan_step(&alpha, Pick, None)],
        });
        assert_eq!(f.git(&["log", "-2", "--format=%s"]), "Alpha\nBeta");
        assert!(f.0.join("alpha").exists() && f.0.join("beta").exists());
    }

    #[test]
    fn interactive_plan_handles_drop_squash_and_literal_reword_messages() {
        use super::super::rebase_plan::PlanAction::*;
        let f = Fixture::new();
        let mut hashes = Vec::new();
        for name in ["alpha", "beta", "gamma"] {
            fs::write(f.0.join(name), name).unwrap();
            f.git(&["add", name]);
            f.git(&["commit", "-m", name]);
            hashes.push(f.head());
        }
        f.execute(HistoryAction::InteractiveRebase {
            revision: hashes[0].clone(),
            steps: vec![
                plan_step(
                    &hashes[0],
                    Reword,
                    Some("Literal 'quote' $(touch injected)\n\nBody with `ticks`"),
                ),
                plan_step(&hashes[1], Drop, None),
                plan_step(&hashes[2], Squash, None),
            ],
        });
        assert_eq!(f.git(&["rev-list", "--count", "HEAD"]), "2");
        assert!(!f.0.join("beta").exists() && !f.0.join("injected").exists());
        assert!(f
            .git(&["log", "-1", "--format=%B"])
            .contains("$(touch injected)"));
    }

    #[test]
    fn interactive_plan_rejects_duplicates_invalid_squash_and_stale_head() {
        use super::super::rebase_plan::PlanAction::*;
        let f = Fixture::new();
        let base = f.head();
        f.commit("next", "Next");
        let next = f.head();
        let action = || HistoryAction::InteractiveRebase {
            revision: base.clone(),
            steps: vec![plan_step(&base, Pick, None), plan_step(&base, Drop, None)],
        };
        assert!(execute(&f.0, &next, action()).is_err());
        assert!(execute(&f.0, &base, action()).is_err());
        assert!(execute(
            &f.0,
            &next,
            HistoryAction::InteractiveRebase {
                revision: base.clone(),
                steps: vec![plan_step(&base, Squash, None), plan_step(&next, Pick, None)]
            }
        )
        .is_err());
        assert_eq!(f.head(), next);
    }

    #[test]
    fn interactive_reword_survives_conflict_recovery_without_losing_its_message() {
        use super::super::{
            conflicts::{recover_rebase, RebaseRecovery},
            rebase_plan::PlanAction::*,
        };
        let f = Fixture::new();
        f.commit("one", "One");
        let one = f.head();
        f.commit("two", "Two");
        let two = f.head();
        assert!(execute(
            &f.0,
            &two,
            HistoryAction::InteractiveRebase {
                revision: one.clone(),
                steps: vec![
                    plan_step(&two, Pick, None),
                    plan_step(&one, Reword, Some("Reviewed message\n\nPreserved body"))
                ],
            }
        )
        .is_err());
        fs::write(f.0.join("file"), "two resolved").unwrap();
        f.git(&["add", "file"]);
        assert!(recover_rebase(&f.0, RebaseRecovery::Continue).is_err());
        fs::write(f.0.join("file"), "one resolved").unwrap();
        f.git(&["add", "file"]);
        recover_rebase(&f.0, RebaseRecovery::Continue).unwrap();
        assert_eq!(
            f.git(&["log", "-1", "--format=%B"]),
            "Reviewed message\n\nPreserved body"
        );
        assert!(!f.0.join(".git/branchlight-rebase-plan").exists());
    }
    #[test]
    fn skipped_conflicting_reword_preserves_the_previous_commit_message() {
        use super::super::{
            conflicts::{recover_rebase, RebaseRecovery},
            rebase_plan::PlanAction::*,
        };
        for reword_first in [true, false] {
            let f = Fixture::new();
            let base = f.head();
            f.commit("one", "One");
            let one = f.head();
            f.commit("two", "Two");
            let two = f.head();
            let steps = if reword_first {
                vec![
                    plan_step(&two, Reword, Some("Must never amend the base")),
                    plan_step(&one, Drop, None),
                ]
            } else {
                vec![
                    plan_step(&two, Pick, None),
                    plan_step(&one, Reword, Some("Must never amend Two")),
                ]
            };
            assert!(execute(
                &f.0,
                &two,
                HistoryAction::InteractiveRebase {
                    revision: one,
                    steps
                }
            )
            .is_err());
            let before = if reword_first {
                base
            } else {
                fs::write(f.0.join("file"), "two resolved").unwrap();
                f.git(&["add", "file"]);
                assert!(recover_rebase(&f.0, RebaseRecovery::Continue).is_err());
                f.head()
            };
            let message = f.git(&["log", "-1", "--format=%B"]);
            recover_rebase(&f.0, RebaseRecovery::Skip).unwrap();
            assert_eq!(f.head(), before);
            assert_eq!(f.git(&["log", "-1", "--format=%B"]), message);
            assert_eq!(
                super::super::conflicts::get_repository_operation(&f.0).unwrap(),
                RepositoryOperation::None
            );
        }
    }

    #[test]
    fn stale_generated_plans_are_removed_without_deleting_unknown_files() {
        use super::super::rebase_plan::PlanAction::*;
        let f = Fixture::new();
        let base = f.head();
        let directory = f.0.join(".git/branchlight-rebase-plan");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("todo"), "old todo").unwrap();
        fs::write(directory.join("message-199"), "old message").unwrap();
        f.execute(HistoryAction::InteractiveRebase {
            revision: base.clone(),
            steps: vec![plan_step(&base, Reword, Some("New message"))],
        });
        assert_eq!(f.git(&["log", "-1", "--format=%s"]), "New message");
        assert!(!directory.exists());
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("unrelated"), "Keep this file").unwrap();
        let head = f.head();
        assert!(execute(
            &f.0,
            &head,
            HistoryAction::InteractiveRebase {
                revision: head.clone(),
                steps: vec![plan_step(&head, Pick, None)]
            }
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(directory.join("unrelated")).unwrap(),
            "Keep this file"
        );
        assert_eq!(f.head(), head);
    }

    #[test]
    fn amend_includes_index_but_reword_preserves_it() {
        let f = Fixture::new();
        fs::write(f.0.join("file"), "staged").unwrap();
        f.git(&["add", "file"]);
        f.execute(HistoryAction::Reword {
            revision: f.head(),
            message: "new message\n\nbody".into(),
        });
        assert_eq!(f.git(&["show", "HEAD:file"]), "base");
        assert_eq!(f.git(&["diff", "--cached", "--name-only"]), "file");
        f.execute(HistoryAction::Amend {
            message: "amended".into(),
        });
        assert_eq!(f.git(&["show", "HEAD:file"]), "staged");
    }
    #[test]
    fn rewords_older_and_root_commits_without_shell_interpolation() {
        for root in [false, true] {
            let f = Fixture::new();
            if !root {
                f.commit("second", "second");
            }
            let target = f.head();
            f.commit("third", "third");
            let tree = f.git(&["rev-parse", "HEAD^{tree}"]);
            let message = "message ' quoted $(touch SHOULD_NOT_EXIST) `echo no`\n\nbody";
            f.execute(HistoryAction::Reword {
                revision: target,
                message: message.into(),
            });
            assert_eq!(f.git(&["log", "-1", "--format=%B", "HEAD~1"]), message);
            assert_eq!(f.git(&["rev-parse", "HEAD^{tree}"]), tree);
            assert!(!f.0.join("SHOULD_NOT_EXIST").exists());
            assert_eq!(
                super::super::conflicts::get_repository_operation(&f.0).unwrap(),
                RepositoryOperation::None
            );
        }
    }
    #[test]
    fn reword_preserves_hash_subjects_and_markdown_in_older_commits() {
        for root in [false, true] {
            let f = Fixture::new();
            if !root {
                f.commit("second", "second");
            }
            let target = f.head();
            f.commit("third", "third");
            let tree = f.git(&["rev-parse", "HEAD^{tree}"]);
            let message = "#123 Fix crash\n\n# Markdown heading\nDetails remain.";
            // Explicit editor cleanup settings must not strip user-entered content.
            f.git(&["config", "commit.cleanup", "strip"]);
            f.execute(HistoryAction::Reword {
                revision: target,
                message: message.into(),
            });
            assert_eq!(f.git(&["log", "-1", "--format=%B", "HEAD~1"]), message);
            assert_eq!(f.git(&["rev-parse", "HEAD^{tree}"]), tree);
            assert!(f.git(&["status", "--porcelain"]).is_empty());
        }
    }
    #[test]
    fn rejects_a_different_branch_at_the_same_commit() {
        let f = Fixture::new();
        let head = f.head();
        f.git(&["switch", "-c", "other"]);
        assert!(execute(
            &f.0,
            &head,
            HistoryAction::Amend {
                message: "changed".into()
            }
        )
        .is_err());
        assert_eq!(f.head(), head);
        assert_eq!(f.git(&["log", "-1", "--format=%s"]), "base");
    }
    #[test]
    fn reset_modes_preserve_their_documented_index_and_worktree_effects() {
        for mode in [ResetMode::Soft, ResetMode::Mixed, ResetMode::Hard] {
            let f = Fixture::new();
            let base = f.head();
            f.commit("second", "second");
            let hard = matches!(mode, ResetMode::Hard);
            let soft = matches!(mode, ResetMode::Soft);
            f.execute(HistoryAction::Reset {
                revision: base.clone(),
                mode,
            });
            assert_eq!(f.head(), base);
            assert_eq!(
                fs::read_to_string(f.0.join("file")).unwrap(),
                if hard { "base" } else { "second" }
            );
            assert_eq!(
                !f.git(&["diff", "--cached", "--name-only"]).is_empty(),
                soft
            );
        }
    }
    #[test]
    fn cherry_pick_revert_and_conflicts_have_reliable_abort() {
        let f = Fixture::new();
        let base = f.head();
        f.git(&["switch", "-c", "topic"]);
        f.commit("topic", "topic");
        let topic = f.head();
        f.git(&["switch", "main"]);
        f.execute(HistoryAction::CherryPick {
            revision: topic.clone(),
        });
        f.execute(HistoryAction::Revert { revision: f.head() });
        assert_eq!(f.git(&["show", "HEAD:file"]), "base");
        f.commit("main", "main");
        let before = f.head();
        assert!(execute(&f.0, &before, HistoryAction::CherryPick { revision: topic }).is_err());
        assert_eq!(
            super::super::conflicts::get_repository_operation(&f.0).unwrap(),
            RepositoryOperation::CherryPick
        );
        assert!(abort(&f.0, "revert").is_err());
        abort(&f.0, "cherryPick").unwrap();
        assert_eq!(f.head(), before);
        assert!(execute(&f.0, &before, HistoryAction::Revert { revision: base }).is_err());
        assert_eq!(
            super::super::conflicts::get_repository_operation(&f.0).unwrap(),
            RepositoryOperation::Revert
        );
        abort(&f.0, "revert").unwrap();
        assert_eq!(f.head(), before);
    }
    #[test]
    fn rejects_stale_dirty_detached_and_invalid_requests() {
        let f = Fixture::new();
        let base = f.head();
        f.commit("second", "second");
        assert!(execute(
            &f.0,
            &base,
            HistoryAction::Reset {
                revision: base.clone(),
                mode: ResetMode::Hard
            }
        )
        .is_err());
        fs::write(f.0.join("untracked"), "keep").unwrap();
        assert!(execute(
            &f.0,
            &f.head(),
            HistoryAction::CherryPick {
                revision: base.clone()
            }
        )
        .is_err());
        assert!(execute(
            &f.0,
            &f.head(),
            HistoryAction::Reword {
                revision: base,
                message: "changed".into()
            }
        )
        .is_err());
        assert!(execute(
            &f.0,
            &f.head(),
            HistoryAction::Amend {
                message: " ".into()
            }
        )
        .is_err());
        f.git(&["switch", "--detach"]);
        assert!(execute(
            &f.0,
            &f.head(),
            HistoryAction::Amend {
                message: "changed".into()
            }
        )
        .is_err());
    }
}

#[cfg(all(test, unix))]
mod hook_tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt, process::Command};
    #[test]
    fn stopped_reword_keeps_rebase_state_and_can_abort() {
        let path =
            std::env::temp_dir().join(format!("branchlight-reword-hooks-{}", std::process::id()));
        fs::create_dir(&path).unwrap();
        let git = |args: &[&str]| {
            let o = Command::new("git")
                .current_dir(&path)
                .args(args)
                .output()
                .unwrap();
            assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
            String::from_utf8_lossy(&o.stdout).trim().to_owned()
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "Hooks"]);
        git(&["config", "user.email", "hooks@example.invalid"]);
        fs::write(path.join("file"), "base").unwrap();
        git(&["add", "file"]);
        git(&["commit", "-m", "base"]);
        let target = git(&["rev-parse", "HEAD"]);
        fs::write(path.join("file"), "next").unwrap();
        git(&["commit", "-am", "next"]);
        let head = git(&["rev-parse", "HEAD"]);
        let hooks = path.join(".git/custom-hooks");
        fs::create_dir(&hooks).unwrap();
        let hook = hooks.join("commit-msg");
        fs::write(&hook, "#!/bin/sh\necho 'hook rejected' >&2\nexit 1\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
        assert!(execute(
            &path,
            &head,
            "main",
            HistoryAction::Reword {
                revision: target,
                message: "changed".into()
            }
        )
        .is_err());
        assert_eq!(
            super::super::conflicts::get_repository_operation(&path).unwrap(),
            RepositoryOperation::Rebase
        );
        super::super::abort_rebase(&path).unwrap();
        assert_eq!(git(&["rev-parse", "HEAD"]), head);
        fs::remove_dir_all(path).unwrap();
    }
}
