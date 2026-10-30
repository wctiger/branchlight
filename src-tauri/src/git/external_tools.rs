use super::{
    inspection::{invalid, validate_path},
    runner::{run_git, run_git_with_env},
};
use crate::models::GitError;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ExternalTool {
    Editor,
    Terminal,
    FileManager,
    Diff,
    Merge,
}
#[derive(Clone, Deserialize)]
pub(crate) struct ToolConfig {
    pub executable: String,
    pub args: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolRequest {
    pub tool: ExternalTool,
    pub file_path: Option<String>,
    pub staged: bool,
    pub config: Option<ToolConfig>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolLaunch {
    pub job_id: Option<u64>,
    pub message: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LauncherStatus {
    pub running: bool,
    pub exit_code: Option<i32>,
}
struct Job {
    child: Option<Child>,
    exit_code: Option<i32>,
}
static JOBS: OnceLock<Mutex<BTreeMap<u64, Job>>> = OnceLock::new();
static NEXT_JOB: AtomicU64 = AtomicU64::new(1);
fn jobs() -> &'static Mutex<BTreeMap<u64, Job>> {
    JOBS.get_or_init(Default::default)
}
fn refresh(job: &mut Job) -> Result<(), GitError> {
    if let Some(child) = &mut job.child {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| invalid(&format!("Unable to read launcher status: {e}")))?
        {
            job.exit_code = status.code();
            job.child = None;
        }
    }
    Ok(())
}
pub(crate) fn status(id: u64) -> Result<LauncherStatus, GitError> {
    let mut jobs = jobs()
        .lock()
        .map_err(|_| invalid("Launcher registry unavailable."))?;
    let job = jobs.get_mut(&id).ok_or_else(|| invalid("Launcher status is no longer retained. The external application may still be open; refresh repository status after external changes."))?;
    refresh(job)?;
    Ok(LauncherStatus {
        running: job.child.is_some(),
        exit_code: job.exit_code,
    })
}
fn root(repository: &Path) -> Result<PathBuf, GitError> {
    repository
        .canonicalize()
        .map_err(|e| invalid(&format!("Repository is unavailable: {e}")))
}
fn argument_path(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    {
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(drive) = text.strip_prefix(r"\\?\") {
            return drive.to_owned();
        }
    }
    text
}
fn target(repository: &Path, file: Option<&str>) -> Result<PathBuf, GitError> {
    let root = root(repository)?;
    let Some(file) = file else {
        return Ok(root);
    };
    validate_path(file)?;
    let path = root
        .join(file)
        .canonicalize()
        .map_err(|e| invalid(&format!("Selected path is unavailable: {e}")))?;
    if !path.starts_with(&root) {
        return Err(invalid("Selected file resolves outside this repository. Choose a path in the current worktree."));
    }
    Ok(path)
}
/// Expand placeholders as argv values, never as shell source.
fn configured(
    config: &ToolConfig,
    repository: &Path,
    file: Option<&str>,
    tool: &ExternalTool,
) -> Result<(String, Vec<String>), GitError> {
    if config.executable.trim().is_empty()
        || config.executable.contains('\0')
        || config.args.len() > 64
        || config
            .args
            .iter()
            .any(|s| s.contains('\0') || s.len() > 4096)
    {
        return Err(invalid(
            "Configure an installed executable and up to 64 structured arguments.",
        ));
    }
    let repository = root(repository)?;
    let target = target(&repository, file)?;
    let mut used_context = false;
    let mut args = Vec::new();
    for arg in &config.args {
        if arg.contains("{file}") && file.is_none() {
            return Err(invalid("This tool configuration requires a selected file."));
        }
        used_context |= ["{repository}", "{target}", "{file}"]
            .iter()
            .any(|token| arg.contains(token));
        args.push(
            arg.replace("{repository}", &argument_path(&repository))
                .replace("{target}", &argument_path(&target))
                .replace("{file}", &argument_path(&target)),
        );
    }
    if !used_context {
        args.push(argument_path(if matches!(tool, ExternalTool::Terminal) {
            &repository
        } else {
            &target
        }));
    }
    Ok((config.executable.clone(), args))
}
fn default_command(
    repository: &Path,
    file: Option<&str>,
    tool: &ExternalTool,
) -> Result<(String, Vec<String>), GitError> {
    let target = target(repository, file)?;
    #[cfg(target_os = "macos")]
    {
        match tool {
            ExternalTool::Terminal => Ok((
                "/usr/bin/open".into(),
                vec![
                    "-a".into(),
                    "Terminal".into(),
                    argument_path(&root(repository)?),
                ],
            )),
            ExternalTool::FileManager => Ok((
                "/usr/bin/open".into(),
                if file.is_some() {
                    vec!["-R".into(), argument_path(&target)]
                } else {
                    vec![argument_path(&target)]
                },
            )),
            _ => Err(invalid(
                "Configure an editor executable before launching it.",
            )),
        }
    }
    #[cfg(target_os = "windows")]
    {
        match tool {
            ExternalTool::Terminal => Ok((
                "wt.exe".into(),
                vec!["-d".into(), argument_path(&root(repository)?)],
            )),
            ExternalTool::FileManager => Ok((
                "explorer.exe".into(),
                vec![if file.is_some() {
                    format!("/select,{}", argument_path(&target))
                } else {
                    argument_path(&target)
                }],
            )),
            _ => Err(invalid(
                "Configure an editor executable before launching it.",
            )),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = target;
        let _ = tool;
        Err(invalid(
            "Configure an external editor or terminal executable on this platform.",
        ))
    }
}
pub(crate) fn launch(repository: &Path, request: ToolRequest) -> Result<ToolLaunch, GitError> {
    if matches!(request.tool, ExternalTool::Diff | ExternalTool::Merge) {
        let file = request
            .file_path
            .as_deref()
            .ok_or_else(|| invalid("Select a file before opening a diff or merge tool."))?;
        validate_path(file)?;
        let merging = matches!(request.tool, ExternalTool::Merge);
        let setting = if merging { "merge.tool" } else { "diff.tool" };
        if run_git(repository, &["config", "--get", setting])
            .map_or(true, |out| out.stdout.trim().is_empty())
        {
            return Err(invalid(&format!("Configure {setting} and its installed tool using local Git configuration before launching. Branchlight uses your existing Git tool settings.")));
        }
        let literal = format!(":(literal){file}");
        if merging
            && run_git(
                repository,
                &["ls-files", "--unmerged", "-z", "--", &literal],
            )?
            .stdout
            .is_empty()
        {
            return Err(invalid(
                "The selected file is no longer conflicted. Refresh status.",
            ));
        }
        let mut args = vec![
            if merging { "mergetool" } else { "difftool" },
            "--no-prompt",
        ];
        if request.staged && !merging {
            args.push("--cached");
        }
        // mergetool treats pathspecs as worktree names internally; -- protects options.
        args.extend(["--", if merging { file } else { &literal }]);
        if merging {
            run_git_with_env(repository, &args, &[("GIT_LITERAL_PATHSPECS", "1")])?;
        } else {
            run_git(repository, &args)?;
        }
        return Ok(ToolLaunch {
            job_id: None,
            message: "Git tool completed. Review the refreshed repository status.".into(),
        });
    }
    let (program, args) = match request.config {
        Some(config) => configured(
            &config,
            repository,
            request.file_path.as_deref(),
            &request.tool,
        )?,
        None => default_command(repository, request.file_path.as_deref(), &request.tool)?,
    };
    let mut registry = jobs()
        .lock()
        .map_err(|_| invalid("Launcher registry unavailable."))?;
    if registry.len() >= 64 {
        for job in registry.values_mut() {
            refresh(job)?;
        }
        if let Some(id) = registry
            .iter()
            .find_map(|(id, job)| job.child.is_none().then_some(*id))
        {
            registry.remove(&id);
        } else {
            return Err(invalid(
                "64 external launchers are still running. Close one before opening another.",
            ));
        }
    }
    let child = Command::new(&program).args(&args).current_dir(repository).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| invalid(&format!("Unable to launch '{program}': {e}. Configure an installed executable or absolute path.")))?;
    let id = NEXT_JOB.fetch_add(1, Ordering::Relaxed);
    registry.insert(
        id,
        Job {
            child: Some(child),
            exit_code: None,
        },
    );
    Ok(ToolLaunch {job_id: Some(id), message: "External launcher started. Check its status and explicitly refresh repository state after external edits; launcher completion does not mean the application has closed.".into()})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs, thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    struct Fixture(PathBuf);
    impl Fixture {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "branchlight-external-{label} {}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&path).unwrap();
            let f = Self(path);
            f.git(&["init", "-b", "main"]);
            f.git(&["config", "user.name", "Tool Tests"]);
            f.git(&["config", "user.email", "tools@example.invalid"]);
            fs::write(f.0.join("file with [x].txt"), "base\n").unwrap();
            f.git(&["add", "."]);
            f.git(&["commit", "-m", "Base"]);
            f
        }
        fn git(&self, args: &[&str]) {
            assert!(Command::new("git")
                .args(args)
                .current_dir(&self.0)
                .output()
                .unwrap()
                .status
                .success());
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn launcher_arguments_use_shell_compatible_windows_paths() {
        assert_eq!(
            argument_path(Path::new(r"\\?\C:\repo with spaces")),
            r"C:\repo with spaces"
        );
        assert_eq!(
            argument_path(Path::new(r"\\?\UNC\server\share\repo")),
            r"\\server\share\repo"
        );
    }
    #[test]
    fn argv_keeps_spaces_and_shell_metacharacters_literal_and_rejects_escape() {
        let f = Fixture::new("argv");
        let config = ToolConfig {
            executable: "editor".into(),
            args: vec![
                "--wait".into(),
                "{target}".into(),
                "$(touch injected) `ticks` 'quote'".into(),
            ],
        };
        let (program, args) = configured(
            &config,
            &f.0,
            Some("file with [x].txt"),
            &ExternalTool::Editor,
        )
        .unwrap();
        assert_eq!(program, "editor");
        assert_eq!(
            args[1],
            argument_path(&f.0.join("file with [x].txt").canonicalize().unwrap())
        );
        assert_eq!(args[2], "$(touch injected) `ticks` 'quote'");
        assert!(configured(&config, &f.0, Some("../outside"), &ExternalTool::Editor).is_err());
        assert!(!f.0.join("injected").exists());
    }
    #[test]
    fn launcher_reports_completion_and_missing_executables() {
        let f = Fixture::new("launch");
        let request = ToolRequest {
            tool: ExternalTool::Editor,
            file_path: None,
            staged: false,
            config: Some(ToolConfig {
                executable: "git".into(),
                args: vec!["-C".into(), "{repository}".into(), "--version".into()],
            }),
        };
        let id = launch(&f.0, request).unwrap().job_id.unwrap();
        let mut result = status(id).unwrap();
        for _ in 0..200 {
            if !result.running {
                break;
            }
            thread::sleep(Duration::from_millis(5));
            result = status(id).unwrap();
        }
        assert!(!result.running);
        assert_eq!(result.exit_code, Some(0));
        assert!(launch(
            &f.0,
            ToolRequest {
                tool: ExternalTool::Editor,
                file_path: None,
                staged: false,
                config: Some(ToolConfig {
                    executable: "branchlight-no-such-installed-tool".into(),
                    args: vec![]
                })
            }
        )
        .is_err());
    }
    #[test]
    fn missing_git_tool_configuration_and_nonconflicted_merge_targets_are_explicit() {
        let f = Fixture::new("missing");
        f.git(&["config", "diff.tool", ""]);
        assert!(launch(
            &f.0,
            ToolRequest {
                tool: ExternalTool::Diff,
                file_path: Some("file with [x].txt".into()),
                staged: false,
                config: None
            }
        )
        .is_err());
        f.git(&["config", "merge.tool", "branchlight-test"]);
        assert!(launch(
            &f.0,
            ToolRequest {
                tool: ExternalTool::Merge,
                file_path: Some("file with [x].txt".into()),
                staged: false,
                config: None
            }
        )
        .is_err());
    }
    #[cfg(unix)]
    #[test]
    fn git_merge_tool_receives_a_literal_path_and_stages_its_output() {
        let f = Fixture::new("merge");
        f.git(&["config", "mergetool.guiDefault", "false"]);
        f.git(&["switch", "-c", "incoming"]);
        fs::write(f.0.join("file with [x].txt"), "incoming\n").unwrap();
        f.git(&["commit", "-am", "Incoming"]);
        f.git(&["switch", "main"]);
        fs::write(f.0.join("file with [x].txt"), "current\n").unwrap();
        f.git(&["commit", "-am", "Current"]);
        assert!(!Command::new("git")
            .args(["merge", "incoming"])
            .current_dir(&f.0)
            .output()
            .unwrap()
            .status
            .success());
        f.git(&["config", "merge.tool", "branchlight-test"]);
        f.git(&[
            "config",
            "mergetool.branchlight-test.cmd",
            "printf 'resolved\\n' > \"$MERGED\"",
        ]);
        f.git(&["config", "mergetool.branchlight-test.trustExitCode", "true"]);
        f.git(&["config", "mergetool.keepBackup", "false"]);
        launch(
            &f.0,
            ToolRequest {
                tool: ExternalTool::Merge,
                file_path: Some("file with [x].txt".into()),
                staged: false,
                config: None,
            },
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(f.0.join("file with [x].txt")).unwrap(),
            "resolved\n"
        );
        assert!(run_git(&f.0, &["ls-files", "--unmerged"])
            .unwrap()
            .stdout
            .is_empty());
    }
}
