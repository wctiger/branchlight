use super::{inspection::invalid, runner::run_git};
use crate::models::{GitError, GitOutput};
use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::Path,
};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PullStrategy {
    Merge,
    Rebase,
    FastForwardOnly,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PushReview {
    pub branch: String,
    pub local_oid: String,
    pub remote: String,
    pub remote_ref: String,
    pub expected_oid: String,
    pub destination_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitOptions {
    pub summary: String,
    pub body: String,
    pub skip_hooks: bool,
    pub push_after_commit: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitResult {
    pub output: GitOutput,
    pub push_error: Option<GitError>,
}

pub(crate) fn remotes(repository: &Path) -> Result<Vec<String>, GitError> {
    Ok(run_git(repository, &["remote"])?
        .stdout
        .lines()
        .map(str::to_owned)
        .collect())
}

fn configured_remote(repository: &Path, remote: &str) -> Result<(), GitError> {
    if remote.starts_with('-') || !remotes(repository)?.iter().any(|name| name == remote) {
        return Err(invalid(
            "Choose an existing configured remote, then try again.",
        ));
    }
    Ok(())
}

fn local_branch(repository: &Path, name: &str) -> Result<(), GitError> {
    if !super::get_branches(repository)?
        .local
        .iter()
        .any(|branch| branch.name == name)
    {
        return Err(invalid(
            "Choose an existing local branch. Refresh branches and try again.",
        ));
    }
    Ok(())
}

fn branch_name(repository: &Path, name: &str) -> Result<(), GitError> {
    if name.starts_with('-') || name == "HEAD" || name.is_empty() || name.contains('\0') {
        return Err(invalid("Enter a valid local branch name."));
    }
    run_git(
        repository,
        &["check-ref-format", &format!("refs/heads/{name}")],
    )?;
    Ok(())
}

pub(crate) fn create_at(
    repository: &Path,
    name: &str,
    revision: &str,
    checkout: bool,
) -> Result<GitOutput, GitError> {
    branch_name(repository, name)?;
    let oid = super::inspection::resolve(repository, revision)?;
    if checkout {
        run_git(repository, &["switch", "--no-track", "-c", name, &oid])
    } else {
        run_git(repository, &["branch", "--no-track", "--", name, &oid])
    }
}

fn remote_ref(repository: &Path, reference: &str) -> Result<(), GitError> {
    if !super::get_branches(repository)?
        .remote
        .iter()
        .any(|branch| branch.full_ref == reference)
    {
        return Err(invalid(
            "Choose an existing remote-tracking branch. Fetch and refresh if it is missing.",
        ));
    }
    Ok(())
}

pub(crate) fn checkout_remote(
    repository: &Path,
    name: &str,
    reference: &str,
) -> Result<GitOutput, GitError> {
    branch_name(repository, name)?;
    remote_ref(repository, reference)?;
    run_git(repository, &["switch", "--track", "-c", name, reference])
}

pub(crate) fn set_upstream(
    repository: &Path,
    name: &str,
    reference: &str,
) -> Result<GitOutput, GitError> {
    local_branch(repository, name)?;
    remote_ref(repository, reference)?;
    run_git(
        repository,
        &[
            "branch",
            &format!("--set-upstream-to={reference}"),
            "--",
            name,
        ],
    )
}

pub(crate) fn fetch_options(
    repository: &Path,
    remote: &str,
    prune: bool,
) -> Result<GitOutput, GitError> {
    configured_remote(repository, remote)?;
    if prune {
        let mappings = run_git(
            repository,
            &["config", "--get-all", &format!("remote.{remote}.fetch")],
        )?;
        let prefix = format!("refs/remotes/{remote}/");
        if mappings
            .stdout
            .lines()
            .filter(|line| !line.starts_with('^'))
            .any(|line| {
                line.split_once(':')
                    .is_none_or(|(_, destination)| !destination.starts_with(&prefix))
            })
        {
            return Err(invalid("Pruning is limited to this remote's tracking refs. Review its custom fetch refspecs using external Git."));
        }
    }
    // Override fetch.prune so the unchecked choice also has a defined effect.
    run_git(
        repository,
        &[
            "fetch",
            if prune { "--prune" } else { "--no-prune" },
            "--no-prune-tags",
            "--",
            remote,
        ],
    )
}

fn tracking(repository: &Path) -> Result<(String, String, String), GitError> {
    let branches = super::get_branches(repository)?;
    let current = branches
        .local
        .iter()
        .find(|branch| branch.is_current && branch.commit.is_some())
        .ok_or_else(|| invalid("Check out a committed local branch before pulling or pushing."))?;
    let output = run_git(
        repository,
        &[
            "for-each-ref",
            "--format=%(upstream:remotename)%00%(upstream:remoteref)",
            &current.full_ref,
        ],
    )?;
    let fields: Vec<_> = output
        .stdout
        .trim_end_matches(['\r', '\n'])
        .split('\0')
        .collect();
    if fields.len() != 2 || fields[0].is_empty() || !fields[1].starts_with("refs/heads/") {
        return Err(invalid(
            "Set this local branch's upstream in Branches before pulling or pushing.",
        ));
    }
    configured_remote(repository, fields[0])?;
    Ok((
        current.name.clone(),
        fields[0].to_owned(),
        fields[1].to_owned(),
    ))
}

pub(crate) fn pull_options(
    repository: &Path,
    strategy: PullStrategy,
) -> Result<GitOutput, GitError> {
    let (_, remote, reference) = tracking(repository)?;
    let mut args = vec!["pull", "--no-autostash"];
    match strategy {
        PullStrategy::Merge => args.extend(["--no-rebase", "--ff"]),
        PullStrategy::Rebase => args.push("--rebase"),
        PullStrategy::FastForwardOnly => args.extend(["--no-rebase", "--ff-only"]),
    }
    args.extend(["--", &remote, &reference]);
    run_git(repository, &args)
}

pub(crate) fn push_normal(repository: &Path) -> Result<GitOutput, GitError> {
    let (branch, remote, reference) = tracking(repository)?;
    // An explicit refspec prevents push.default, remote.push or pushRemote from
    // redirecting the user's selected upstream destination or pushing extra refs.
    let refspec = format!("refs/heads/{branch}:{reference}");
    run_git(
        repository,
        &[
            "-c",
            "push.followTags=false",
            "push",
            "--no-force",
            "--recurse-submodules=no",
            "--",
            &remote,
            &refspec,
        ],
    )
}

pub(crate) fn review_push(repository: &Path) -> Result<PushReview, GitError> {
    let (branch, remote, remote_ref) = tracking(repository)?;
    let urls = run_git(
        repository,
        &["remote", "get-url", "--push", "--all", &remote],
    )?
    .stdout;
    let fetch_urls = run_git(repository, &["remote", "get-url", "--all", &remote])?.stdout;
    if urls.lines().count() != 1 || urls != fetch_urls {
        return Err(invalid("Force-with-lease requires one matching fetch/push URL. Review this remote's configuration using external Git."));
    }
    let mut digest = DefaultHasher::new();
    urls.hash(&mut digest);
    let local_oid = super::inspection::resolve(repository, "HEAD")?;
    let expected_oid = super::inspection::resolve(repository, "@{upstream}").map_err(|_| {
        invalid(
            "Fetch the upstream before reviewing a force push; its expected commit is unavailable.",
        )
    })?;
    Ok(PushReview {
        branch,
        local_oid,
        remote,
        remote_ref,
        expected_oid,
        destination_id: format!("{:x}", digest.finish()),
    })
}

pub(crate) fn force_push(repository: &Path, review: &PushReview) -> Result<GitOutput, GitError> {
    let current = review_push(repository)?;
    if current.branch != review.branch
        || current.local_oid != review.local_oid
        || current.remote != review.remote
        || current.remote_ref != review.remote_ref
        || current.destination_id != review.destination_id
    {
        return Err(invalid(
            "The local branch or destination changed. Cancel and review the force push again.",
        ));
    }
    if !matches!(review.expected_oid.len(), 40 | 64)
        || !review
            .expected_oid
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(invalid(
            "Review the expected upstream commit before force pushing.",
        ));
    }
    // Use the originally reviewed OID even if fetch has advanced tracking refs.
    let lease = format!(
        "--force-with-lease={}:{}",
        review.remote_ref, review.expected_oid
    );
    let refspec = format!("{}:{}", review.local_oid, review.remote_ref);
    run_git(repository, &["-c", "push.followTags=false", "push", "--recurse-submodules=no", &lease, "--", &review.remote, &refspec])
        .map_err(|error| match error {
            GitError::CommandFailed { output, .. } => GitError::CommandFailed { message: "Force-with-lease was rejected or the push failed. Fetch and review the destination; no unprotected force retry was attempted.".to_owned(), output },
            other => other,
        })
}

pub(crate) fn compose_commit(
    repository: &Path,
    options: &CommitOptions,
) -> Result<CommitResult, GitError> {
    let summary = options.summary.trim();
    if summary.is_empty() || summary.contains(['\r', '\n', '\0']) || options.body.contains('\0') {
        return Err(invalid(
            "Enter a single-line commit summary and a body without NUL characters.",
        ));
    }
    let message = if options.body.trim().is_empty() {
        summary.to_owned()
    } else {
        format!("{summary}\n\n{}", options.body.trim())
    };
    let output = if options.skip_hooks {
        run_git(repository, &["commit", "--no-verify", "-m", &message])?
    } else {
        super::commit(repository, &message)?
    };
    let push_error = if options.push_after_commit {
        push_normal(repository).err()
    } else {
        None
    };
    Ok(CommitResult { output, push_error })
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

    struct Fixture {
        root: PathBuf,
        remote: PathBuf,
        source: PathBuf,
        client: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
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
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }
    fn identity(path: &Path) {
        git(path, &["config", "user.name", "Delivery Tests"]);
        git(path, &["config", "user.email", "delivery@example.invalid"]);
        git(path, &["config", "commit.gpgsign", "false"]);
    }
    fn commit_file(path: &Path, name: &str, content: &str) {
        fs::write(path.join(name), content).unwrap();
        git(path, &["add", "--", name]);
        git(path, &["commit", "-m", name]);
    }
    fn fixture() -> Fixture {
        let root = std::env::temp_dir().join(format!(
            "branchlight delivery café {} {}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let remote = root.join("remote.git");
        let source = root.join("source");
        let client = root.join("client");
        git(
            &root,
            &["init", "--bare", "-b", "main", remote.to_str().unwrap()],
        );
        git(&root, &["init", "-b", "main", source.to_str().unwrap()]);
        identity(&source);
        commit_file(&source, "base.txt", "base\n");
        git(
            &source,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        );
        git(&source, &["push", "-u", "origin", "main"]);
        git(
            &root,
            &["clone", remote.to_str().unwrap(), client.to_str().unwrap()],
        );
        identity(&client);
        Fixture {
            root,
            remote,
            source,
            client,
        }
    }
    fn options() -> CommitOptions {
        CommitOptions {
            summary: "Summary".into(),
            body: "First paragraph\n\nSecond paragraph".into(),
            skip_hooks: false,
            push_after_commit: false,
        }
    }

    #[test]
    fn creates_at_selected_commit_without_checkout_and_sets_explicit_tracking() {
        let f = fixture();
        let base = git(&f.client, &["rev-parse", "HEAD"]);
        commit_file(&f.client, "later.txt", "later\n");
        create_at(&f.client, "at-base", &base, false).unwrap();
        assert_eq!(git(&f.client, &["rev-parse", "at-base"]), base);
        assert_eq!(git(&f.client, &["branch", "--show-current"]), "main");
        create_at(&f.client, "checked", &base, true).unwrap();
        assert_eq!(git(&f.client, &["branch", "--show-current"]), "checked");
        checkout_remote(&f.client, "tracked", "refs/remotes/origin/main").unwrap();
        assert_eq!(
            git(&f.client, &["rev-parse", "--abbrev-ref", "@{upstream}"]),
            "origin/main"
        );
        set_upstream(&f.client, "at-base", "refs/remotes/origin/main").unwrap();
        assert_eq!(
            git(&f.client, &["config", "branch.at-base.merge"]),
            "refs/heads/main"
        );
    }

    #[test]
    fn rejects_invalid_missing_colliding_and_dirty_checkout_without_losing_files() {
        let f = fixture();
        for name in ["--force", "bad name", "HEAD", "main"] {
            assert!(create_at(&f.client, name, "HEAD", false).is_err());
        }
        assert!(create_at(&f.client, "valid", "missing-ref", false).is_err());
        assert!(checkout_remote(&f.client, "valid", "refs/heads/main").is_err());
        assert!(set_upstream(&f.client, "missing", "refs/remotes/origin/main").is_err());
        let base = git(&f.client, &["rev-parse", "HEAD"]);
        commit_file(&f.client, "base.txt", "new base\n");
        fs::write(f.client.join("base.txt"), "precious\n").unwrap();
        assert!(create_at(&f.client, "dirty-check", &base, true).is_err());
        assert_eq!(
            fs::read_to_string(f.client.join("base.txt")).unwrap(),
            "precious\n"
        );
        git(
            &f.client,
            &[
                "worktree",
                "add",
                "-b",
                "occupied",
                f.root.join("linked").to_str().unwrap(),
            ],
        );
        assert!(super::super::switch_branch(&f.client, "occupied").is_err());
    }

    #[test]
    fn fetch_prunes_only_stale_tracking_refs_and_respects_unchecked_choice() {
        let f = fixture();
        git(&f.source, &["push", "origin", "main:stale"]);
        fetch_options(&f.client, "origin", false).unwrap();
        create_at(&f.client, "keep-local", "origin/stale", false).unwrap();
        git(&f.source, &["push", "origin", "--delete", "stale"]);
        git(&f.client, &["config", "fetch.prune", "true"]);
        fetch_options(&f.client, "origin", false).unwrap();
        assert!(!git(&f.client, &["rev-parse", "refs/remotes/origin/stale"]).is_empty());
        fetch_options(&f.client, "origin", true).unwrap();
        assert!(!super::super::get_branches(&f.client)
            .unwrap()
            .remote
            .iter()
            .any(|b| b.name == "origin/stale"));
        assert!(!git(&f.client, &["rev-parse", "keep-local"]).is_empty());
        assert!(fetch_options(&f.client, "--all", true).is_err());
    }

    fn diverge(f: &Fixture, conflict: bool) {
        commit_file(
            &f.source,
            if conflict { "base.txt" } else { "server.txt" },
            "server\n",
        );
        git(&f.source, &["push"]);
        commit_file(
            &f.client,
            if conflict { "base.txt" } else { "client.txt" },
            "client\n",
        );
    }

    #[test]
    fn fast_forward_only_refuses_divergence_without_starting_an_operation() {
        let f = fixture();
        diverge(&f, false);
        let before = git(&f.client, &["rev-parse", "HEAD"]);
        git(&f.client, &["config", "pull.rebase", "true"]);
        assert!(pull_options(&f.client, PullStrategy::FastForwardOnly).is_err());
        assert_eq!(git(&f.client, &["rev-parse", "HEAD"]), before);
        assert_eq!(
            super::super::get_repository_status(&f.client)
                .unwrap()
                .operation,
            crate::models::RepositoryOperation::None
        );
        assert_eq!(git(&f.client, &["config", "pull.rebase"]), "true");
    }

    #[test]
    fn explicit_merge_and_rebase_override_configuration_without_rewriting_it() {
        for strategy in [PullStrategy::Merge, PullStrategy::Rebase] {
            let f = fixture();
            diverge(&f, false);
            git(&f.client, &["config", "pull.ff", "only"]);
            git(&f.client, &["config", "pull.rebase", "false"]);
            pull_options(&f.client, strategy).unwrap();
            let parents = git(&f.client, &["show", "-s", "--format=%P", "HEAD"]);
            assert_eq!(
                parents.split_whitespace().count(),
                if matches!(strategy, PullStrategy::Merge) {
                    2
                } else {
                    1
                }
            );
            assert_eq!(git(&f.client, &["config", "pull.ff"]), "only");
            assert_eq!(git(&f.client, &["config", "pull.rebase"]), "false");
        }
    }

    #[test]
    fn stopped_pull_operations_are_detected_and_can_be_aborted() {
        for strategy in [PullStrategy::Merge, PullStrategy::Rebase] {
            let f = fixture();
            diverge(&f, true);
            let before = git(&f.client, &["rev-parse", "HEAD"]);
            assert!(pull_options(&f.client, strategy).is_err());
            let state = super::super::get_repository_status(&f.client).unwrap();
            assert!(!state.conflicts.is_empty());
            if matches!(strategy, PullStrategy::Merge) {
                assert_eq!(state.operation, crate::models::RepositoryOperation::Merge);
                super::super::abort_merge(&f.client).unwrap();
            } else {
                assert_eq!(state.operation, crate::models::RepositoryOperation::Rebase);
                super::super::abort_rebase(&f.client).unwrap();
            }
            assert_eq!(git(&f.client, &["rev-parse", "HEAD"]), before);
        }
    }

    #[test]
    fn ordinary_push_uses_upstream_even_with_conflicting_push_configuration() {
        let f = fixture();
        git(&f.client, &["config", "push.default", "nothing"]);
        git(
            &f.client,
            &[
                "config",
                "remote.origin.push",
                "refs/heads/main:refs/heads/unwanted",
            ],
        );
        commit_file(&f.client, "client.txt", "client\n");
        push_normal(&f.client).unwrap();
        assert_eq!(
            git(&f.remote, &["rev-parse", "refs/heads/main"]),
            git(&f.client, &["rev-parse", "HEAD"])
        );
        assert!(!git(&f.remote, &["show-ref"]).contains("unwanted"));
    }

    #[test]
    fn reviewed_lease_rejects_remote_advance_even_after_fetch() {
        let f = fixture();
        commit_file(&f.client, "client.txt", "client\n");
        let review = review_push(&f.client).unwrap();
        commit_file(&f.source, "server.txt", "server\n");
        git(&f.source, &["push"]);
        fetch_options(&f.client, "origin", false).unwrap();
        assert!(force_push(&f.client, &review).is_err());
        assert_eq!(
            git(&f.remote, &["rev-parse", "main"]),
            git(&f.source, &["rev-parse", "HEAD"])
        );
        assert!(push_normal(&f.client).is_err());
    }

    #[test]
    fn reviewed_lease_succeeds_and_rejects_changed_local_source_or_destination() {
        let f = fixture();
        commit_file(&f.client, "client.txt", "client\n");
        let review = review_push(&f.client).unwrap();
        force_push(&f.client, &review).unwrap();
        let review = review_push(&f.client).unwrap();
        commit_file(&f.client, "next.txt", "next\n");
        assert!(force_push(&f.client, &review).is_err());
        let review = review_push(&f.client).unwrap();
        git(
            &f.client,
            &[
                "remote",
                "set-url",
                "--push",
                "origin",
                "https://example.invalid/other.git",
            ],
        );
        assert!(force_push(&f.client, &review).is_err());
    }

    #[test]
    fn commit_message_and_identity_survive_push_failure_without_duplicate_commits() {
        let f = fixture();
        fs::write(f.client.join("draft.txt"), "draft\n").unwrap();
        git(&f.client, &["add", "draft.txt"]);
        git(&f.client, &["branch", "--unset-upstream"]);
        let mut options = options();
        options.push_after_commit = true;
        let result = compose_commit(&f.client, &options).unwrap();
        assert!(result.push_error.is_some());
        assert_eq!(git(&f.client, &["rev-list", "--count", "HEAD"]), "2");
        assert_eq!(
            git(&f.client, &["log", "-1", "--format=%B"]),
            "Summary\n\nFirst paragraph\n\nSecond paragraph"
        );
        assert_eq!(
            git(&f.client, &["log", "-1", "--format=%an"]),
            "Delivery Tests"
        );
        let mut invalid_options = options;
        invalid_options.summary = "bad\nsummary".into();
        assert!(compose_commit(&f.client, &invalid_options).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn configured_hooks_run_and_skip_only_bypasses_pre_commit_and_commit_msg() {
        use std::os::unix::fs::PermissionsExt;
        let f = fixture();
        let hooks = f.client.join("custom hooks");
        fs::create_dir(&hooks).unwrap();
        git(
            &f.client,
            &["config", "core.hooksPath", hooks.to_str().unwrap()],
        );
        for name in [
            "pre-commit",
            "commit-msg",
            "prepare-commit-msg",
            "post-commit",
        ] {
            let hook = hooks.join(name);
            fs::write(
                &hook,
                format!(
                    "#!/bin/sh\necho {name} >> hooks.log\n{}\n",
                    if name == "pre-commit" {
                        "echo 'hook rejected' >&2; echo touched > touched.txt; exit 1"
                    } else {
                        "exit 0"
                    }
                ),
            )
            .unwrap();
            fs::set_permissions(hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
        fs::write(f.client.join("draft.txt"), "draft\n").unwrap();
        git(&f.client, &["add", "draft.txt"]);
        assert!(compose_commit(&f.client, &options()).is_err());
        assert!(f.client.join("touched.txt").exists());
        assert_eq!(git(&f.client, &["rev-list", "--count", "HEAD"]), "1");
        fs::write(f.client.join("hooks.log"), "").unwrap();
        let mut options = options();
        options.skip_hooks = true;
        compose_commit(&f.client, &options).unwrap();
        assert_eq!(
            fs::read_to_string(f.client.join("hooks.log")).unwrap(),
            "prepare-commit-msg\npost-commit\n"
        );
        commit_file_without_hooks(&f.client);
        assert!(compose_commit(
            &f.client,
            &CommitOptions {
                skip_hooks: false,
                ..options
            }
        )
        .is_err());
    }

    #[cfg(unix)]
    fn commit_file_without_hooks(path: &Path) {
        fs::write(path.join("next.txt"), "next\n").unwrap();
        git(path, &["add", "next.txt"]);
    }
}
