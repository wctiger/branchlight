import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import "./App.css";
import {
  abortMerge,
  abortRebase,
  applyStash,
  chooseRepositoryFolder,
  commitChanges,
  createBranch,
  createStash,
  deleteBranch,
  dropStash,
  fetchRemote,
  getBranches,
  getGitVersion,
  getRepositoryStatus,
  getStashes,
  mergeBranch,
  normalizeGitError,
  openRepository,
  popStash,
  pullRemote,
  pushRemote,
  rebaseOntoBranch,
  renameBranch,
  stageFile,
  switchBranch,
  unstageFile,
} from "./lib/tauri";
import {
  BranchPanel,
  type BranchesState,
} from "./features/branches/BranchPanel";
import {
  StashPanel,
  type StashesState,
} from "./features/stashes/StashPanel";
import type { GitError, GitOutput } from "./types/git";
import type { Repository } from "./types/repository";
import type { Stash } from "./types/stash";
import type {
  BranchStatus,
  FileChange,
  FileStatus,
  RepositoryStatus,
} from "./types/status";

type GitStatus =
  | { state: "checking" }
  | { state: "ready"; output: GitOutput }
  | { state: "error"; error: GitError };

type OpenState = "idle" | "choosing" | "validating";

type RepositoryStatusState =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "ready";
      status: RepositoryStatus;
      isRefreshing: boolean;
      refreshError: GitError | null;
    }
  | { state: "error"; error: GitError };

type AppOperation =
  | { state: "idle" }
  | { state: "staging"; path: string }
  | { state: "unstaging"; path: string }
  | { state: "committing" }
  | { state: "switching"; branchName: string }
  | { state: "creating"; branchName: string }
  | { state: "renaming"; branchName: string }
  | { state: "deleting"; branchName: string }
  | { state: "fetching" }
  | { state: "pulling" }
  | { state: "pushing" }
  | { state: "stashing" }
  | { state: "applyingStash"; stashRef: string }
  | { state: "poppingStash"; stashRef: string }
  | { state: "droppingStash"; stashRef: string }
  | { state: "merging"; branchName: string }
  | { state: "rebasing"; branchName: string }
  | { state: "abortingMerge" }
  | { state: "abortingRebase" };

type RemoteOperation = "fetch" | "pull" | "push";

type StashMutation =
  | { kind: "create"; message: string }
  | { kind: "apply"; stash: Stash }
  | { kind: "pop"; stash: Stash }
  | { kind: "drop"; stash: Stash };

type BranchMutation =
  | { kind: "switch"; branchName: string }
  | { kind: "create"; branchName: string }
  | { kind: "rename"; branchName: string; newName: string }
  | { kind: "delete"; branchName: string };

const fileStatusLabels: Record<FileStatus, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  typeChanged: "Type changed",
  untracked: "Untracked",
  conflicted: "Conflicted",
};

const fileStatusSymbols: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typeChanged: "T",
  untracked: "?",
  conflicted: "!",
};

/** Renders the compact Branchlight brand mark used across app screens. */
function BranchlightMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** Renders the folder glyph used by repository picker actions. */
function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 6.75A2.25 2.25 0 0 1 5.75 4.5h3.17c.6 0 1.17.24 1.6.66l1.18 1.18c.14.14.33.22.53.22h6.02a2.25 2.25 0 0 1 2.25 2.25v7.94A2.25 2.25 0 0 1 18.25 19H5.75a2.25 2.25 0 0 1-2.25-2.25v-10Z" />
    </svg>
  );
}

/** Renders the refresh glyph used by status reload actions. */
function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.1 7.4A8 8 0 1 0 20 14h-2.1a6 6 0 1 1-.4-4.9L14 12.5h7V5.4l-1.9 2Z" />
    </svg>
  );
}

/** Distinguishes stage and unstage actions without relying on color. */
function StageIcon({ direction }: { direction: "stage" | "unstage" }) {
  return (
    <span className="stage-icon" aria-hidden="true">
      {direction === "stage" ? "+" : "−"}
    </span>
  );
}

/** Presents a structured Git error and any captured command output. */
function ErrorNotice({
  error,
  title = "That folder couldn’t be opened",
}: {
  error: GitError;
  title?: string;
}) {
  const details =
    error.output?.stderr.trim() || error.output?.stdout.trim() || undefined;

  return (
    <div className="error-notice" role="alert">
      <span className="error-notice__icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{title}</strong>
        <p>{error.message}</p>
        {details && <pre>{details}</pre>}
      </div>
    </div>
  );
}

/** Summarizes the checked-out branch and its upstream divergence. */
function BranchSummary({ branch }: { branch: BranchStatus }) {
  const branchLabel = branch.isDetached
    ? "Detached HEAD"
    : (branch.name ?? "Unknown branch");
  const trackingLabel = branch.isDetached
    ? branch.oid?.slice(0, 10) ?? "No commit"
    : branch.upstream ?? (branch.oid ? "No upstream" : "No commits yet");

  return (
    <div className="branch-summary">
      <span className="branch-symbol" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <div className="branch-summary__identity">
        <strong>{branchLabel}</strong>
        <span>{trackingLabel}</span>
      </div>
      {branch.upstream && (
        <div className="branch-counts" aria-label="Upstream divergence">
          <span title="Commits ahead of upstream">↑ {branch.ahead ?? 0}</span>
          <span title="Commits behind upstream">↓ {branch.behind ?? 0}</span>
        </div>
      )}
    </div>
  );
}

/** Keeps active merge/rebase conflicts visible with only the matching abort action. */
function ConflictBanner({
  status,
  operation,
  operationError,
  isRefreshing,
  onRefresh,
  onAbort,
}: {
  status: RepositoryStatus;
  operation: AppOperation;
  operationError: GitError | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onAbort: (kind: "merge" | "rebase") => void;
}) {
  const activeOperation = status.operation;
  const hasRepositoryConflict =
    activeOperation !== "none" || status.conflicts.length > 0;
  if (!hasRepositoryConflict && !operationError) {
    return null;
  }

  const operationLabel =
    activeOperation === "merge"
      ? "Merge"
      : activeOperation === "rebase"
        ? "Rebase"
        : status.conflicts.length > 0
          ? "Unresolved conflicts"
          : "Repository operation changed";
  const conflictCount = status.conflicts.length;
  const isAborting =
    (activeOperation === "merge" && operation.state === "abortingMerge") ||
    (activeOperation === "rebase" && operation.state === "abortingRebase");
  const actionsDisabled = operation.state !== "idle" || isRefreshing;

  return (
    <section
      className="conflict-banner"
      aria-labelledby="conflict-banner-title"
      aria-live="polite"
    >
      <div className="conflict-banner__heading">
        <span className="conflict-banner__icon" aria-hidden="true">
          !
        </span>
        <div>
          <p className="eyebrow">Git operation</p>
          <h2 id="conflict-banner-title">
            {activeOperation === "none"
              ? operationLabel
              : `${operationLabel} in progress`}
          </h2>
          <p>
            {!hasRepositoryConflict
              ? "Git no longer reports an active merge or rebase."
              : conflictCount === 0
              ? "Git reports no conflicted files right now."
              : `${conflictCount} ${conflictCount === 1 ? "file requires" : "files require"} manual resolution.`}
          </p>
        </div>
      </div>

      {conflictCount > 0 && (
        <ul className="conflict-banner__files" aria-label="Conflicted files">
          {status.conflicts.map((conflict) => (
            <li key={conflict.path}>
              <code title={conflict.path}>{conflict.path}</code>
            </li>
          ))}
        </ul>
      )}

      <div className="conflict-banner__guidance">
        <p>
          {hasRepositoryConflict
            ? "Resolve these files in your editor, then refresh Branchlight to read Git’s latest state."
            : "Review Git’s message below, then refresh Branchlight before continuing."}
        </p>
        <div>
          <button
            className="secondary-button"
            type="button"
            disabled={actionsDisabled}
            aria-busy={isRefreshing}
            onClick={onRefresh}
          >
            {isRefreshing ? <span className="small-spinner" /> : <RefreshIcon />}
            {isRefreshing ? "Refreshing…" : "Refresh status"}
          </button>
          {activeOperation !== "none" && (
            <button
              className="conflict-banner__abort"
              type="button"
              disabled={actionsDisabled}
              aria-busy={isAborting}
              onClick={() => onAbort(activeOperation)}
            >
              {isAborting && <span className="small-spinner" aria-hidden="true" />}
              {isAborting
                ? `Aborting ${activeOperation}…`
                : `Abort ${activeOperation}`}
            </button>
          )}
        </div>
      </div>

      {operationError && (
        <ErrorNotice
          error={operationError}
          title={
            activeOperation === "none"
              ? "Git couldn’t abort the repository operation"
              : `Git couldn’t abort the ${activeOperation}`
          }
        />
      )}
    </section>
  );
}

/** Renders one status group and its optional whole-file action. */
function ChangeSection({
  title,
  description,
  emptyMessage,
  changes,
  tone,
  action,
  busyPath,
  actionsDisabled,
}: {
  title: string;
  description: string;
  emptyMessage: string;
  changes: FileChange[];
  tone: "staged" | "unstaged" | "conflict";
  action?: {
    label: string;
    busyLabel: string;
    direction: "stage" | "unstage";
    onClick: (path: string) => void;
  };
  busyPath?: string;
  actionsDisabled?: boolean;
}) {
  return (
    <section className={`change-section change-section--${tone}`}>
      <header className="change-section__header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="change-count" aria-label={`${changes.length} files`}>
          {changes.length}
        </span>
      </header>

      {changes.length === 0 ? (
        <p className="change-section__empty">{emptyMessage}</p>
      ) : (
        <ul className="change-list">
          {changes.map((change) => (
            <li key={`${change.status}:${change.path}:${change.originalPath ?? ""}`}>
              <span
                className={`change-symbol change-symbol--${change.status}`}
                title={fileStatusLabels[change.status]}
                aria-label={fileStatusLabels[change.status]}
              >
                {fileStatusSymbols[change.status]}
              </span>
              <div className="change-path">
                <code title={change.path}>{change.path}</code>
                {change.originalPath && (
                  <span title={change.originalPath}>
                    from <code>{change.originalPath}</code>
                  </span>
                )}
              </div>
              {action ? (
                <button
                  className="change-action"
                  type="button"
                  disabled={actionsDisabled}
                  aria-label={`${action.label} ${change.path}`}
                  onClick={() => action.onClick(change.path)}
                >
                  {busyPath === change.path ? (
                    <span className="small-spinner" aria-hidden="true" />
                  ) : (
                    <StageIcon direction={action.direction} />
                  )}
                  {busyPath === change.path ? action.busyLabel : action.label}
                </button>
              ) : (
                <span className="change-kind">
                  {fileStatusLabels[change.status]}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Renders repository changes and coordinates the daily commit workflow. */
function RepositoryWorkspace({
  state,
  stashesState,
  onRefresh,
  operation,
  operationError,
  stashOperationError,
  commitMessage,
  onCommitMessageChange,
  onStage,
  onUnstage,
  onCommit,
  onCreateStash,
  onApplyStash,
  onPopStash,
  onDropStash,
}: {
  state: RepositoryStatusState;
  stashesState: StashesState;
  onRefresh: () => void;
  operation: AppOperation;
  operationError: GitError | null;
  stashOperationError: GitError | null;
  commitMessage: string;
  onCommitMessageChange: (message: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (event: FormEvent<HTMLFormElement>) => void;
  onCreateStash: (message: string) => Promise<boolean>;
  onApplyStash: (stash: Stash) => Promise<boolean>;
  onPopStash: (stash: Stash) => Promise<boolean>;
  onDropStash: (stash: Stash) => Promise<boolean>;
}) {
  if (state.state === "idle" || state.state === "loading") {
    return (
      <section className="status-loading" aria-live="polite">
        <span className="workspace-spinner" aria-hidden="true" />
        <strong>Reading repository status…</strong>
        <p>Asking system Git for the latest working-tree state.</p>
      </section>
    );
  }

  if (state.state === "error") {
    return (
      <section className="status-error">
        <ErrorNotice
          error={state.error}
          title="Repository status couldn’t be refreshed"
        />
        <button className="secondary-button" type="button" onClick={onRefresh}>
          <RefreshIcon />
          Try again
        </button>
      </section>
    );
  }

  const { status } = state;
  const changeCount =
    status.staged.length + status.unstaged.length + status.conflicts.length;
  const isMutating =
    operation.state !== "idle" || status.operation !== "none";
  const actionsDisabled = isMutating || state.isRefreshing;
  const canCommit =
    status.staged.length > 0 &&
    status.conflicts.length === 0 &&
    commitMessage.trim().length > 0 &&
    !actionsDisabled;
  const commitHint =
    status.conflicts.length > 0
      ? "Resolve conflicts before committing."
      : status.staged.length === 0
        ? "Stage at least one file to create a commit."
        : commitMessage.trim().length === 0
          ? "Enter a message that describes this commit."
          : `${status.staged.length} ${status.staged.length === 1 ? "file" : "files"} will be committed.`;
  const busyStashReference =
    operation.state === "applyingStash" ||
    operation.state === "poppingStash" ||
    operation.state === "droppingStash"
      ? operation.stashRef
      : null;
  const busyStashOperation =
    operation.state === "applyingStash"
      ? "apply"
      : operation.state === "poppingStash"
        ? "pop"
        : operation.state === "droppingStash"
          ? "drop"
          : null;

  return (
    <section className="repository-workspace" aria-labelledby="changes-title">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Working tree</p>
          <h2 id="changes-title">Repository changes</h2>
          <p>
            {changeCount === 0
              ? "Everything is clean and up to date."
              : `${changeCount} ${changeCount === 1 ? "change" : "changes"} reported by Git.`}
          </p>
        </div>
        <div className="workspace-facts">
          <span>{status.stashCount} stashed</span>
          <span>{changeCount} total</span>
        </div>
      </header>

      {(operationError || state.refreshError) && (
        <div className="workspace-error">
          <ErrorNotice
            error={operationError ?? state.refreshError!}
            title={
              operationError
                ? "Git couldn’t complete that action"
                : "Repository status couldn’t be refreshed"
            }
          />
          {state.refreshError && !operationError && (
            <button
              className="secondary-button"
              type="button"
              disabled={state.isRefreshing || isMutating}
              onClick={onRefresh}
            >
              <RefreshIcon />
              Try again
            </button>
          )}
        </div>
      )}

      <StashPanel
        state={stashesState}
        operationError={stashOperationError}
        actionsDisabled={actionsDisabled}
        isCreating={operation.state === "stashing"}
        busyReference={busyStashReference}
        busyOperation={busyStashOperation}
        onRefresh={onRefresh}
        onCreate={onCreateStash}
        onApply={onApplyStash}
        onPop={onPopStash}
        onDrop={onDropStash}
      />

      <div className="changes-grid">
        <ChangeSection
          title="Conflicts"
          description="Files that need manual resolution"
          emptyMessage="No conflicted files"
          changes={status.conflicts}
          tone="conflict"
        />
        <ChangeSection
          title="Unstaged"
          description="Working-tree changes not in the index"
          emptyMessage="No unstaged changes"
          changes={status.unstaged}
          tone="unstaged"
          action={{
            label: "Stage",
            busyLabel: "Staging…",
            direction: "stage",
            onClick: onStage,
          }}
          busyPath={
            operation.state === "staging" ? operation.path : undefined
          }
          actionsDisabled={actionsDisabled}
        />
        <ChangeSection
          title="Staged"
          description="Changes ready for the next commit"
          emptyMessage="No staged changes"
          changes={status.staged}
          tone="staged"
          action={{
            label: "Unstage",
            busyLabel: "Unstaging…",
            direction: "unstage",
            onClick: onUnstage,
          }}
          busyPath={
            operation.state === "unstaging" ? operation.path : undefined
          }
          actionsDisabled={actionsDisabled}
        />
      </div>

      <form className="commit-panel" onSubmit={onCommit}>
        <div className="commit-panel__heading">
          <div>
            <p className="eyebrow">Next commit</p>
            <h3>Commit staged changes</h3>
          </div>
          <span>
            {status.staged.length} staged
          </span>
        </div>
        <label htmlFor="commit-message">Commit message</label>
        <div className="commit-controls">
          <input
            id="commit-message"
            name="commitMessage"
            type="text"
            value={commitMessage}
            maxLength={500}
            disabled={isMutating}
            placeholder="Describe what changed"
            autoComplete="off"
            onChange={(event) => onCommitMessageChange(event.target.value)}
          />
          <button
            className="primary-button commit-button"
            type="submit"
            disabled={!canCommit}
            aria-busy={operation.state === "committing"}
          >
            {operation.state === "committing" && (
              <span className="button-spinner" aria-hidden="true" />
            )}
            {operation.state === "committing" ? "Committing…" : "Commit"}
          </button>
        </div>
        <p className="commit-hint">{commitHint}</p>
      </form>
    </section>
  );
}

/** Frames the active repository status and repository-level actions. */
function RepositoryScreen({
  repository,
  repositoryError,
  openState,
  statusState,
  branchesState,
  stashesState,
  operation,
  changeOperationError,
  branchOperationError,
  branchOperationNotice,
  remoteOperationError,
  stashOperationError,
  conflictOperationError,
  commitMessage,
  onOpenRepository,
  onRefresh,
  onCommitMessageChange,
  onStage,
  onUnstage,
  onCommit,
  onSwitchBranch,
  onCreateBranch,
  onRenameBranch,
  onDeleteBranch,
  onMergeBranch,
  onRebaseBranch,
  onAbortOperation,
  onRemoteOperation,
  onCreateStash,
  onApplyStash,
  onPopStash,
  onDropStash,
}: {
  repository: Repository;
  repositoryError: GitError | null;
  openState: OpenState;
  statusState: RepositoryStatusState;
  branchesState: BranchesState;
  stashesState: StashesState;
  operation: AppOperation;
  changeOperationError: GitError | null;
  branchOperationError: GitError | null;
  branchOperationNotice: string | null;
  remoteOperationError: GitError | null;
  stashOperationError: GitError | null;
  conflictOperationError: GitError | null;
  commitMessage: string;
  onOpenRepository: () => void;
  onRefresh: () => void;
  onCommitMessageChange: (message: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (event: FormEvent<HTMLFormElement>) => void;
  onSwitchBranch: (branchName: string) => Promise<boolean>;
  onCreateBranch: (branchName: string) => Promise<boolean>;
  onRenameBranch: (oldName: string, newName: string) => Promise<boolean>;
  onDeleteBranch: (branchName: string) => Promise<boolean>;
  onMergeBranch: (sourceBranch: string) => Promise<boolean>;
  onRebaseBranch: (sourceBranch: string) => Promise<boolean>;
  onAbortOperation: (kind: "merge" | "rebase") => void;
  onRemoteOperation: (kind: RemoteOperation) => void;
  onCreateStash: (message: string) => Promise<boolean>;
  onApplyStash: (stash: Stash) => Promise<boolean>;
  onPopStash: (stash: Stash) => Promise<boolean>;
  onDropStash: (stash: Stash) => Promise<boolean>;
}) {
  const status = statusState.state === "ready" ? statusState.status : null;
  const isRefreshing =
    statusState.state === "loading" ||
    (statusState.state === "ready" && statusState.isRefreshing) ||
    branchesState.state === "loading" ||
    (branchesState.state === "ready" && branchesState.isRefreshing) ||
    stashesState.state === "loading" ||
    (stashesState.state === "ready" && stashesState.isRefreshing);
  const isMutating = operation.state !== "idle";
  const hasActiveRepositoryOperation =
    status !== null && status.operation !== "none";
  const busyBranchName =
    operation.state === "switching" ||
    operation.state === "creating" ||
    operation.state === "renaming" ||
    operation.state === "deleting" ||
    operation.state === "merging" ||
    operation.state === "rebasing"
      ? operation.branchName
      : null;

  return (
    <main className="repository-screen">
      <header className="repository-bar">
        <div className="repository-brand">
          <BranchlightMark />
          <div className="repository-identity">
            <h1>{repository.name}</h1>
            <span title={repository.path}>{repository.path}</span>
          </div>
        </div>

        <div className="repository-branch" aria-live="polite">
          {status ? (
            <BranchSummary branch={status.branch} />
          ) : (
            <div className="branch-summary branch-summary--loading">
              <span className="status-dot status-dot--checking" />
              <div className="branch-summary__identity">
                <strong>
                  {statusState.state === "error"
                    ? "Status unavailable"
                    : "Reading branch…"}
                </strong>
                <span>System Git</span>
              </div>
            </div>
          )}
        </div>

        <div className="repository-actions">
          {(["fetch", "pull", "push"] as const).map((kind) => {
            const operationState = `${kind}ing` as
              | "fetching"
              | "pulling"
              | "pushing";
            const isRunning = operation.state === operationState;
            const label = `${kind[0].toUpperCase()}${kind.slice(1)}`;

            return (
              <button
                className="secondary-button remote-button"
                type="button"
                key={kind}
                disabled={
                  isRefreshing ||
                  isMutating ||
                  hasActiveRepositoryOperation ||
                  openState !== "idle"
                }
                aria-busy={isRunning}
                onClick={() => onRemoteOperation(kind)}
              >
                {isRunning && <span className="small-spinner" aria-hidden="true" />}
                {isRunning ? `${label}ing…` : label}
              </button>
            );
          })}
          <button
            className="secondary-button"
            type="button"
            disabled={
              !status ||
              isRefreshing ||
              isMutating ||
              hasActiveRepositoryOperation ||
              openState !== "idle"
            }
            onClick={() => document.getElementById("stash-message")?.focus()}
          >
            Stash
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={isRefreshing || isMutating || openState !== "idle"}
            aria-busy={isRefreshing}
            onClick={onRefresh}
          >
            {isRefreshing ? <span className="small-spinner" /> : <RefreshIcon />}
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={isMutating || openState !== "idle"}
            aria-busy={openState !== "idle"}
            onClick={onOpenRepository}
          >
            <FolderIcon />
            {openState === "idle" ? "Open another" : "Opening…"}
          </button>
        </div>
      </header>

      {repositoryError && (
        <div className="repository-alert">
          <ErrorNotice error={repositoryError} />
        </div>
      )}

      {remoteOperationError && (
        <div className="repository-alert">
          <ErrorNotice
            title="Git couldn’t synchronize this repository"
            error={remoteOperationError}
          />
        </div>
      )}

      {status && (
        <ConflictBanner
          status={status}
          operation={operation}
          operationError={conflictOperationError}
          isRefreshing={isRefreshing}
          onRefresh={onRefresh}
          onAbort={onAbortOperation}
        />
      )}

      <div className="repository-body">
        <BranchPanel
          state={branchesState}
          operationError={branchOperationError}
          operationNotice={branchOperationNotice}
          actionsDisabled={isMutating || hasActiveRepositoryOperation}
          busyBranchName={busyBranchName}
          onRefresh={onRefresh}
          onSwitch={onSwitchBranch}
          onCreate={onCreateBranch}
          onRename={onRenameBranch}
          onDelete={onDeleteBranch}
          onMerge={onMergeBranch}
          onRebase={onRebaseBranch}
        />
        <RepositoryWorkspace
          state={statusState}
          stashesState={stashesState}
          onRefresh={onRefresh}
          operation={operation}
          operationError={changeOperationError}
          stashOperationError={stashOperationError}
          commitMessage={commitMessage}
          onCommitMessageChange={onCommitMessageChange}
          onStage={onStage}
          onUnstage={onUnstage}
          onCommit={onCommit}
          onCreateStash={onCreateStash}
          onApplyStash={onApplyStash}
          onPopStash={onPopStash}
          onDropStash={onDropStash}
        />
      </div>
    </main>
  );
}

/** Owns system Git, repository, status, and mutation state for the app. */
function App() {
  const [gitStatus, setGitStatus] = useState<GitStatus>({
    state: "checking",
  });
  const [repository, setRepository] = useState<Repository | null>(null);
  const [repositoryError, setRepositoryError] = useState<GitError | null>(null);
  const [openState, setOpenState] = useState<OpenState>("idle");
  const [repositoryStatus, setRepositoryStatus] =
    useState<RepositoryStatusState>({ state: "idle" });
  const [branchesState, setBranchesState] = useState<BranchesState>({
    state: "idle",
  });
  const [stashesState, setStashesState] = useState<StashesState>({
    state: "idle",
  });
  const [operation, setOperation] = useState<AppOperation>({
    state: "idle",
  });
  const [changeOperationError, setChangeOperationError] =
    useState<GitError | null>(null);
  const [branchOperationError, setBranchOperationError] =
    useState<GitError | null>(null);
  const [branchOperationNotice, setBranchOperationNotice] = useState<
    string | null
  >(null);
  const [remoteOperationError, setRemoteOperationError] =
    useState<GitError | null>(null);
  const [stashOperationError, setStashOperationError] =
    useState<GitError | null>(null);
  const [conflictOperationError, setConflictOperationError] =
    useState<GitError | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const statusRequestId = useRef(0);
  const branchesRequestId = useRef(0);
  const stashesRequestId = useRef(0);

  const checkGitVersion = useCallback(async () => {
    setGitStatus({ state: "checking" });

    try {
      const output = await getGitVersion();
      setGitStatus({ state: "ready", output });
    } catch (error) {
      setGitStatus({ state: "error", error: normalizeGitError(error) });
    }
  }, []);

  useEffect(() => {
    void checkGitVersion();
  }, [checkGitVersion]);

  /** Refreshes Git state while retaining the last successful snapshot on failure. */
  const refreshRepositoryStatus = useCallback(async (repositoryPath: string) => {
    const requestId = ++statusRequestId.current;
    setRepositoryStatus((current) =>
      current.state === "ready"
        ? { ...current, isRefreshing: true, refreshError: null }
        : { state: "loading" },
    );

    try {
      const status = await getRepositoryStatus(repositoryPath);
      if (requestId === statusRequestId.current) {
        setRepositoryStatus({
          state: "ready",
          status,
          isRefreshing: false,
          refreshError: null,
        });
      }
    } catch (error) {
      const normalizedError = normalizeGitError(error);
      setRepositoryStatus((current) => {
        if (requestId !== statusRequestId.current) {
          return current;
        }

        return current.state === "ready"
          ? {
              ...current,
              isRefreshing: false,
              refreshError: normalizedError,
            }
          : { state: "error", error: normalizedError };
      });
    }
  }, []);

  /** Refreshes branch refs while retaining the last successful snapshot on failure. */
  const refreshBranches = useCallback(async (repositoryPath: string) => {
    const requestId = ++branchesRequestId.current;
    setBranchesState((current) =>
      current.state === "ready"
        ? { ...current, isRefreshing: true, refreshError: null }
        : { state: "loading" },
    );

    try {
      const branches = await getBranches(repositoryPath);
      if (requestId === branchesRequestId.current) {
        setBranchesState({
          state: "ready",
          branches,
          isRefreshing: false,
          refreshError: null,
        });
      }
    } catch (error) {
      const normalizedError = normalizeGitError(error);
      setBranchesState((current) => {
        if (requestId !== branchesRequestId.current) {
          return current;
        }

        return current.state === "ready"
          ? {
              ...current,
              isRefreshing: false,
              refreshError: normalizedError,
            }
          : { state: "error", error: normalizedError };
      });
    }
  }, []);

  /** Refreshes stash entries while retaining the last successful snapshot on failure. */
  const refreshStashes = useCallback(async (repositoryPath: string) => {
    const requestId = ++stashesRequestId.current;
    setStashesState((current) =>
      current.state === "ready"
        ? { ...current, isRefreshing: true, refreshError: null }
        : { state: "loading" },
    );

    try {
      const stashes = await getStashes(repositoryPath);
      if (requestId === stashesRequestId.current) {
        setStashesState({
          state: "ready",
          stashes,
          isRefreshing: false,
          refreshError: null,
        });
      }
    } catch (error) {
      const normalizedError = normalizeGitError(error);
      setStashesState((current) => {
        if (requestId !== stashesRequestId.current) {
          return current;
        }

        return current.state === "ready"
          ? {
              ...current,
              isRefreshing: false,
              refreshError: normalizedError,
            }
          : { state: "error", error: normalizedError };
      });
    }
  }, []);

  /** Refreshes every repository view after external or in-app Git changes. */
  const refreshRepositoryState = useCallback(
    async (repositoryPath: string) => {
      await Promise.all([
        refreshRepositoryStatus(repositoryPath),
        refreshBranches(repositoryPath),
        refreshStashes(repositoryPath),
      ]);
    },
    [refreshBranches, refreshRepositoryStatus, refreshStashes],
  );

  useEffect(() => {
    if (repository) {
      void refreshRepositoryState(repository.path);
    }
  }, [refreshRepositoryState, repository]);

  const handleOpenRepository = useCallback(async () => {
    if (openState !== "idle" || gitStatus.state !== "ready") {
      return;
    }

    setRepositoryError(null);
    setOpenState("choosing");

    try {
      const selectedPath = await chooseRepositoryFolder();
      if (!selectedPath) {
        return;
      }

      setOpenState("validating");
      const openedRepository = await openRepository(selectedPath);
      statusRequestId.current += 1;
      branchesRequestId.current += 1;
      stashesRequestId.current += 1;
      setRepositoryStatus({ state: "idle" });
      setBranchesState({ state: "idle" });
      setStashesState({ state: "idle" });
      setOperation({ state: "idle" });
      setChangeOperationError(null);
      setBranchOperationError(null);
      setBranchOperationNotice(null);
      setRemoteOperationError(null);
      setStashOperationError(null);
      setConflictOperationError(null);
      setCommitMessage("");
      setRepository(openedRepository);
    } catch (error) {
      setRepositoryError(normalizeGitError(error));
    } finally {
      setOpenState("idle");
    }
  }, [gitStatus.state, openState]);

  /** Runs one whole-file mutation and refreshes Git state after success. */
  const handleFileOperation = useCallback(
    async (kind: "stage" | "unstage", filePath: string) => {
      if (!repository || operation.state !== "idle") {
        return;
      }

      setChangeOperationError(null);
      setOperation({
        state: kind === "stage" ? "staging" : "unstaging",
        path: filePath,
      });

      try {
        if (kind === "stage") {
          await stageFile(repository.path, filePath);
        } else {
          await unstageFile(repository.path, filePath);
        }

        await refreshRepositoryState(repository.path);
      } catch (error) {
        setChangeOperationError(normalizeGitError(error));
      } finally {
        setOperation({ state: "idle" });
      }
    },
    [operation.state, refreshRepositoryState, repository],
  );

  /** Creates a commit only when the message is valid, then refreshes Git state. */
  const handleCommit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        !repository ||
        operation.state !== "idle" ||
        commitMessage.trim().length === 0
      ) {
        return;
      }

      setChangeOperationError(null);
      setOperation({ state: "committing" });

      try {
        await commitChanges(repository.path, commitMessage);
        setCommitMessage("");
        await refreshRepositoryState(repository.path);
      } catch (error) {
        setChangeOperationError(normalizeGitError(error));
      } finally {
        setOperation({ state: "idle" });
      }
    },
    [commitMessage, operation.state, refreshRepositoryState, repository],
  );

  /** Runs a local branch mutation and refreshes all repository state after success. */
  const handleBranchMutation = useCallback(
    async (mutation: BranchMutation): Promise<boolean> => {
      if (!repository || operation.state !== "idle") {
        return false;
      }

      const selectedBranch =
        branchesState.state === "ready"
          ? branchesState.branches.local.find(
              (branch) => branch.name === mutation.branchName,
            )
          : undefined;
      if (mutation.kind === "delete" && selectedBranch?.isCurrent) {
        setBranchOperationError({
          code: "invalidOperationInput",
          message: "Switch to another branch before deleting the current branch.",
        });
        return false;
      }

      setBranchOperationError(null);
      setBranchOperationNotice(null);
      setOperation(
        mutation.kind === "switch"
          ? { state: "switching", branchName: mutation.branchName }
          : mutation.kind === "create"
            ? { state: "creating", branchName: mutation.branchName }
            : mutation.kind === "rename"
              ? { state: "renaming", branchName: mutation.branchName }
              : { state: "deleting", branchName: mutation.branchName },
      );

      try {
        if (mutation.kind === "switch") {
          await switchBranch(repository.path, mutation.branchName);
        } else if (mutation.kind === "create") {
          await createBranch(repository.path, mutation.branchName);
        } else if (mutation.kind === "rename") {
          await renameBranch(
            repository.path,
            mutation.branchName,
            mutation.newName,
          );
        } else {
          await deleteBranch(repository.path, mutation.branchName);
        }

        await refreshRepositoryState(repository.path);
        return true;
      } catch (error) {
        setBranchOperationError(normalizeGitError(error));
        return false;
      } finally {
        setOperation({ state: "idle" });
      }
    },
    [branchesState, operation.state, refreshRepositoryState, repository],
  );

  /** Merges or rebases the current branch using one validated local source branch. */
  const handleBranchIntegration = useCallback(
    async (
      kind: "merge" | "rebase",
      sourceBranch: string,
    ): Promise<boolean> => {
      if (!repository || operation.state !== "idle") {
        return false;
      }

      const destinationBranch =
        branchesState.state === "ready"
          ? branchesState.branches.local.find((branch) => branch.isCurrent)
          : undefined;
      const source =
        branchesState.state === "ready"
          ? branchesState.branches.local.find(
              (branch) => branch.name === sourceBranch && !branch.isCurrent,
            )
          : undefined;
      if (!source || !destinationBranch) {
        setBranchOperationError({
          code: "invalidOperationInput",
          message:
            "Choose a non-current local branch and a checked-out destination.",
        });
        return false;
      }

      setBranchOperationError(null);
      setBranchOperationNotice(null);
      setOperation({
        state: kind === "merge" ? "merging" : "rebasing",
        branchName: sourceBranch,
      });

      let succeeded = false;
      try {
        if (kind === "merge") {
          await mergeBranch(repository.path, sourceBranch);
          setBranchOperationNotice(
            `Merged ${sourceBranch} into ${destinationBranch.name}.`,
          );
        } else {
          await rebaseOntoBranch(repository.path, sourceBranch);
          setBranchOperationNotice(
            `Rebased ${destinationBranch.name} onto ${sourceBranch}.`,
          );
        }
        succeeded = true;
      } catch (error) {
        setBranchOperationError(normalizeGitError(error));
      }

      await refreshRepositoryState(repository.path);
      setOperation({ state: "idle" });
      return succeeded;
    },
    [branchesState, operation.state, refreshRepositoryState, repository],
  );

  /** Aborts only the operation reported by Git and refreshes every view afterward. */
  const handleAbortOperation = useCallback(
    async (kind: "merge" | "rebase") => {
      if (!repository || operation.state !== "idle") {
        return;
      }

      const activeOperation =
        repositoryStatus.state === "ready"
          ? repositoryStatus.status.operation
          : "none";
      if (activeOperation !== kind) {
        setConflictOperationError({
          code: "invalidOperationInput",
          message: `Git does not report an active ${kind} to abort. Refresh status and try again.`,
        });
        return;
      }

      setConflictOperationError(null);
      setOperation({
        state: kind === "merge" ? "abortingMerge" : "abortingRebase",
      });

      try {
        if (kind === "merge") {
          await abortMerge(repository.path);
        } else {
          await abortRebase(repository.path);
        }
      } catch (error) {
        setConflictOperationError(normalizeGitError(error));
      }

      await refreshRepositoryState(repository.path);
      setOperation({ state: "idle" });
    },
    [operation.state, refreshRepositoryState, repository, repositoryStatus],
  );

  /** Runs one configured remote operation and refreshes all Git-backed state. */
  const handleRemoteOperation = useCallback(
    async (kind: RemoteOperation) => {
      if (!repository || operation.state !== "idle") {
        return;
      }

      setRemoteOperationError(null);
      setOperation({ state: `${kind}ing` });

      try {
        if (kind === "fetch") {
          await fetchRemote(repository.path);
        } else if (kind === "pull") {
          await pullRemote(repository.path);
        } else {
          await pushRemote(repository.path);
        }

        await refreshRepositoryState(repository.path);
      } catch (error) {
        setRemoteOperationError(normalizeGitError(error));
      } finally {
        setOperation({ state: "idle" });
      }
    },
    [operation.state, refreshRepositoryState, repository],
  );

  /** Runs one stash mutation and refreshes Git-backed state even after conflicts. */
  const handleStashMutation = useCallback(
    async (mutation: StashMutation): Promise<boolean> => {
      if (!repository || operation.state !== "idle") {
        return false;
      }

      setStashOperationError(null);
      setOperation(
        mutation.kind === "create"
          ? { state: "stashing" }
          : mutation.kind === "apply"
            ? { state: "applyingStash", stashRef: mutation.stash.reference }
            : mutation.kind === "pop"
              ? { state: "poppingStash", stashRef: mutation.stash.reference }
              : { state: "droppingStash", stashRef: mutation.stash.reference },
      );

      let succeeded = false;
      try {
        if (mutation.kind === "create") {
          await createStash(repository.path, mutation.message);
        } else if (mutation.kind === "apply") {
          await applyStash(repository.path, mutation.stash);
        } else if (mutation.kind === "pop") {
          await popStash(repository.path, mutation.stash);
        } else {
          await dropStash(repository.path, mutation.stash);
        }
        succeeded = true;
      } catch (error) {
        setStashOperationError(normalizeGitError(error));
      }

      await refreshRepositoryState(repository.path);
      setOperation({ state: "idle" });
      return succeeded;
    },
    [operation.state, refreshRepositoryState, repository],
  );

  if (repository) {
    return (
      <RepositoryScreen
        repository={repository}
        repositoryError={repositoryError}
        openState={openState}
        statusState={repositoryStatus}
        branchesState={branchesState}
        stashesState={stashesState}
        operation={operation}
        changeOperationError={changeOperationError}
        branchOperationError={branchOperationError}
        branchOperationNotice={branchOperationNotice}
        remoteOperationError={remoteOperationError}
        stashOperationError={stashOperationError}
        conflictOperationError={conflictOperationError}
        commitMessage={commitMessage}
        onOpenRepository={() => void handleOpenRepository()}
        onRefresh={() => {
          setChangeOperationError(null);
          setBranchOperationError(null);
          setBranchOperationNotice(null);
          setRemoteOperationError(null);
          setStashOperationError(null);
          setConflictOperationError(null);
          void refreshRepositoryState(repository.path);
        }}
        onCommitMessageChange={setCommitMessage}
        onStage={(path) => void handleFileOperation("stage", path)}
        onUnstage={(path) => void handleFileOperation("unstage", path)}
        onCommit={(event) => void handleCommit(event)}
        onSwitchBranch={(branchName) =>
          handleBranchMutation({ kind: "switch", branchName })
        }
        onCreateBranch={(branchName) =>
          handleBranchMutation({ kind: "create", branchName })
        }
        onRenameBranch={(branchName, newName) =>
          handleBranchMutation({ kind: "rename", branchName, newName })
        }
        onDeleteBranch={(branchName) =>
          handleBranchMutation({ kind: "delete", branchName })
        }
        onMergeBranch={(sourceBranch) =>
          handleBranchIntegration("merge", sourceBranch)
        }
        onRebaseBranch={(sourceBranch) =>
          handleBranchIntegration("rebase", sourceBranch)
        }
        onAbortOperation={(kind) => void handleAbortOperation(kind)}
        onRemoteOperation={(kind) => void handleRemoteOperation(kind)}
        onCreateStash={(message) =>
          handleStashMutation({ kind: "create", message })
        }
        onApplyStash={(stash) =>
          handleStashMutation({ kind: "apply", stash })
        }
        onPopStash={(stash) =>
          handleStashMutation({ kind: "pop", stash })
        }
        onDropStash={(stash) =>
          handleStashMutation({ kind: "drop", stash })
        }
      />
    );
  }

  const gitErrorDetails =
    gitStatus.state === "error"
      ? gitStatus.error.output?.stderr.trim() ||
        gitStatus.error.output?.stdout.trim()
      : undefined;
  const isOpening = openState !== "idle";
  const buttonLabel =
    openState === "choosing"
      ? "Choose a folder…"
      : openState === "validating"
        ? "Checking repository…"
        : "Open repository";

  return (
    <main className="landing-screen">
      <section className="landing-card" aria-labelledby="landing-title">
        <div className="landing-brand">
          <BranchlightMark />
          <span>Branchlight</span>
        </div>

        <div className="landing-copy">
          <p className="eyebrow">A lighter way to work with Git</p>
          <h1 id="landing-title">Open a repository.</h1>
          <p>
            Choose any folder inside a local Git repository. Branchlight will
            find and open its root.
          </p>
        </div>

        <button
          className="primary-button"
          type="button"
          disabled={gitStatus.state !== "ready" || isOpening}
          aria-busy={isOpening}
          onClick={() => void handleOpenRepository()}
        >
          {isOpening ? <span className="button-spinner" /> : <FolderIcon />}
          {buttonLabel}
        </button>

        {repositoryError && <ErrorNotice error={repositoryError} />}

        <div
          className={`git-status git-status--${gitStatus.state}`}
          aria-live="polite"
        >
          {gitStatus.state === "checking" && (
            <>
              <span className="status-dot status-dot--checking" />
              <p>Checking system Git…</p>
            </>
          )}

          {gitStatus.state === "ready" && (
            <>
              <span className="status-dot" />
              <p>
                System Git ready
                <span>{gitStatus.output.stdout.trim()}</span>
              </p>
            </>
          )}

          {gitStatus.state === "error" && (
            <div className="git-unavailable" role="alert">
              <div>
                <strong>System Git isn’t available.</strong>
                <p>
                  Install Git or make sure it can be run from your shell, then
                  check again.
                </p>
                {gitErrorDetails && <pre>{gitErrorDetails}</pre>}
              </div>
              <button type="button" onClick={() => void checkGitVersion()}>
                Check again
              </button>
            </div>
          )}
        </div>
      </section>

      <p className="landing-footnote">
        Your repositories stay on this Mac. Branchlight uses your existing Git
        configuration.
      </p>
    </main>
  );
}

export default App;
