import styles from "@/workspace/ConflictBanner.module.css";
import sharedStyles from "@/styles/shared.module.css";
import { TriangleAlert, RefreshCw, LoaderCircle } from "lucide-react";
import { useId } from "react";
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
}: {
  status: RepositoryStatus;
  operation: AppOperation;
  operationError: GitError | null;
  isRefreshing: boolean;
  controlsDisabled: boolean;
  onRefresh: () => void;
  onAbort: (kind: "merge" | "rebase" | "cherryPick" | "revert") => void;
}) {
  const headingId = useId();
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
            ? "Resolve and stage conflicts with an external Git tool, then continue or skip the rebase there. Branchlight currently supports abort only. Refresh after each external step."
            : activeOperation === "merge"
              ? "Resolve and stage conflicts with an external Git tool, then finish the merge there. Refresh Branchlight afterward, or abort the merge here."
              : activeOperation === "cherryPick" || activeOperation === "revert"
                ? "Resolve and stage conflicts using external Git, then continue or skip there. You can also abort here. Refresh after each external step."
                : hasRepositoryConflict
                  ? "Resolve and stage these files with an external Git tool, then refresh Branchlight to read Git’s latest state."
                  : "Review Git’s message below, then refresh Branchlight before continuing."}
        </p>
        <div>
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
    </section>
  );
}
