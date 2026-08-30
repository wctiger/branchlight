import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { GitError } from "../../types/git";
import type { Stash } from "../../types/stash";

export type StashesState =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "ready";
      stashes: Stash[];
      isRefreshing: boolean;
      refreshError: GitError | null;
    }
  | { state: "error"; error: GitError };

type StashOperation = "apply" | "pop" | "drop";

interface StashPanelProps {
  state: StashesState;
  operationError: GitError | null;
  actionsDisabled: boolean;
  isCreating: boolean;
  busyReference: string | null;
  busyOperation: StashOperation | null;
  onRefresh: () => void;
  onCreate: (message: string) => Promise<boolean>;
  onApply: (stash: Stash) => Promise<boolean>;
  onPop: (stash: Stash) => Promise<boolean>;
  onDrop: (stash: Stash) => Promise<boolean>;
}

/** Shows a contextual stash failure and captured Git output. */
function StashError({ title, error }: { title: string; error: GitError }) {
  const details =
    error.output?.stderr.trim() || error.output?.stdout.trim() || undefined;

  return (
    <div className="stash-error" role="alert">
      <strong>{title}</strong>
      <p>{details ?? error.message}</p>
    </div>
  );
}

/** Provides create, list, apply, pop, and confirmed drop stash workflows. */
export function StashPanel({
  state,
  operationError,
  actionsDisabled,
  isCreating,
  busyReference,
  busyOperation,
  onRefresh,
  onCreate,
  onApply,
  onPop,
  onDrop,
}: StashPanelProps) {
  const [message, setMessage] = useState("");
  const [pendingDropRef, setPendingDropRef] = useState<string | null>(null);
  const stashes = state.state === "ready" ? state.stashes : [];
  const isRefreshing = state.state === "ready" && state.isRefreshing;
  const controlsDisabled = actionsDisabled || isRefreshing;

  useEffect(() => {
    if (
      pendingDropRef &&
      !stashes.some((stash) => stash.reference === pendingDropRef)
    ) {
      setPendingDropRef(null);
    }
  }, [pendingDropRef, stashes]);

  /** Creates a stash and clears the optional message after success. */
  const submitStash = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (controlsDisabled) {
      return;
    }

    if (await onCreate(message)) {
      setMessage("");
    }
  };

  /** Drops the explicitly confirmed stash entry. */
  const confirmDrop = async () => {
    if (!pendingDropRef || controlsDisabled) {
      return;
    }

    const stash = stashes.find((entry) => entry.reference === pendingDropRef);
    if (stash && (await onDrop(stash))) {
      setPendingDropRef(null);
    }
  };

  return (
    <section className="stash-panel" aria-labelledby="stashes-title">
      <header className="stash-panel__header">
        <div>
          <p className="eyebrow">Saved work</p>
          <h3 id="stashes-title">Stashes</h3>
        </div>
        <span>{stashes.length}</span>
      </header>

      <form className="stash-create" onSubmit={(event) => void submitStash(event)}>
        <label htmlFor="stash-message">Optional stash message</label>
        <div>
          <input
            id="stash-message"
            name="stashMessage"
            type="text"
            value={message}
            maxLength={200}
            autoComplete="off"
            disabled={controlsDisabled}
            placeholder="What are you setting aside?"
            onChange={(event) => setMessage(event.target.value)}
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={controlsDisabled}
            aria-busy={isCreating}
          >
            {isCreating && <span className="small-spinner" aria-hidden="true" />}
            {isCreating ? "Stashing…" : "Create stash"}
          </button>
        </div>
      </form>

      {operationError ? (
        <StashError title="Git couldn’t complete that stash action." error={operationError} />
      ) : (
        state.state === "ready" &&
        state.refreshError && (
          <StashError title="Git couldn’t refresh stashes." error={state.refreshError} />
        )
      )}

      {(state.state === "idle" || state.state === "loading") && (
        <div className="stash-panel__status" aria-live="polite">
          <span className="small-spinner" aria-hidden="true" />
          <span>Reading stashes…</span>
        </div>
      )}

      {state.state === "error" && (
        <div className="stash-panel__status">
          <StashError title="Git couldn’t load stashes." error={state.error} />
          <button
            className="secondary-button"
            type="button"
            disabled={actionsDisabled}
            onClick={onRefresh}
          >
            Try again
          </button>
        </div>
      )}

      {state.state === "ready" && stashes.length === 0 && (
        <p className="stash-panel__empty">No saved work yet.</p>
      )}

      {state.state === "ready" && stashes.length > 0 && (
        <ul className="stash-list">
          {stashes.map((stash, index) => {
            const isBusy = stash.reference === busyReference;
            const isConfirmingDrop = pendingDropRef === stash.reference;
            const titleId = `stash-drop-title-${index}`;
            const descriptionId = `stash-drop-description-${index}`;

            return (
              <li key={stash.reference} className="stash-item">
                <div className="stash-item__identity">
                  <div>
                    <code>{stash.reference}</code>
                    <code>{stash.commit.slice(0, 8)}</code>
                  </div>
                  <strong>{stash.message}</strong>
                </div>

                {isConfirmingDrop ? (
                  <div
                    className="stash-drop-confirmation"
                    role="alertdialog"
                    aria-labelledby={titleId}
                    aria-describedby={descriptionId}
                  >
                    <strong id={titleId}>Drop {stash.reference}?</strong>
                    <p id={descriptionId}>This removes the stash permanently.</p>
                    <div>
                      <button
                        className="stash-button--danger"
                        type="button"
                        disabled={controlsDisabled}
                        aria-busy={isBusy && busyOperation === "drop"}
                        onClick={() => void confirmDrop()}
                      >
                        {isBusy && busyOperation === "drop"
                          ? "Dropping…"
                          : "Drop permanently"}
                      </button>
                      <button
                        type="button"
                        disabled={controlsDisabled}
                        onClick={() => setPendingDropRef(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="stash-item__actions">
                    <button
                      type="button"
                      disabled={controlsDisabled}
                      aria-busy={isBusy && busyOperation === "apply"}
                      onClick={() => void onApply(stash)}
                    >
                      {isBusy && busyOperation === "apply" ? "Applying…" : "Apply"}
                    </button>
                    <button
                      type="button"
                      disabled={controlsDisabled}
                      aria-busy={isBusy && busyOperation === "pop"}
                      onClick={() => void onPop(stash)}
                    >
                      {isBusy && busyOperation === "pop" ? "Popping…" : "Pop"}
                    </button>
                    <button
                      className="stash-button--danger"
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => setPendingDropRef(stash.reference)}
                    >
                      Drop
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
