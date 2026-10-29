import { useId } from "react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/workspace/ErrorNotice";
import { RefreshIcon } from "@/workspace/icons";
import type { AppOperation } from "@/workspace/types";
import type { GitError } from "@/types/git";
import type { RepositoryStatus } from "@/types/status";

/** Keeps active merge/rebase conflicts visible with only the matching abort action. */
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
  onAbort: (kind: "merge" | "rebase") => void;
}) {
  const headingId = useId();
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
  const actionsDisabled =
    controlsDisabled || operation.state !== "idle" || isRefreshing;

  return (
    <section
      className="conflict-banner"
      aria-labelledby={headingId}
      aria-live="polite"
    >
      <div className="conflict-banner__heading">
        <span className="conflict-banner__icon" aria-hidden="true">
          !
        </span>
        <div>
          <p className="eyebrow">Git operation</p>
          <h2 id={headingId}>
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
          {activeOperation === "rebase"
            ? "Resolve and stage conflicts with an external Git tool, then continue or skip the rebase there. Branchlight currently supports abort only. Refresh after each external step."
            : activeOperation === "merge"
              ? "Resolve and stage conflicts with an external Git tool, then finish the merge there. Refresh Branchlight afterward, or abort the merge here."
              : hasRepositoryConflict
                ? "Resolve and stage these files with an external Git tool, then refresh Branchlight to read Git’s latest state."
                : "Review Git’s message below, then refresh Branchlight before continuing."}
        </p>
        <div>
          <Button
            variant="outline"
            className="secondary-button"
            type="button"
            disabled={actionsDisabled}
            aria-busy={isRefreshing}
            onClick={onRefresh}
          >
            {isRefreshing ? (
              <span className="small-spinner" />
            ) : (
              <RefreshIcon />
            )}
            {isRefreshing ? "Refreshing…" : "Refresh status"}
          </Button>
          {activeOperation !== "none" && (
            <Button
              variant="outline"
              className="conflict-banner__abort"
              type="button"
              disabled={actionsDisabled}
              aria-busy={isAborting}
              onClick={() => onAbort(activeOperation)}
            >
              {isAborting && (
                <span className="small-spinner" aria-hidden="true" />
              )}
              {isAborting
                ? `Aborting ${activeOperation}…`
                : `Abort ${activeOperation}`}
            </Button>
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
