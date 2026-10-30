import styles from "@/workspace/ConflictBanner.module.css";
import sharedStyles from "@/styles/shared.module.css";
import { TriangleAlert, RefreshCw, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { OperationDialog } from "@/components/operation-dialog";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/workspace/ErrorNotice";
import type { AppOperation } from "@/workspace/types";
import type { GitError } from "@/types/git";
import {
  repositoryOperationLabels,
  type RepositoryStatus,
} from "@/types/status";

/** Keeps active Git operation conflicts visible with only the matching abort action. */
export function ConflictBanner({
  status,
  operation,
  operationError,
  isRefreshing,
  controlsDisabled,
  onRefresh,
  onAbort,
  onRecoverRebase,
}: {
  status: RepositoryStatus;
  operation: AppOperation;
  operationError: GitError | null;
  isRefreshing: boolean;
  controlsDisabled: boolean;
  onRefresh: () => void;
  onAbort: (kind: "merge" | "rebase" | "cherryPick" | "revert") => void;
  onRecoverRebase: (action: "continue" | "skip") => Promise<boolean>;
}) {
  const headingId = useId();
  const [confirmSkip, setConfirmSkip] = useState(false);
  const activeOperation = status.operation;
  const hasRepositoryConflict =
    activeOperation !== "none" || status.conflicts.length > 0;
  if (!hasRepositoryConflict && !operationError) {
    return null;
  }

  const operationLabel =
    activeOperation !== "none"
      ? repositoryOperationLabels[activeOperation]
      : status.conflicts.length > 0
        ? "Unresolved conflicts"
        : "Repository operation changed";
  const conflictCount = status.conflicts.length;
  const isAborting =
    (activeOperation === "merge" && operation.state === "abortingMerge") ||
    (activeOperation === "rebase" && operation.state === "abortingRebase") ||
    operation.state === "abortingHistory";
  const actionsDisabled =
    controlsDisabled || operation.state !== "idle" || isRefreshing;

  return (
    <section
      className={styles["conflict-banner"]}
      aria-labelledby={headingId}
      aria-live="polite"
    >
      <div className={styles["conflict-banner__heading"]}>
        <TriangleAlert
          className={styles["conflict-banner__icon"]}
          aria-hidden="true"
        />
        <div>
          <p data-slot="eyebrow" className={sharedStyles["eyebrow"]}>
            Git operation
          </p>
          <h2 id={headingId}>
            {activeOperation === "none"
              ? operationLabel
              : `${operationLabel} in progress`}
          </h2>
          <p>
            {!hasRepositoryConflict
              ? "Git no longer reports an active operation."
              : conflictCount === 0
                ? "Git reports no conflicted files right now."
                : `${conflictCount} ${conflictCount === 1 ? "file requires" : "files require"} manual resolution.`}
          </p>
        </div>
      </div>

      {conflictCount > 0 && (
        <ul
          className={styles["conflict-banner__files"]}
          aria-label="Conflicted files"
        >
          {status.conflicts.map((conflict) => (
            <li key={conflict.path}>
              <code title={conflict.path}>{conflict.path}</code>
            </li>
          ))}
        </ul>
      )}

      <div className={styles["conflict-banner__guidance"]}>
        <p>
          {activeOperation === "rebase"
            ? "Resolve and stage conflicts, then continue the rebase. Skip omits the current commit and discards its changes. Abort restores the branch to its pre-rebase state."
            : activeOperation === "merge"
              ? "Select an ordinary text conflict to resolve it here, or use an external tool. After staging every resolution, finish the merge using external Git, or abort here."
              : activeOperation === "cherryPick" || activeOperation === "revert"
                ? "Select an ordinary text conflict to resolve it here, or use an external tool. Continue or skip using external Git, or abort here. Refresh after each external step."
                : hasRepositoryConflict
                  ? "Resolve and stage these files with an external Git tool, then refresh Branchlight to read Git’s latest state."
                  : "Review Git’s message below, then refresh Branchlight before continuing."}
        </p>
        <div>
          {activeOperation === "rebase" && (
            <>
              <Button variant="outline" disabled={actionsDisabled || conflictCount > 0}
                onClick={() => void onRecoverRebase("continue")}>
                Continue rebase
              </Button>
              <Button variant="outline" disabled={actionsDisabled}
                onClick={() => setConfirmSkip(true)}>
                Skip rebase commit…
              </Button>
            </>
          )}
          <Button
            variant="outline"
            type="button"
            disabled={actionsDisabled}
            aria-busy={isRefreshing}
            onClick={onRefresh}
          >
            {isRefreshing ? (
              <LoaderCircle
                className={sharedStyles["small-spinner"]}
                aria-hidden="true"
                data-icon="inline-start"
              />
            ) : (
              <RefreshCw aria-hidden="true" data-icon="inline-start" />
            )}
            {isRefreshing ? "Refreshing…" : "Refresh status"}
          </Button>
          {activeOperation !== "none" && (
            <Button
              variant="outline"
              type="button"
              disabled={actionsDisabled}
              aria-busy={isAborting}
              onClick={() => onAbort(activeOperation)}
            >
              {isAborting && (
                <LoaderCircle
                  className={sharedStyles["small-spinner"]}
                  aria-hidden="true"
                  data-icon="inline-start"
                />
              )}
              {isAborting
                ? `Aborting ${operationLabel}…`
                : `Abort ${operationLabel}`}
            </Button>
          )}
        </div>
      </div>

      {operationError && (
        <ErrorNotice error={operationError} title="Git operation failed" />
      )}
      {confirmSkip && activeOperation === "rebase" && (
        <OperationDialog title="Skip current rebase commit?"
          description="Git will omit the current commit and discard its changes, including any resolution edits for this step. Later commits may stop with more conflicts."
          busy={operation.state === "recoveringRebase"}
          onClose={() => setConfirmSkip(false)}>
          <Button variant="outline" disabled={operation.state === "recoveringRebase"}
            onClick={() => setConfirmSkip(false)}>Cancel</Button>
          <Button disabled={actionsDisabled} onClick={async () => {
            await onRecoverRebase("skip");
            setConfirmSkip(false);
          }}>Skip current commit</Button>
        </OperationDialog>
      )}
    </section>
  );
}
