use std::{env, path::Path};

use crate::models::{GitError, Repository};

use super::runner::run_git;

pub(crate) fn open_repository(selected_path: &Path) -> Result<Repository, GitError> {
    if selected_path.as_os_str().is_empty() {
        return Err(GitError::InvalidRepositoryPath {
            message: "Choose a folder to open as a Git repository.".to_owned(),
        });
    }

    let working_directory =
        env::current_dir().map_err(|error| GitError::WorkingDirectoryUnavailable {
            message: format!("Unable to determine a working directory for system Git: {error}"),
        })?;
    let selected_path = selected_path.to_string_lossy();
    let output = match run_git(
        &working_directory,
        &["-C", selected_path.as_ref(), "rev-parse", "--show-toplevel"],
    ) {
        Ok(output) => output,
        Err(GitError::CommandFailed { output, .. }) => {
            return Err(GitError::RepositoryUnavailable {
                message: format!(
                    "‘{selected_path}’ is not an accessible Git repository. Choose a folder inside an existing repository."
                ),
                output,
            });
        }
        Err(error) => return Err(error),
    };

    let repository_path = output.stdout.strip_suffix('\n').unwrap_or(&output.stdout);
    if repository_path.is_empty() {
        return Err(GitError::InvalidRepositoryResponse {
            message: "System Git did not return a repository root for the selected folder."
                .to_owned(),
            output,
        });
    }

    let repository_root = Path::new(repository_path);
    let name = repository_root
        .file_name()
        .filter(|name| !name.is_empty())
        .unwrap_or(repository_root.as_os_str())
        .to_string_lossy()
        .into_owned();

    Ok(Repository {
        name,
        path: repository_path.to_owned(),
    })
}

/// Atomically reserves a new destination; failures retain partial data for inspection.
pub(crate) fn create_repository(
    destination: &Path,
    source: Option<&str>,
) -> Result<Repository, GitError> {
    if !destination.is_absolute() || destination.file_name().is_none() {
        return Err(super::inspection::invalid(
            "Choose an absolute, new destination directory.",
        ));
    }
    if let Some(source) = source {
        validate_clone_source(source)?;
    }
    std::fs::create_dir(destination).map_err(|error| super::inspection::invalid(&format!(
        "Cannot reserve destination '{}': {error}. Choose a new directory inside an existing parent; existing data is never overwritten.", destination.display()
    )))?;
    let result = match source {
        Some(source) => run_git(destination, &["clone", "--", source, "."]),
        None => run_git(destination, &["init"]),
    };
    result.map_err(|error| {
        let message = format!("Git could not complete creation. Inspect the retained destination '{}' before retrying or deleting it. {error}", destination.display());
        match error {
            GitError::CommandFailed { output, .. } => GitError::CommandFailed { message, output },
            _ => super::inspection::invalid(&message),
        }
    })?;
    open_repository(destination)
}

fn validate_clone_source(source: &str) -> Result<(), GitError> {
    if source.trim().is_empty() || source.starts_with('-') || source.contains('\0') {
        return Err(super::inspection::invalid(
            "Enter a repository URL or absolute local source path.",
        ));
    }
    if let Some((scheme, rest)) = source.split_once("://") {
        let authority = rest.split('/').next().unwrap_or("");
        if let Some((user, _host)) = authority.rsplit_once('@') {
            // An SSH login name selects the local SSH identity/configuration;
            // it is not an embedded password. Leave authentication to system Git.
            let ssh_login = scheme == "ssh" && !user.is_empty() && !user.contains([':', '@']);
            if !ssh_login {
                return Err(super::inspection::invalid(
                    "Use your Git credential helper or SSH configuration rather than credentials embedded in the URL.",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    #[test]
    fn accepts_ssh_login_names_without_accepting_embedded_passwords() {
        for source in [
            "ssh://git@example.invalid/team/repository.git",
            "ssh://developer@[::1]:2222/repository.git",
            "git@example.invalid:team/repository.git",
            "https://example.invalid/team/repository.git",
        ] {
            validate_clone_source(source).unwrap();
        }
        for source in [
            "ssh://git:password@example.invalid/repository.git",
            "https://user:password@example.invalid/repository.git",
            "https://token@example.invalid/repository.git",
            "ssh://@example.invalid/repository.git",
            "--upload-pack=untrusted",
            " ",
            "bad\0source",
        ] {
            assert!(validate_clone_source(source).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn clones_through_configured_ssh_without_provider_accounts() {
        use std::os::unix::fs::PermissionsExt;

        const FIXTURE: &str = "BRANCHLIGHT_SSH_CLONE_FIXTURE";
        if let Some(root) = env::var_os(FIXTURE) {
            let root = std::path::PathBuf::from(root);
            let destination = root.join("destination");
            create_repository(
                &destination,
                Some("ssh://git@fixture.invalid/test-repository"),
            )
            .unwrap();
            assert_eq!(
                fs::read_to_string(destination.join("content.txt")).unwrap(),
                "configured SSH transport\n"
            );
            return;
        }

        let root = temporary_directory("configured-ssh");
        fs::create_dir(&root).unwrap();
        let source = root.join("source");
        create_repository(&source, None).unwrap();
        fs::write(source.join("content.txt"), "configured SSH transport\n").unwrap();
        for args in [
            vec!["add", "-A"],
            vec![
                "-c",
                "user.name=SSH Fixture",
                "-c",
                "user.email=ssh@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-m",
                "Source",
            ],
        ] {
            assert!(Command::new("git")
                .current_dir(&source)
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        let ssh = root.join("ssh-fixture.sh");
        // The fake SSH transport only serves this disposable local repository.
        // It exercises Git's configured command without network or credentials.
        let quote = |path: &Path| format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"));
        fs::write(
            &ssh,
            format!(
                "#!/bin/sh\n: > {}\nexec git-upload-pack {}\n",
                quote(&root.join("ssh-invoked")),
                quote(&source)
            ),
        )
        .unwrap();
        fs::set_permissions(&ssh, fs::Permissions::from_mode(0o700)).unwrap();
        let config = root.join("gitconfig");
        assert!(Command::new("git")
            .args(["config", "--file"])
            .arg(&config)
            .args(["core.sshCommand", &quote(&ssh)])
            .output()
            .unwrap()
            .status
            .success());
        // Isolate Git configuration in a child test process instead of changing
        // environment variables used by concurrently running repository tests.
        let output = Command::new(env::current_exe().unwrap())
            .args([
                "--exact",
                "git::repository::tests::clones_through_configured_ssh_without_provider_accounts",
                "--nocapture",
            ])
            .env(FIXTURE, &root)
            .env("GIT_CONFIG_GLOBAL", &config)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_SSH_VARIANT", "ssh")
            .output()
            .unwrap();
        let invoked = root.join("ssh-invoked").exists();
        fs::remove_dir_all(&root).unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            invoked,
            "system Git must invoke the configured SSH transport"
        );
    }

    fn temporary_directory(label: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the system clock should be after the Unix epoch")
            .as_nanos();
        env::temp_dir().join(format!(
            "branchlight-{label}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn resolves_a_nested_selection_to_the_repository_root() {
        let repository_root = temporary_directory("repository");
        let nested_directory = repository_root.join("src").join("nested");
        fs::create_dir_all(&nested_directory).expect("the test directories should be created");

        let git_init = Command::new("git")
            .arg("init")
            .arg(&repository_root)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(git_init.status.success());

        let repository = open_repository(&nested_directory)
            .expect("a folder inside a Git repository should open");

        assert_eq!(
            repository.name,
            repository_root.file_name().unwrap().to_string_lossy()
        );
        assert_eq!(
            fs::canonicalize(repository.path).expect("the returned root should exist"),
            fs::canonicalize(&repository_root).expect("the test repository should exist")
        );

        fs::remove_dir_all(repository_root).expect("the test repository should be removed");
    }

    #[test]
    fn preserves_whitespace_in_the_repository_name() {
        let parent_directory = temporary_directory("whitespace-parent");
        // Windows directory names cannot end with a space through ordinary APIs.
        let repository_name = if cfg!(windows) {
            " repository with spaces"
        } else {
            " repository "
        };
        let repository_root = parent_directory.join(repository_name);
        fs::create_dir_all(&repository_root).expect("the test repository should be created");

        let git_init = Command::new("git")
            .arg("init")
            .arg(&repository_root)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(git_init.status.success());

        let repository = open_repository(&repository_root)
            .expect("a repository name containing whitespace should be preserved");

        assert_eq!(repository.name, repository_name);
        assert!(repository.path.ends_with(repository_name));

        fs::remove_dir_all(parent_directory).expect("the test directory should be removed");
    }

    #[test]
    fn rejects_a_folder_outside_a_git_repository() {
        let selected_path = temporary_directory("non-repository");
        fs::create_dir_all(&selected_path).expect("the test directory should be created");

        let error = open_repository(&selected_path)
            .expect_err("a folder outside a Git repository should be rejected");

        assert!(matches!(
            error,
            GitError::RepositoryUnavailable { output, .. }
                if output.exit_code.is_some_and(|code| code != 0)
        ));

        fs::remove_dir_all(selected_path).expect("the test directory should be removed");
    }

    #[test]
    fn rejects_an_empty_selection() {
        let error = open_repository(Path::new(""))
            .expect_err("an empty repository path should be rejected");

        assert!(matches!(error, GitError::InvalidRepositoryPath { .. }));
    }
}
