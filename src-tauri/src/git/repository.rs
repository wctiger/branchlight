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

#[cfg(test)]
mod tests {
    use std::{
        fs,
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

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
        let repository_root = parent_directory.join(" repository ");
        fs::create_dir_all(&repository_root).expect("the test repository should be created");

        let git_init = Command::new("git")
            .arg("init")
            .arg(&repository_root)
            .output()
            .expect("system Git should be available while building Branchlight");
        assert!(git_init.status.success());

        let repository = open_repository(&repository_root)
            .expect("a repository name containing whitespace should be preserved");

        assert_eq!(repository.name, " repository ");
        assert!(repository.path.ends_with(" repository "));

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
