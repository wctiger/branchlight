use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryStatus {
    pub(crate) operation: RepositoryOperation,
    pub(crate) branch: BranchStatus,
    pub(crate) staged: Vec<FileChange>,
    pub(crate) unstaged: Vec<FileChange>,
    pub(crate) conflicts: Vec<FileChange>,
    pub(crate) stash_count: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RepositoryOperation {
    None,
    Merge,
    Rebase,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchStatus {
    pub(crate) name: Option<String>,
    pub(crate) oid: Option<String>,
    pub(crate) is_detached: bool,
    pub(crate) upstream: Option<String>,
    pub(crate) ahead: Option<u32>,
    pub(crate) behind: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileChange {
    pub(crate) path: String,
    pub(crate) original_path: Option<String>,
    pub(crate) status: FileStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}
