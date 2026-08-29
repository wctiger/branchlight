import { useCallback, useEffect, useState } from "react";

import "./App.css";
import { getGitVersion, normalizeGitError } from "./lib/tauri";
import type { GitError, GitOutput } from "./types/git";

type GitStatus =
  | { state: "checking" }
  | { state: "ready"; output: GitOutput }
  | { state: "error"; error: GitError };

function App() {
  const [gitStatus, setGitStatus] = useState<GitStatus>({
    state: "checking",
  });

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

  const errorDetails =
    gitStatus.state === "error"
      ? gitStatus.error.output?.stderr.trim() ||
        gitStatus.error.output?.stdout.trim()
      : undefined;

  return (
    <main className="app-shell">
      <section className="foundation-card" aria-labelledby="page-title">
        <header className="hero">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="eyebrow">Branchlight foundation</p>
          <h1 id="page-title">Your Git, connected.</h1>
          <p className="hero-copy">
            Branchlight talks to the Git already configured on this Mac through
            a small, typed Rust boundary.
          </p>
        </header>

        <section className="git-card" aria-labelledby="git-status-title">
          <div className="git-card-heading">
            <div>
              <p className="section-label">Environment check</p>
              <h2 id="git-status-title">System Git</h2>
            </div>
            <span
              className={`status-pill status-pill--${gitStatus.state}`}
              aria-live="polite"
            >
              {gitStatus.state === "checking" && "Checking"}
              {gitStatus.state === "ready" && "Available"}
              {gitStatus.state === "error" && "Unavailable"}
            </span>
          </div>

          {gitStatus.state === "checking" && (
            <div className="status-message" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <div>
                <strong>Finding Git on this Mac…</strong>
                <p>The request is running through Tauri and Rust.</p>
              </div>
            </div>
          )}

          {gitStatus.state === "ready" && (
            <div className="status-message status-message--success">
              <span className="success-mark" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>
                  {gitStatus.output.stdout.trim() || "System Git responded"}
                </strong>
                <p>Branchlight is ready to use the existing Git installation.</p>
              </div>
            </div>
          )}

          {gitStatus.state === "error" && (
            <div className="error-panel" role="alert">
              <strong>{gitStatus.error.message}</strong>
              {errorDetails && <pre>{errorDetails}</pre>}
              <button type="button" onClick={() => void checkGitVersion()}>
                Check again
              </button>
            </div>
          )}
        </section>

        <ol className="request-path" aria-label="Git version request path">
          <li>React</li>
          <li>Tauri</li>
          <li>Rust</li>
          <li>System Git</li>
        </ol>
      </section>
    </main>
  );
}

export default App;
