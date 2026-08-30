import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import "./App.css";
import {
  chooseRepositoryFolder,
  commitChanges,
  getGitVersion,
  getRepositoryStatus,
  normalizeGitError,
  openRepository,
  stageFile,
  unstageFile,
} from "./lib/tauri";
import type { GitError, GitOutput } from "./types/git";
import type { Repository } from "./types/repository";
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

type RepositoryOperation =
  | { state: "idle" }
  | { state: "staging"; path: string }
  | { state: "unstaging"; path: string }
  | { state: "committing" };

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
  onRefresh,
  operation,
  operationError,
  commitMessage,
  onCommitMessageChange,
  onStage,
  onUnstage,
  onCommit,
}: {
  state: RepositoryStatusState;
  onRefresh: () => void;
  operation: RepositoryOperation;
  operationError: GitError | null;
  commitMessage: string;
  onCommitMessageChange: (message: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (event: FormEvent<HTMLFormElement>) => void;
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
  const isMutating = operation.state !== "idle";
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
  operation,
  operationError,
  commitMessage,
  onOpenRepository,
  onRefresh,
  onCommitMessageChange,
  onStage,
  onUnstage,
  onCommit,
}: {
  repository: Repository;
  repositoryError: GitError | null;
  openState: OpenState;
  statusState: RepositoryStatusState;
  operation: RepositoryOperation;
  operationError: GitError | null;
  commitMessage: string;
  onOpenRepository: () => void;
  onRefresh: () => void;
  onCommitMessageChange: (message: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const status = statusState.state === "ready" ? statusState.status : null;
  const isRefreshing =
    statusState.state === "loading" ||
    (statusState.state === "ready" && statusState.isRefreshing);
  const isMutating = operation.state !== "idle";

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

      <RepositoryWorkspace
        state={statusState}
        onRefresh={onRefresh}
        operation={operation}
        operationError={operationError}
        commitMessage={commitMessage}
        onCommitMessageChange={onCommitMessageChange}
        onStage={onStage}
        onUnstage={onUnstage}
        onCommit={onCommit}
      />
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
  const [operation, setOperation] = useState<RepositoryOperation>({
    state: "idle",
  });
  const [operationError, setOperationError] = useState<GitError | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const statusRequestId = useRef(0);

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

  useEffect(() => {
    if (repository) {
      void refreshRepositoryStatus(repository.path);
    }
  }, [refreshRepositoryStatus, repository]);

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
      setRepositoryStatus({ state: "idle" });
      setOperation({ state: "idle" });
      setOperationError(null);
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

      setOperationError(null);
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

        await refreshRepositoryStatus(repository.path);
      } catch (error) {
        setOperationError(normalizeGitError(error));
      } finally {
        setOperation({ state: "idle" });
      }
    },
    [operation.state, refreshRepositoryStatus, repository],
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

      setOperationError(null);
      setOperation({ state: "committing" });

      try {
        await commitChanges(repository.path, commitMessage);
        setCommitMessage("");
        await refreshRepositoryStatus(repository.path);
      } catch (error) {
        setOperationError(normalizeGitError(error));
      } finally {
        setOperation({ state: "idle" });
      }
    },
    [commitMessage, operation.state, refreshRepositoryStatus, repository],
  );

  if (repository) {
    return (
      <RepositoryScreen
        repository={repository}
        repositoryError={repositoryError}
        openState={openState}
        statusState={repositoryStatus}
        operation={operation}
        operationError={operationError}
        commitMessage={commitMessage}
        onOpenRepository={() => void handleOpenRepository()}
        onRefresh={() => void refreshRepositoryStatus(repository.path)}
        onCommitMessageChange={setCommitMessage}
        onStage={(path) => void handleFileOperation("stage", path)}
        onUnstage={(path) => void handleFileOperation("unstage", path)}
        onCommit={(event) => void handleCommit(event)}
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
