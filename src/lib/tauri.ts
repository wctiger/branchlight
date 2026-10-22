import type {
  CommitOptions,
  CommitResult,
  PullStrategy,
  PushReview,
} from "../types/delivery";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { GitError, GitErrorCode, GitOutput } from "../types/git";
import type { Branches } from "../types/branch";
import type { Repository } from "../types/repository";
import type { RepositoryStatus } from "../types/status";
import type { Stash } from "../types/stash";
import type { Commit } from "../types/history";

const gitErrorCodes: GitErrorCode[] = [
  "workingDirectoryUnavailable",
  "processStartFailed",
  "commandFailed",
  "invalidRepositoryPath",
  "repositoryUnavailable",
  "invalidRepositoryResponse",
  "invalidStatusResponse",
  "invalidBranchesResponse",
  "invalidStashesResponse",
  "invalidHistoryResponse",
  "invalidOperationInput",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGitErrorCode(value: unknown): value is GitErrorCode {
  return (
    typeof value === "string" &&
    gitErrorCodes.some((errorCode) => errorCode === value)
  );
}

function isGitOutput(value: unknown): value is GitOutput {
  return (
    isRecord(value) &&
    typeof value.stdout === "string" &&
    typeof value.stderr === "string" &&
    (typeof value.exitCode === "number" || value.exitCode === null)
  );
}

export function getGitVersion(): Promise<GitOutput> {
  return invoke<GitOutput>("get_git_version");
}

export async function chooseRepositoryFolder(): Promise<string | null> {
  const selectedPath = await open({
    title: "Open a Git Repository",
    directory: true,
    multiple: false,
    canCreateDirectories: false,
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export function openRepository(path: string): Promise<Repository> {
  return invoke<Repository>("open_repository", { path });
}

/** Requests a fresh, fully parsed status snapshot from system Git. */
export function getRepositoryStatus(path: string): Promise<RepositoryStatus> {
  return invoke<RepositoryStatus>("get_repository_status", { path });
}

/** Requests a fresh snapshot of local and remote branch refs. */
export function getBranches(path: string): Promise<Branches> {
  return invoke<Branches>("get_branches", { path });
}

/** Switches the worktree to an existing local branch. */
export function switchBranch(
  path: string,
  branchName: string,
): Promise<GitOutput> {
  return invoke<GitOutput>("switch_branch", { path, branchName });
}

/** Creates a local branch at HEAD and switches to it. */
export function createBranch(
  path: string,
  branchName: string,
): Promise<GitOutput> {
  return invoke<GitOutput>("create_branch", { path, branchName });
}

/** Renames an existing local branch. */
export function renameBranch(
  path: string,
  oldName: string,
  newName: string,
): Promise<GitOutput> {
  return invoke<GitOutput>("rename_branch", { path, oldName, newName });
}

/** Deletes a fully merged, non-current local branch. */
export function deleteBranch(
  path: string,
  branchName: string,
): Promise<GitOutput> {
  return invoke<GitOutput>("delete_branch", { path, branchName });
}

/** Merges one local source branch into the current branch. */
export function mergeBranch(
  path: string,
  sourceBranch: string,
): Promise<GitOutput> {
  return invoke<GitOutput>("merge_branch", { path, sourceBranch });
}

/** Rebases the current branch onto one local source branch. */
export function rebaseOntoBranch(
  path: string,
  sourceBranch: string,
): Promise<GitOutput> {
  return invoke<GitOutput>("rebase_onto_branch", { path, sourceBranch });
}

/** Aborts the active merge after the backend verifies Git operation state. */
export function abortMerge(path: string): Promise<GitOutput> {
  return invoke<GitOutput>("abort_merge", { path });
}

/** Aborts the active rebase after the backend verifies Git operation state. */
export function abortRebase(path: string): Promise<GitOutput> {
  return invoke<GitOutput>("abort_rebase", { path });
}

/** Fetches remote refs using the repository's configured Git remotes. */
export function fetchRemote(
  path: string,
  remote?: string,
  prune = false,
): Promise<GitOutput> {
  return invoke<GitOutput>("fetch_remote", { path, remote, prune });
}

/** Pulls the current branch using the user's configured pull strategy. */
export function pullRemote(
  path: string,
  strategy?: PullStrategy,
): Promise<GitOutput> {
  return invoke<GitOutput>("pull_remote", { path, strategy });
}

/** Pushes the current branch to its configured upstream. */
export function pushRemote(path: string): Promise<GitOutput> {
  return invoke<GitOutput>("push_remote", { path });
}

/** Lists current stash entries using typed machine-readable fields. */
export function getStashes(path: string): Promise<Stash[]> {
  return invoke<Stash[]>("get_stashes", { path });
}

/** Returns the latest topologically ordered commits reachable from all refs. */
export function getHistory(path: string): Promise<Commit[]> {
  return invoke<Commit[]>("get_history", { path });
}

/** Creates a stash with an optional message. */
export function createStash(path: string, message: string): Promise<GitOutput> {
  return invoke<GitOutput>("create_stash", { path, message });
}

/** Applies one stash without removing it. */
export function applyStash(path: string, stash: Stash): Promise<GitOutput> {
  return invoke<GitOutput>("apply_stash", { path, stash });
}

/** Applies and removes one stash when Git succeeds. */
export function popStash(path: string, stash: Stash): Promise<GitOutput> {
  return invoke<GitOutput>("pop_stash", { path, stash });
}

/** Permanently removes one selected stash entry. */
export function dropStash(path: string, stash: Stash): Promise<GitOutput> {
  return invoke<GitOutput>("drop_stash", { path, stash });
}

/** Stages all changes for one repository-relative path. */
export function stageFile(path: string, filePath: string): Promise<GitOutput> {
  return invoke<GitOutput>("stage_file", { path, filePath });
}

/** Removes all staged changes for one repository-relative path. */
export function unstageFile(
  path: string,
  filePath: string,
): Promise<GitOutput> {
  return invoke<GitOutput>("unstage_file", { path, filePath });
}

/** Creates a commit using the repository's configured Git identity. */
export function commitChanges(
  path: string,
  message: string,
): Promise<GitOutput> {
  return invoke<GitOutput>("commit", { path, message });
}

export function normalizeGitError(error: unknown): GitError {
  if (typeof error === "string") {
    return { code: "unknown", message: error };
  }

  if (!isRecord(error)) {
    return {
      code: "unknown",
      message: "Branchlight could not read the response from system Git.",
    };
  }

  const code = isGitErrorCode(error.code) ? error.code : "unknown";
  const message =
    typeof error.message === "string"
      ? error.message
      : "Branchlight could not read the response from system Git.";
  const output = isGitOutput(error.output) ? error.output : undefined;

  return output ? { code, message, output } : { code, message };
}

export interface ChangedPath {
  path: string;
  originalPath: string | null;
  status: string;
}
export interface Comparison {
  base: string;
  target: string;
  files: ChangedPath[];
}
export interface TextDiff {
  context: string;
  text: string;
  truncated: boolean;
  binary: boolean;
}
export interface FileCommit {
  hash: string;
  author: string;
  timestamp: string;
  subject: string;
}
export function createRepository(
  destination: string,
  source: string | null,
): Promise<Repository> {
  return invoke("create_repository", { destination, source });
}
export function compareRevisions(
  path: string,
  base: string,
  target: string,
): Promise<Comparison> {
  return invoke("compare_revisions", { path, base, target });
}
export function getTextDiff(
  path: string,
  kind: string,
  filePath: string,
  base = "",
  target = "",
): Promise<TextDiff> {
  return invoke("get_text_diff", { path, kind, filePath, base, target });
}
export function getFileHistory(
  path: string,
  filePath: string,
  revision: string,
): Promise<FileCommit[]> {
  return invoke("get_file_history", { path, filePath, revision });
}
export function getFileBlame(
  path: string,
  filePath: string,
  revision: string,
): Promise<TextDiff> {
  return invoke("get_file_blame", { path, filePath, revision });
}
export function discardFile(
  path: string,
  filePath: string,
  expected: "tracked" | "untracked",
): Promise<GitOutput> {
  return invoke("discard_file", { path, filePath, expected });
}

export function getRemotes(path: string): Promise<string[]> {
  return invoke("get_remotes", { path });
}
export function createBranchAt(
  path: string,
  branchName: string,
  revision: string,
  checkout: boolean,
): Promise<GitOutput> {
  return invoke("create_branch_at", { path, branchName, revision, checkout });
}
export function checkoutRemoteBranch(
  path: string,
  branchName: string,
  reference: string,
): Promise<GitOutput> {
  return invoke("checkout_remote_branch", { path, branchName, reference });
}
export function setBranchUpstream(
  path: string,
  branchName: string,
  reference: string,
): Promise<GitOutput> {
  return invoke("set_branch_upstream", { path, branchName, reference });
}
export function reviewPush(path: string): Promise<PushReview> {
  return invoke("review_push", { path });
}
export function forcePush(
  path: string,
  review: PushReview,
): Promise<GitOutput> {
  return invoke("force_push", { path, review });
}
export function composeCommit(
  path: string,
  options: CommitOptions,
): Promise<CommitResult> {
  return invoke("compose_commit", { path, options });
}
