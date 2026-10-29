import styles from "@/workspace/ChangesPanel.module.css";
import sharedStyles from "@/styles/shared.module.css";
import { cn } from "@/lib/utils";
import { Plus, Minus, RefreshCw, LoaderCircle } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { CommitComposer } from "@/features/DeliveryControls";
import { StashPanel, type StashesState } from "@/features/stashes/StashPanel";
import { ErrorNotice } from "@/workspace/ErrorNotice";
import type { RepositoryStatusState, AppOperation } from "@/workspace/types";
import type { CommitOptions } from "@/types/delivery";
import type { GitError } from "@/types/git";
import type { Stash } from "@/types/stash";
import type { FileChange, FileStatus } from "@/types/status";

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
  onSelect,
}: {
  onSelect?: (change: FileChange) => void;
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
    <section className={cn(styles["change-section"], styles[`change-section--${tone}`])}>
      <header className={styles["change-section__header"]}>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className={styles["change-count"]} aria-label={`${changes.length} files`}>
          {changes.length}
        </span>
      </header>

      {changes.length === 0 ? (
        <p className={styles["change-section__empty"]}>{emptyMessage}</p>
      ) : (
        <ul className={styles["change-list"]}>
          {changes.map((change) => (
            <li
              key={`${change.status}:${change.path}:${change.originalPath ?? ""}`}
            >
              <span
                className={cn(styles["change-symbol"], styles[`change-symbol--${change.status}`])}
                title={fileStatusLabels[change.status]}
                aria-label={fileStatusLabels[change.status]}
              >
                {fileStatusSymbols[change.status]}
              </span>
              <button
                type="button"
                className={styles["change-path"]}
                onClick={() => onSelect?.(change)}
                title={change.path}
              >
                <code title={change.path}>{change.path}</code>
                {change.originalPath && (
                  <span title={change.originalPath}>
                    from <code>{change.originalPath}</code>
                  </span>
                )}
              </button>
              {action ? (
                <Button
                  variant="outline"
                  className={styles["change-action"]}
                  type="button"
                  disabled={actionsDisabled}
                  aria-label={`${action.label} ${change.path}`}
                  onClick={() => action.onClick(change.path)}
                >
                  {busyPath === change.path ? (
                    <LoaderCircle
                      className={sharedStyles["small-spinner"]}
                      aria-hidden="true"
                      data-icon="inline-start"
                    />
                  ) : action.direction === "stage" ? (
                    <Plus aria-hidden="true" data-icon="inline-start" />
                  ) : (
                    <Minus aria-hidden="true" data-icon="inline-start" />
                  )}
                  {busyPath === change.path ? action.busyLabel : action.label}
                </Button>
              ) : (
                <span className={styles["change-kind"]}>
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
export function ChangesPanel({
  onSelectFile,
  state,
  stashesState,
  controlsDisabled,
  onRefresh,
  operation,
  operationError,
  stashOperationError,
  onStage,
  onUnstage,
  onCommit,
  onCreateStash,
  onApplyStash,
  onPopStash,
  onDropStash,
}: {
  onSelectFile: (change: FileChange, kind: string) => void;
  state: RepositoryStatusState;
  stashesState: StashesState;
  controlsDisabled: boolean;
  onRefresh: () => void;
  operation: AppOperation;
  operationError: GitError | null;
  stashOperationError: GitError | null;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (options: CommitOptions) => Promise<boolean>;
  onCreateStash: (message: string) => Promise<boolean>;
  onApplyStash: (stash: Stash) => Promise<boolean>;
  onPopStash: (stash: Stash) => Promise<boolean>;
  onDropStash: (stash: Stash) => Promise<boolean>;
}) {
  const changesTitleId = useId();
  if (state.state === "idle" || state.state === "loading") {
    return (
      <section className={styles["status-loading"]} aria-live="polite">
        <LoaderCircle className={sharedStyles["workspace-spinner"]} aria-hidden="true" />
        <strong>Reading repository status…</strong>
        <p>Asking system Git for the latest working-tree state.</p>
      </section>
    );
  }

  if (state.state === "error") {
    return (
      <section className={styles["status-error"]}>
        <ErrorNotice
          error={state.error}
          title="Repository status couldn’t be refreshed"
        />
        <Button
          variant="outline"
          type="button"
          disabled={controlsDisabled}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" data-icon="inline-start" />
          Try again
        </Button>
      </section>
    );
  }

  const { status } = state;
  const changeCount =
    status.staged.length + status.unstaged.length + status.conflicts.length;
  const isMutating = operation.state !== "idle" || status.operation !== "none";
  const actionsDisabled = controlsDisabled || isMutating || state.isRefreshing;
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
    <section className={styles["repository-workspace"]} aria-labelledby={changesTitleId}>
      <header className={styles["workspace-heading"]}>
        <div>
          <p data-slot="eyebrow" className={sharedStyles["eyebrow"]}>Working tree</p>
          <h2 id={changesTitleId}>Repository changes</h2>
          <p>
            {changeCount === 0
              ? "Everything is clean and up to date."
              : `${changeCount} ${changeCount === 1 ? "change" : "changes"} reported by Git.`}
          </p>
        </div>
        <div className={styles["workspace-facts"]}>
          <span>{status.stashCount} stashed</span>
          <span>{changeCount} total</span>
        </div>
      </header>

      {(operationError || state.refreshError) && (
        <div className={sharedStyles["workspace-error"]}>
          <ErrorNotice
            error={operationError ?? state.refreshError!}
            title={
              operationError
                ? "Git couldn’t complete that action"
                : "Repository status couldn’t be refreshed"
            }
          />
          {state.refreshError && !operationError && (
            <Button
              variant="outline"
              type="button"
              disabled={state.isRefreshing || isMutating}
              onClick={onRefresh}
            >
              <RefreshCw aria-hidden="true" data-icon="inline-start" />
              Try again
            </Button>
          )}
        </div>
      )}

      <details className={styles["stash-disclosure"]}>
        <summary>Stashes</summary>
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
      </details>
      <div className={styles["changes-grid"]}>
        <ChangeSection
          title="Conflicts"
          description="Files that need manual resolution"
          emptyMessage="No conflicted files"
          changes={status.conflicts}
          tone="conflict"
          onSelect={(change) => onSelectFile(change, "unstaged")}
        />
        <ChangeSection
          title="Unstaged"
          description="Working-tree changes not in the index"
          emptyMessage="No unstaged changes"
          changes={status.unstaged}
          tone="unstaged"
          onSelect={(change) => onSelectFile(change, "unstaged")}
          action={{
            label: "Stage",
            busyLabel: "Staging…",
            direction: "stage",
            onClick: onStage,
          }}
          busyPath={operation.state === "staging" ? operation.path : undefined}
          actionsDisabled={actionsDisabled}
        />
        <ChangeSection
          title="Staged"
          description="Changes ready for the next commit"
          emptyMessage="No staged changes"
          changes={status.staged}
          tone="staged"
          onSelect={(change) => onSelectFile(change, "staged")}
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

      <CommitComposer
        disabled={actionsDisabled || status.conflicts.length > 0}
        staged={status.staged.length}
        onCommit={onCommit}
      />
    </section>
  );
}
