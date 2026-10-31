use super::{
    inspection::{invalid, resolve},
    runner::run_git,
};
use crate::models::{GitError, GitOutput};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTag {
    pub name: String,
    pub object_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TagDetails {
    pub name: String,
    pub object_id: String,
    pub target_id: String,
    pub target_type: String,
    pub annotated: bool,
    pub metadata: String,
    pub metadata_truncated: bool,
}
fn reference(repository: &Path, name: &str) -> Result<String, GitError> {
    if name.is_empty() || name.starts_with('-') || name.contains('\0') {
        return Err(invalid(
            "Enter a local tag name that does not begin with a dash.",
        ));
    }
    let reference = format!("refs/tags/{name}");
    run_git(repository, &["check-ref-format", &reference])?;
    Ok(reference)
}
pub(crate) fn list(repository: &Path) -> Result<Vec<LocalTag>, GitError> {
    let output = run_git(
        repository,
        &[
            "for-each-ref",
            "--sort=refname",
            "--format=%(refname)%00%(objectname)%00",
            "refs/tags/",
        ],
    )?;
    output
        .stdout
        .lines()
        .map(|line| {
            let fields: Vec<_> = line.split('\0').collect();
            if fields.len() != 3 || !fields[2].is_empty() {
                return Err(invalid("Malformed local tag response."));
            }
            Ok(LocalTag {
                name: fields[0]
                    .strip_prefix("refs/tags/")
                    .ok_or_else(|| invalid("Unexpected tag reference."))?
                    .into(),
                object_id: fields[1].into(),
            })
        })
        .collect()
}
pub(crate) fn inspect(repository: &Path, name: &str) -> Result<TagDetails, GitError> {
    let reference = reference(repository, name)?;
    let oid = run_git(
        repository,
        &["rev-parse", "--verify", "--end-of-options", &reference],
    )?
    .stdout
    .trim()
    .to_owned();
    let object_type = run_git(repository, &["cat-file", "-t", &oid])?
        .stdout
        .trim()
        .to_owned();
    let target_id = run_git(
        repository,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{reference}^{{}}"),
        ],
    )?
    .stdout
    .trim()
    .to_owned();
    let target_type = run_git(repository, &["cat-file", "-t", &target_id])?
        .stdout
        .trim()
        .to_owned();
    let metadata = if matches!(object_type.as_str(), "tag" | "commit") {
        let size = run_git(repository, &["cat-file", "-s", &oid])?
            .stdout
            .trim()
            .parse::<usize>()
            .map_err(|_| invalid("Invalid tag object size."))?;
        if size > 512 * 1024 {
            "Metadata exceeds the 512 KiB preview limit. Inspect this tag using external Git."
                .to_owned()
        } else {
            run_git(repository, &["cat-file", "-p", &oid])?.stdout
        }
    } else {
        String::new()
    };
    let truncated = metadata.starts_with("Metadata exceeds the 512 KiB preview limit.");
    Ok(TagDetails {
        name: name.into(),
        object_id: oid,
        target_id,
        target_type,
        annotated: object_type == "tag",
        metadata,
        metadata_truncated: truncated,
    })
}
/// Explicit unsigned lightweight or annotated creation; never replaces an existing ref.
pub(crate) fn create(
    repository: &Path,
    name: &str,
    revision: &str,
    annotation: Option<&str>,
) -> Result<GitOutput, GitError> {
    reference(repository, name)?;
    let oid = resolve(repository, revision)?;
    let mut args = vec!["tag", "--no-sign"];
    if let Some(message) = annotation {
        if message.trim().is_empty() || message.contains('\0') {
            return Err(invalid("Enter a nonempty tag annotation."));
        }
        args.extend(["--annotate", "--cleanup=verbatim", "--message", message]);
    }
    args.extend(["--", name, &oid]);
    run_git(repository, &args)
}
/// Compare-and-delete the exact reviewed local ref, never a remote tag.
pub(crate) fn delete(
    repository: &Path,
    name: &str,
    expected_oid: &str,
) -> Result<GitOutput, GitError> {
    let reference = reference(repository, name)?;
    if !matches!(expected_oid.len(), 40 | 64)
        || !expected_oid.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid("Review the current tag before deleting it."));
    }
    run_git(
        repository,
        &["update-ref", "--no-deref", "-d", &reference, expected_oid],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        process::Command,
        sync::atomic::{AtomicU64, Ordering},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "branchlight-tags-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            let f = Self(path);
            f.git(&["init", "-b", "main"]);
            f.git(&["config", "user.name", "Tag Tests"]);
            f.git(&["config", "user.email", "tag@example.invalid"]);
            f.git(&["commit", "--allow-empty", "-m", "Base"]);
            f
        }
        fn git(&self, args: &[&str]) -> String {
            let out = Command::new("git")
                .current_dir(&self.0)
                .args(args)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).trim().into()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn creates_and_inspects_lightweight_and_annotated_tags_at_selected_commits() {
        let f = Fixture::new();
        let base = f.git(&["rev-parse", "HEAD"]);
        f.git(&["commit", "--allow-empty", "-m", "Next"]);
        create(&f.0, "release/base", &base, None).unwrap();
        create(
            &f.0,
            "v1",
            "HEAD",
            Some("Release notes\n\nLiteral $(touch injected) and `quotes` 'single'"),
        )
        .unwrap();
        let tags = list(&f.0).unwrap();
        assert_eq!(tags.len(), 2);
        let simple = inspect(&f.0, "release/base").unwrap();
        assert!(!simple.annotated);
        assert_eq!(simple.target_id, base);
        assert_eq!(simple.target_type, "commit");
        let annotated = inspect(&f.0, "v1").unwrap();
        assert!(annotated.annotated);
        assert!(annotated.metadata.contains("Release notes"));
        assert!(annotated.metadata.contains("tagger Tag Tests"));
        assert_ne!(annotated.object_id, annotated.target_id);
        assert!(!f.0.join("injected").exists());
        let history = super::super::get_history(&f.0).unwrap();
        assert!(history
            .iter()
            .find(|c| c.hash == base)
            .unwrap()
            .refs
            .contains(&"tag: release/base".to_owned()));
        assert!(history
            .iter()
            .find(|c| c.hash == annotated.target_id)
            .unwrap()
            .refs
            .contains(&"tag: v1".to_owned()));
    }
    #[test]
    fn rejects_existing_names_invalid_names_and_stale_deletions() {
        let f = Fixture::new();
        assert!(list(&f.0).unwrap().is_empty());
        create(&f.0, "v1", "HEAD", None).unwrap();
        let old = inspect(&f.0, "v1").unwrap();
        assert!(create(&f.0, "v1", "HEAD", Some("No overwrite")).is_err());
        for name in ["", "--delete", "bad name", "../traversal", "name.lock"] {
            assert!(create(&f.0, name, "HEAD", None).is_err());
        }
        assert!(create(&f.0, "empty-message", "HEAD", Some(" ")).is_err());
        f.git(&["commit", "--allow-empty", "-m", "Moved"]);
        f.git(&["tag", "--force", "v1"]);
        assert!(delete(&f.0, "v1", &old.object_id).is_err());
        let current = inspect(&f.0, "v1").unwrap();
        delete(&f.0, "v1", &current.object_id).unwrap();
        assert!(list(&f.0).unwrap().is_empty());
        assert_eq!(f.git(&["log", "-1", "--format=%s"]), "Moved");
    }
}
