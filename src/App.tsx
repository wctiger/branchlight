import { useCallback, useEffect, useState } from "react";

import "./App.css";
import {
  chooseRepositoryFolder,
  getGitVersion,
  normalizeGitError,
  openRepository,
} from "./lib/tauri";
import type { GitError, GitOutput } from "./types/git";
import type { Repository } from "./types/repository";

type GitStatus =
  | { state: "checking" }
  | { state: "ready"; output: GitOutput }
  | { state: "error"; error: GitError };

type OpenState = "idle" | "choosing" | "validating";

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

function ErrorNotice({ error }: { error: GitError }) {
  const details =
    error.output?.stderr.trim() || error.output?.stdout.trim() || undefined;

  return (
    <div className="error-notice" role="alert">
      <span className="error-notice__icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>That folder couldn’t be opened</strong>
        <p>{error.message}</p>
        {details && <pre>{details}</pre>}
      </div>
    </div>
  );
}

function App() {
  const [gitStatus, setGitStatus] = useState<GitStatus>({
    state: "checking",
  });
  const [repository, setRepository] = useState<Repository | null>(null);
  const [repositoryError, setRepositoryError] = useState<GitError | null>(null);
  const [openState, setOpenState] = useState<OpenState>("idle");

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
      setRepository(openedRepository);
    } catch (error) {
      setRepositoryError(normalizeGitError(error));
    } finally {
      setOpenState("idle");
    }
  }, [gitStatus.state, openState]);

  if (repository) {
    return (
      <main className="repository-screen">
        <header className="repository-bar">
          <div className="repository-brand">
            <BranchlightMark />
            <div className="repository-identity">
              <p>Open repository</p>
              <h1>{repository.name}</h1>
              <span title={repository.path}>{repository.path}</span>
            </div>
          </div>

          <button
            className="secondary-button"
            type="button"
            disabled={openState !== "idle"}
            aria-busy={openState !== "idle"}
            onClick={() => void handleOpenRepository()}
          >
            <FolderIcon />
            {openState === "idle" ? "Open another" : "Opening…"}
          </button>
        </header>

        {repositoryError && (
          <div className="repository-alert">
            <ErrorNotice error={repositoryError} />
          </div>
        )}

        <section className="repository-content" aria-labelledby="repository-title">
          <div className="repository-folder" aria-hidden="true">
            <FolderIcon />
            <span className="repository-check">✓</span>
          </div>
          <p className="eyebrow">Repository ready</p>
          <h2 id="repository-title">{repository.name} is open.</h2>
          <p className="repository-copy">
            Branchlight found the repository root through system Git and is
            ready to load its branches, changes, and history.
          </p>

          <div className="path-card">
            <span>Canonical repository path</span>
            <code>{repository.path}</code>
          </div>
        </section>
      </main>
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
