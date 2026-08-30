import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";

import type { Branch, Branches } from "../../types/branch";
import type { GitError } from "../../types/git";

export type BranchesState =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "ready";
      branches: Branches;
      isRefreshing: boolean;
      refreshError: GitError | null;
    }
  | { state: "error"; error: GitError };

type BranchEditor =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "rename"; branch: Branch }
  | { mode: "delete"; branch: Branch }
  | { mode: "integrate"; source: Branch; destination: Branch };

interface BranchPanelProps {
  state: BranchesState;
  operationError: GitError | null;
  operationNotice: string | null;
  actionsDisabled: boolean;
  busyBranchName: string | null;
  onRefresh: () => void;
  onSwitch: (branchName: string) => Promise<boolean>;
  onCreate: (branchName: string) => Promise<boolean>;
  onRename: (oldName: string, newName: string) => Promise<boolean>;
  onDelete: (branchName: string) => Promise<boolean>;
  onMerge: (sourceBranch: string) => Promise<boolean>;
  onRebase: (sourceBranch: string) => Promise<boolean>;
}

/** Renders one selectable branch ref with checkout affordances for local refs. */
function BranchItem({
  branch,
  isSelected,
  isRemote,
  isBusy,
  disabled,
  isDropTarget,
  onSelect,
  onSwitch,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  branch: Branch;
  isSelected: boolean;
  isRemote: boolean;
  isBusy: boolean;
  disabled: boolean;
  isDropTarget: boolean;
  onSelect: () => void;
  onSwitch: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const commitLabel = branch.commit?.slice(0, 8) ?? "No commits";
  const trackingLabel = isRemote
    ? "Remote reference"
    : branch.upstream ?? (branch.commit ? "No upstream" : "No commits yet");

  return (
    <li>
      <button
        className={`branch-item${isSelected ? " branch-item--selected" : ""}${isDropTarget ? " branch-item--drop-target" : ""}`}
        type="button"
        title={
          isRemote
            ? `${branch.fullRef} · remote reference (read-only)`
            : branch.fullRef
        }
        aria-pressed={isSelected}
        aria-current={branch.isCurrent ? "true" : undefined}
        disabled={disabled && !isSelected}
        draggable={!isRemote && !branch.isCurrent && !disabled}
        onClick={onSelect}
        onDoubleClick={() => {
          if (!isRemote && !branch.isCurrent && !disabled) {
            onSwitch();
          }
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <span
          className={`branch-dot${branch.isCurrent ? " branch-dot--current" : ""}`}
          aria-hidden="true"
        />
        <span className="branch-item__identity">
          <strong>{branch.name}</strong>
          <span>{trackingLabel}</span>
        </span>
        {isBusy ? (
          <span className="small-spinner" aria-hidden="true" />
        ) : branch.isCurrent ? (
          <span className="branch-current-label">Current</span>
        ) : (
          <code>{commitLabel}</code>
        )}
      </button>
    </li>
  );
}

/** Displays compact, contextual Git errors in the constrained sidebar. */
function BranchError({ title, error }: { title: string; error: GitError }) {
  const details =
    error.output?.stderr.trim() || error.output?.stdout.trim() || undefined;

  return (
    <div className="branch-error" role="alert">
      <strong>{title}</strong>
      <p>{details ?? error.message}</p>
    </div>
  );
}

/** Renders local branch actions and remote refs as a read-only repository sidebar. */
export function BranchPanel({
  state,
  operationError,
  operationNotice,
  actionsDisabled,
  busyBranchName,
  onRefresh,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onMerge,
  onRebase,
}: BranchPanelProps) {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [editor, setEditor] = useState<BranchEditor>({ mode: "closed" });
  const [draftName, setDraftName] = useState("");
  const [draggedRef, setDraggedRef] = useState<string | null>(null);
  const integrationTriggerRef = useRef<HTMLButtonElement>(null);
  const integrationPrimaryActionRef = useRef<HTMLButtonElement>(null);
  const restoreIntegrationFocusRef = useRef(false);
  const branches = state.state === "ready" ? state.branches : null;
  const isRefreshing = state.state === "ready" && state.isRefreshing;
  const allBranches = useMemo(
    () => (branches ? [...branches.local, ...branches.remote] : []),
    [branches],
  );
  const selectedBranch = allBranches.find(
    (branch) => branch.fullRef === selectedRef,
  );
  const selectedLocalBranch = branches?.local.find(
    (branch) => branch.fullRef === selectedRef,
  );
  const currentBranch = branches?.local.find((branch) => branch.isCurrent);

  useEffect(() => {
    if (editor.mode === "integrate") {
      integrationPrimaryActionRef.current?.focus();
    } else if (restoreIntegrationFocusRef.current) {
      restoreIntegrationFocusRef.current = false;
      integrationTriggerRef.current?.focus();
    }
  }, [editor.mode]);

  useEffect(() => {
    if (!branches) {
      setSelectedRef(null);
      setEditor({ mode: "closed" });
      setDraggedRef(null);
      return;
    }

    if (
      editor.mode === "integrate" &&
      (!branches.local.some(
        (branch) => branch.fullRef === editor.source.fullRef,
      ) ||
        currentBranch?.fullRef !== editor.destination.fullRef)
    ) {
      setEditor({ mode: "closed" });
    }

    const selectionStillExists = allBranches.some(
      (branch) => branch.fullRef === selectedRef,
    );
    if (!selectionStillExists) {
      const fallback =
        branches.local.find((branch) => branch.isCurrent) ??
        branches.local[0] ??
        branches.remote[0];
      setSelectedRef(fallback?.fullRef ?? null);
      if (editor.mode !== "create") {
        setEditor({ mode: "closed" });
      }
    }
  }, [allBranches, branches, currentBranch?.fullRef, editor, selectedRef]);

  const openCreate = () => {
    setDraftName("");
    setEditor({ mode: "create" });
  };

  const openRename = () => {
    if (!selectedLocalBranch) {
      return;
    }
    setDraftName(selectedLocalBranch.name);
    setEditor({ mode: "rename", branch: selectedLocalBranch });
  };

  /** Opens the same explicit merge/rebase chooser for drag and keyboard input. */
  const openIntegration = (source: Branch) => {
    if (
      !currentBranch ||
      source.isCurrent ||
      actionsDisabled ||
      isRefreshing
    ) {
      return;
    }

    restoreIntegrationFocusRef.current = false;
    setSelectedRef(source.fullRef);
    setEditor({ mode: "integrate", source, destination: currentBranch });
  };

  /** Closes the integration chooser and restores its keyboard entry point. */
  const closeIntegration = () => {
    restoreIntegrationFocusRef.current = true;
    setEditor({ mode: "closed" });
  };

  /** Tracks only local non-current branches as valid drag sources. */
  const startBranchDrag = (
    event: DragEvent<HTMLButtonElement>,
    branch: Branch,
  ) => {
    if (branch.isCurrent || actionsDisabled || isRefreshing) {
      event.preventDefault();
      return;
    }

    setDraggedRef(branch.fullRef);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", branch.fullRef);
  };

  /** Allows a drop only when the target is the current local branch. */
  const allowCurrentBranchDrop = (
    event: DragEvent<HTMLButtonElement>,
    destination: Branch,
  ) => {
    if (!branches) {
      return;
    }
    const source = branches.local.find(
      (branch) => branch.fullRef === draggedRef,
    );
    if (destination.isCurrent && source && !source.isCurrent) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  };

  /** Converts a valid local-branch drop into the explicit action chooser. */
  const dropOnCurrentBranch = (
    event: DragEvent<HTMLButtonElement>,
    destination: Branch,
  ) => {
    event.preventDefault();
    if (!branches) {
      setDraggedRef(null);
      return;
    }
    const source = branches.local.find(
      (branch) => branch.fullRef === draggedRef,
    );
    setDraggedRef(null);
    if (destination.isCurrent && source && !source.isCurrent) {
      openIntegration(source);
    }
  };

  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const branchName = draftName.trim();
    if (!branchName || actionsDisabled) {
      return;
    }

    const succeeded =
      editor.mode === "create"
        ? await onCreate(branchName)
        : editor.mode === "rename"
          ? await onRename(editor.branch.name, branchName)
          : false;

    if (succeeded) {
      setSelectedRef(`refs/heads/${branchName}`);
      setEditor({ mode: "closed" });
    }
  };

  const confirmDelete = async () => {
    if (editor.mode !== "delete" || actionsDisabled) {
      return;
    }

    if (await onDelete(editor.branch.name)) {
      setEditor({ mode: "closed" });
    }
  };

  /** Runs the chosen integration semantics and closes the chooser afterward. */
  const integrateBranch = async (kind: "merge" | "rebase") => {
    if (editor.mode !== "integrate" || actionsDisabled) {
      return;
    }

    if (kind === "merge") {
      await onMerge(editor.source.name);
    } else {
      await onRebase(editor.source.name);
    }
    closeIntegration();
  };

  if (state.state === "idle" || state.state === "loading") {
    return (
      <aside className="branch-panel branch-panel--loading" aria-live="polite">
        <span className="workspace-spinner" aria-hidden="true" />
        <strong>Reading branches…</strong>
      </aside>
    );
  }

  if (state.state === "error") {
    return (
      <aside className="branch-panel branch-panel--error">
        <BranchError title="Git couldn’t load branches." error={state.error} />
        <button
          className="branch-text-button"
          type="button"
          disabled={actionsDisabled}
          onClick={onRefresh}
        >
          Try again
        </button>
      </aside>
    );
  }

  if (!branches) {
    return null;
  }

  return (
    <aside className="branch-panel" aria-labelledby="branches-title">
      <header className="branch-panel__header">
        <div>
          <p className="eyebrow">Repository refs</p>
          <h2 id="branches-title">Branches</h2>
        </div>
        <button
          className="branch-add-button"
          type="button"
          title="Create a local branch"
          aria-label="Create a local branch"
          disabled={actionsDisabled || isRefreshing}
          onClick={openCreate}
        >
          +
        </button>
      </header>

      {operationError ? (
        <BranchError
          title="Git couldn’t complete that branch action."
          error={operationError}
        />
      ) : (
        state.refreshError && (
          <BranchError
            title="Git couldn’t refresh branches."
            error={state.refreshError}
          />
        )
      )}

      {!operationError && operationNotice && (
        <div className="branch-notice" role="status">
          {operationNotice}
        </div>
      )}

      <div className="branch-groups">
        <section className="branch-group" aria-labelledby="local-branches-title">
          <div className="branch-group__heading">
            <h3 id="local-branches-title">Local</h3>
            <span>{branches.local.length}</span>
          </div>
          {branches.local.length === 0 ? (
            <p className="branch-group__empty">No local branches</p>
          ) : (
            <ul>
              {branches.local.map((branch) => (
                <BranchItem
                  key={branch.fullRef}
                  branch={branch}
                  isSelected={branch.fullRef === selectedRef}
                  isRemote={false}
                  isBusy={branch.name === busyBranchName}
                  disabled={actionsDisabled || isRefreshing}
                  isDropTarget={branch.isCurrent && draggedRef !== null}
                  onSelect={() => setSelectedRef(branch.fullRef)}
                  onSwitch={() => void onSwitch(branch.name)}
                  onDragStart={(event) => startBranchDrag(event, branch)}
                  onDragEnd={() => setDraggedRef(null)}
                  onDragOver={(event) => allowCurrentBranchDrop(event, branch)}
                  onDrop={(event) => dropOnCurrentBranch(event, branch)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="branch-group" aria-labelledby="remote-branches-title">
          <div className="branch-group__heading">
            <h3 id="remote-branches-title">Remote</h3>
            <span>{branches.remote.length}</span>
          </div>
          {branches.remote.length === 0 ? (
            <p className="branch-group__empty">No remote branches</p>
          ) : (
            <ul>
              {branches.remote.map((branch) => (
                <BranchItem
                  key={branch.fullRef}
                  branch={branch}
                  isSelected={branch.fullRef === selectedRef}
                  isRemote
                  isBusy={false}
                  disabled={actionsDisabled || isRefreshing}
                  isDropTarget={false}
                  onSelect={() => setSelectedRef(branch.fullRef)}
                  onSwitch={() => undefined}
                  onDragStart={(event) => event.preventDefault()}
                  onDragEnd={() => undefined}
                  onDragOver={() => undefined}
                  onDrop={() => undefined}
                />
              ))}
            </ul>
          )}
          <p className="branch-group__note">Remote refs are display-only.</p>
        </section>
      </div>

      {selectedLocalBranch && editor.mode === "closed" && (
        <div className="branch-actions" aria-label="Selected local branch actions">
          <button
            type="button"
            disabled={
              actionsDisabled || isRefreshing || selectedLocalBranch.isCurrent
            }
            onClick={() => void onSwitch(selectedLocalBranch.name)}
          >
            Switch
          </button>
          <button
            type="button"
            disabled={actionsDisabled || isRefreshing}
            onClick={openRename}
          >
            Rename
          </button>
          <button
            ref={integrationTriggerRef}
            type="button"
            disabled={
              actionsDisabled || isRefreshing || selectedLocalBranch.isCurrent
            }
            onClick={() => openIntegration(selectedLocalBranch)}
          >
            Merge / rebase…
          </button>
          <button
            className="branch-action--danger"
            type="button"
            title={
              selectedLocalBranch.isCurrent
                ? "The current branch cannot be deleted."
                : "Delete this branch only if Git reports it is fully merged."
            }
            disabled={
              actionsDisabled || isRefreshing || selectedLocalBranch.isCurrent
            }
            onClick={() =>
              setEditor({ mode: "delete", branch: selectedLocalBranch })
            }
          >
            Delete
          </button>
        </div>
      )}

      {(editor.mode === "create" || editor.mode === "rename") && (
        <form className="branch-editor" onSubmit={(event) => void submitName(event)}>
          <label htmlFor="branch-name">
            {editor.mode === "create" ? "New branch name" : "Rename branch"}
          </label>
          <input
            id="branch-name"
            name="branchName"
            type="text"
            value={draftName}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            disabled={actionsDisabled}
            placeholder="feature/my-change"
            onChange={(event) => setDraftName(event.target.value)}
          />
          <div>
            <button
              className="branch-editor__primary"
              type="submit"
              disabled={!draftName.trim() || actionsDisabled}
            >
              {editor.mode === "create" ? "Create & switch" : "Rename"}
            </button>
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => setEditor({ mode: "closed" })}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {editor.mode === "delete" && (
        <div
          className="branch-editor branch-editor--delete"
          role="alertdialog"
          aria-labelledby="branch-delete-title"
          aria-describedby="branch-delete-description"
        >
          <strong id="branch-delete-title">Delete {editor.branch.name}?</strong>
          <p id="branch-delete-description">
            Git will refuse if the branch is not fully merged.
          </p>
          <div>
            <button
              className="branch-editor__danger"
              type="button"
              disabled={actionsDisabled}
              onClick={() => void confirmDelete()}
            >
              Delete safely
            </button>
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => setEditor({ mode: "closed" })}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editor.mode === "integrate" && (
        <div
          className="branch-editor branch-editor--integrate"
          role="dialog"
          aria-labelledby="branch-integrate-title"
          aria-describedby="branch-integrate-description"
        >
          <strong id="branch-integrate-title">
            {editor.source.name} → {editor.destination.name}
          </strong>
          <p id="branch-integrate-description">
            Choose how the source branch should integrate with the current branch.
          </p>
          <div className="branch-integrate-actions">
            <button
              ref={integrationPrimaryActionRef}
              className="branch-editor__primary"
              type="button"
              disabled={actionsDisabled}
              onClick={() => void integrateBranch("merge")}
            >
              Merge {editor.source.name} into {editor.destination.name}
            </button>
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => void integrateBranch("rebase")}
            >
              Rebase {editor.destination.name} onto {editor.source.name}
            </button>
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={closeIntegration}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectedBranch && !selectedLocalBranch && (
        <div className="branch-selection-note">
          <strong>{selectedBranch.name}</strong>
          <span>Remote reference · read-only</span>
        </div>
      )}
    </aside>
  );
}
