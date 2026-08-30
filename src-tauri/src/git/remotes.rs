use std::path::Path;

use crate::models::{GitError, GitOutput};

use super::runner::run_git;

/// Fetches updated refs using the repository's configured remotes and credentials.
pub(crate) fn fetch(repository: &Path) -> Result<GitOutput, GitError> {
    run_git(repository, &["fetch"])
}

/// Pulls the current branch while preserving the user's configured pull strategy.
pub(crate) fn pull(repository: &Path) -> Result<GitOutput, GitError> {
    run_git(repository, &["pull"])
}

/// Pushes the current branch using its configured upstream.
pub(crate) fn push(repository: &Path) -> Result<GitOutput, GitError> {
    run_git(repository, &["push"])
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::{Path, PathBuf},
        process::{Command, Output},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    struct RemoteFixture {
        root: PathBuf,
        remote: PathBuf,
        source: PathBuf,
        client: PathBuf,
    }

    impl Drop for RemoteFixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).expect("the remote fixture should be removed");
        }
    }

    /// Runs Git for fixture setup and requires a successful exit.
    fn run(repository: Option<&Path>, arguments: &[&str]) -> Output {
        let mut command = Command::new("git");
        command.args(arguments);
        if let Some(repository) = repository {
            command.current_dir(repository);
        }

        let output = command
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(
            output.status.success(),
            "fixture Git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }

    /// Configures a disposable repository with a deterministic test identity.
    fn configure_identity(repository: &Path) {
        run(
            Some(repository),
            &["config", "user.name", "Branchlight Tests"],
        );
        run(
            Some(repository),
            &["config", "user.email", "branchlight@example.invalid"],
        );
    }

    /// Adds and commits one fixture file.
    fn commit_file(repository: &Path, path: &str, contents: &str, message: &str) {
        fs::write(repository.join(path), contents).expect("the fixture file should be written");
        run(Some(repository), &["add", "--", path]);
        run(Some(repository), &["commit", "-m", message]);
    }

    /// Creates a bare remote plus source and client worktrees tracking `main`.
    fn remote_fixture(label: &str) -> RemoteFixture {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        let root = env::temp_dir().join(format!(
            "branchlight-remotes-{label}-{}-{unique}",
            std::process::id()
        ));
        let remote = root.join("remote.git");
        let source = root.join("source");
        let client = root.join("client");
        fs::create_dir_all(&root).expect("the remote fixture root should be created");

        let remote_path = remote.to_string_lossy().into_owned();
        let source_path = source.to_string_lossy().into_owned();
        let client_path = client.to_string_lossy().into_owned();
        run(None, &["init", "--bare", "-b", "main", &remote_path]);
        run(None, &["init", "-b", "main", &source_path]);
        configure_identity(&source);
        commit_file(&source, "base.txt", "base\n", "Create base");
        run(Some(&source), &["remote", "add", "origin", &remote_path]);
        run(Some(&source), &["push", "-u", "origin", "main"]);
        run(None, &["clone", &remote_path, &client_path]);
        configure_identity(&client);

        RemoteFixture {
            root,
            remote,
            source,
            client,
        }
    }

    /// Reads one revision from a normal or bare fixture repository.
    fn revision(repository: &Path, revision: &str, is_bare: bool) -> String {
        let repository_path = repository.to_string_lossy().into_owned();
        let output = if is_bare {
            run(
                None,
                &["--git-dir", &repository_path, "rev-parse", revision],
            )
        } else {
            run(Some(repository), &["rev-parse", revision])
        };
        String::from_utf8(output.stdout)
            .expect("fixture hashes should be UTF-8")
            .trim()
            .to_owned()
    }

    #[test]
    fn fetches_pulls_and_pushes_with_configured_remote_state() {
        let fixture = remote_fixture("lifecycle");
        commit_file(
            &fixture.source,
            "server.txt",
            "from source\n",
            "Update remote",
        );
        run(Some(&fixture.source), &["push"]);

        fetch(&fixture.client).expect("the client should fetch remote updates");
        assert_eq!(
            revision(&fixture.client, "refs/remotes/origin/main", false),
            revision(&fixture.source, "HEAD", false)
        );

        pull(&fixture.client).expect("the client should pull the remote update");
        assert_eq!(
            fs::read_to_string(fixture.client.join("server.txt"))
                .expect("the pulled file should exist"),
            "from source\n"
        );

        commit_file(
            &fixture.client,
            "client.txt",
            "from client\n",
            "Update client",
        );
        push(&fixture.client).expect("the client should push through its upstream");
        assert_eq!(
            revision(&fixture.remote, "refs/heads/main", true),
            revision(&fixture.client, "HEAD", false)
        );
    }

    #[test]
    fn reports_a_missing_remote_as_a_command_failure() {
        let fixture = remote_fixture("missing-remote");
        run(Some(&fixture.client), &["remote", "remove", "origin"]);

        let error = push(&fixture.client).expect_err("push without a remote should fail");
        assert!(matches!(
            error,
            GitError::CommandFailed { output, .. } if !output.stderr.trim().is_empty()
        ));
    }
}
