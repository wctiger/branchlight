import { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";
import {
  chooseRepositoryFolder,
  getGitVersion,
  getRepositoryStatus,
  normalizeGitError,
  openRepository,
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
  | { state: "ready"; status: RepositoryStatus }
  | { state: "error"; error: GitError };

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

function BranchlightMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 6.75A2.25 2.25 0 0 1 5.75 4.5h3.17c.6 0 1.17.24 1.6.66l1.18 1.18c.14.14.33.22.53.22h6.02a2.25 2.25 0 0 1 2.25 2.25v7.94A2.25 2.25 0 0 1 18.25 19H5.75a2.25 2.25 0 0 1-2.25-2.25v-10Z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.1 7.4A8 8 0 1 0 20 14h-2.1a6 6 0 1 1-.4-4.9L14 12.5h7V5.4l-1.9 2Z" />
    </svg>
  );
}

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

function ChangeSection({
  title,
  description,
  emptyMessage,
  changes,
  tone,
}: {
  title: string;
  description: string;
  emptyMessage: string;
  changes: FileChange[];
  tone: "staged" | "unstaged" | "conflict";
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
              <span className="change-kind">{fileStatusLabels[change.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RepositoryWorkspace({
  state,
  onRefresh,
}: {
  state: RepositoryStatusState;
  onRefresh: () => void;
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
        />
        <ChangeSection
          title="Staged"
          description="Changes ready for the next commit"
          emptyMessage="No staged changes"
          changes={status.staged}
          tone="staged"
        />
      </div>
    </section>
  );
}

function RepositoryScreen({
  repository,
  repositoryError,
  openState,
  statusState,
  onOpenRepository,
  onRefresh,
}: {
  repository: Repository;
  repositoryError: GitError | null;
  openState: OpenState;
  statusState: RepositoryStatusState;
  onOpenRepository: () => void;
  onRefresh: () => void;
}) {
  const status = statusState.state === "ready" ? statusState.status : null;
  const isRefreshing = statusState.state === "loading";

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
            disabled={isRefreshing || openState !== "idle"}
            aria-busy={isRefreshing}
            onClick={onRefresh}
          >
            {isRefreshing ? <span className="small-spinner" /> : <RefreshIcon />}
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={openState !== "idle"}
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

      <RepositoryWorkspace state={statusState} onRefresh={onRefresh} />
    </main>
  );
}

function App() {
  const [gitStatus, setGitStatus] = useState<GitStatus>({
    state: "checking",
  });
  const [repository, setRepository] = useState<Repository | null>(null);
  const [repositoryError, setRepositoryError] = useState<GitError | null>(null);
  const [openState, setOpenState] = useState<OpenState>("idle");
  const [repositoryStatus, setRepositoryStatus] =
    useState<RepositoryStatusState>({ state: "idle" });
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

  const refreshRepositoryStatus = useCallback(async (repositoryPath: string) => {
    const requestId = ++statusRequestId.current;
    setRepositoryStatus({ state: "loading" });

    try {
      const status = await getRepositoryStatus(repositoryPath);
      if (requestId === statusRequestId.current) {
        setRepositoryStatus({ state: "ready", status });
      }
    } catch (error) {
      if (requestId === statusRequestId.current) {
        setRepositoryStatus({
          state: "error",
          error: normalizeGitError(error),
        });
      }
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
      setRepository(openedRepository);
    } catch (error) {
      setRepositoryError(normalizeGitError(error));
    } finally {
      setOpenState("idle");
    }
  }, [gitStatus.state, openState]);

  if (repository) {
    return (
      <RepositoryScreen
        repository={repository}
        repositoryError={repositoryError}
        openState={openState}
        statusState={repositoryStatus}
        onOpenRepository={() => void handleOpenRepository()}
        onRefresh={() => void refreshRepositoryStatus(repository.path)}
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
