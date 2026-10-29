import styles from "@/features/stashes/StashPanel.module.css";
import sharedStyles from "@/styles/shared.module.css";
import { LoaderCircle } from "lucide-react";
import { OperationDialog } from "@/components/operation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState, useId } from "react";
import type { FormEvent } from "react";

import type { GitError } from "@/types/git";
import type { Stash } from "@/types/stash";

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
    <div className={styles["stash-error"]} role="alert">
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
  const titleId = useId();
  const messageId = useId();
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
    <section className={styles["stash-panel"]} aria-labelledby={titleId}>
      <header className={styles["stash-panel__header"]}>
        <div>
          <p data-slot="eyebrow" className={sharedStyles["eyebrow"]}>Saved work</p>
          <h3 id={titleId}>Stashes</h3>
        </div>
        <span>{stashes.length}</span>
      </header>

      <form
        className={styles["stash-create"]}
        onSubmit={(event) => void submitStash(event)}
      >
        <label htmlFor={messageId}>Optional stash message</label>
        <div>
          <Input
            id={messageId}
            name="stashMessage"
            type="text"
            value={message}
            maxLength={200}
            autoComplete="off"
            disabled={controlsDisabled}
            placeholder="What are you setting aside?"
            onChange={(event) => setMessage(event.target.value)}
          />
          <Button
            variant="outline"
            type="submit"
            disabled={controlsDisabled}
            aria-busy={isCreating}
          >
            {isCreating && (
              <LoaderCircle
                className={sharedStyles["small-spinner"]}
                aria-hidden="true"
                data-icon="inline-start"
              />
            )}
            {isCreating ? "Stashing…" : "Create stash"}
          </Button>
        </div>
      </form>

      {operationError ? (
        <StashError
          title="Git couldn’t complete that stash action."
          error={operationError}
        />
      ) : (
        state.state === "ready" &&
        state.refreshError && (
          <StashError
            title="Git couldn’t refresh stashes."
            error={state.refreshError}
          />
        )
      )}

      {(state.state === "idle" || state.state === "loading") && (
        <div className={styles["stash-panel__status"]} aria-live="polite">
          <LoaderCircle
            className={sharedStyles["small-spinner"]}
            aria-hidden="true"
            data-icon="inline-start"
          />
          <span>Reading stashes…</span>
        </div>
      )}

      {state.state === "error" && (
        <div className={styles["stash-panel__status"]}>
          <StashError title="Git couldn’t load stashes." error={state.error} />
          <Button
            variant="outline"
            type="button"
            disabled={actionsDisabled}
            onClick={onRefresh}
          >
            Try again
          </Button>
        </div>
      )}

      {state.state === "ready" && stashes.length === 0 && (
        <p className={styles["stash-panel__empty"]}>No saved work yet.</p>
      )}

      {state.state === "ready" && stashes.length > 0 && (
        <ul className={styles["stash-list"]}>
          {stashes.map((stash) => {
            const isBusy = stash.reference === busyReference;
            const isConfirmingDrop = pendingDropRef === stash.reference;

            return (
              <li key={stash.reference} className={styles["stash-item"]}>
                <div className={styles["stash-item__identity"]}>
                  <div>
                    <code>{stash.reference}</code>
                    <code>{stash.commit.slice(0, 8)}</code>
                  </div>
                  <strong>{stash.message}</strong>
                </div>

                {isConfirmingDrop && (
                  <OperationDialog
                    title={`Drop ${stash.reference}?`}
                    description="This removes the stash permanently."
                    busy={controlsDisabled}
                    onClose={() => setPendingDropRef(null)}
                  >
                    <div>
                      <Button
                        variant="destructive"
                        className={styles["stash-button--danger"]}
                        type="button"
                        disabled={controlsDisabled}
                        aria-busy={isBusy && busyOperation === "drop"}
                        onClick={() => void confirmDrop()}
                      >
                        {isBusy && busyOperation === "drop"
                          ? "Dropping…"
                          : "Drop permanently"}
                      </Button>
                      <Button
                        variant="outline"
                        type="button"
                        disabled={controlsDisabled}
                        onClick={() => setPendingDropRef(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </OperationDialog>
                )}
                <div className={styles["stash-item__actions"]} hidden={isConfirmingDrop}>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={controlsDisabled}
                    aria-busy={isBusy && busyOperation === "apply"}
                    onClick={() => void onApply(stash)}
                  >
                    {isBusy && busyOperation === "apply"
                      ? "Applying…"
                      : "Apply"}
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={controlsDisabled}
                    aria-busy={isBusy && busyOperation === "pop"}
                    onClick={() => void onPop(stash)}
                  >
                    {isBusy && busyOperation === "pop" ? "Popping…" : "Pop"}
                  </Button>
                  <Button
                    variant="destructive"
                    className={styles["stash-button--danger"]}
                    type="button"
                    disabled={controlsDisabled}
                    onClick={() => setPendingDropRef(stash.reference)}
                  >
                    Drop
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
