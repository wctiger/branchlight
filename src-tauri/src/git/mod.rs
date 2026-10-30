mod branches;
mod conflicts;
pub(crate) mod diagnostics;
pub(crate) mod external_tools;
pub(crate) mod history;
pub(crate) mod history_operations;
pub(crate) mod lfs;
mod operations;
pub(crate) mod rebase_plan;
mod remotes;
mod repository;
pub(crate) mod resolution;
mod runner;
mod stashes;
mod status;
pub(crate) mod submodules;
pub(crate) mod tags;
mod version;

pub(crate) use branches::{
    create_branch, delete_branch, get_branches, merge_branch, rebase_onto_branch, rename_branch,
    switch_branch,
};
pub(crate) use conflicts::{abort_merge, abort_rebase, recover_rebase, RebaseRecovery};
pub(crate) use history::get_history;
pub(crate) use operations::{commit, stage_file, unstage_file};
pub(crate) use remotes::{fetch, pull, push};
pub(crate) use repository::{create_repository, open_repository};
pub(crate) use stashes::{apply_stash, create_stash, drop_stash, get_stashes, pop_stash};
pub(crate) use status::get_repository_status;
pub(crate) use version::get_git_version;

pub(crate) use runner::repository_lock_identities;

pub(crate) mod inspection;

pub(crate) mod delivery;

/// Timestamp resolution differs across runners; test fixtures also need a
/// per-process unique suffix when they are constructed concurrently.
#[cfg(test)]
pub(crate) fn fixture_nonce() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}
