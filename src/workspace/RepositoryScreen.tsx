import styles from "@/workspace/RepositoryScreen.module.css";
import changesStyles from "@/workspace/ChangesPanel.module.css";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { ChangesInspector } from "@/workspace/ChangesInspector";
import { RepositoryToolbar } from "@/workspace/RepositoryToolbar";
import { RepositoryMainContent } from "@/workspace/RepositoryMainContent";
import { useEffect, useRef, useState } from "react";
import { HistoryControls } from "@/features/history/HistoryControls";
import { BranchControls } from "@/features/DeliveryControls";
import {
  BranchPanel,
  type BranchesState,
} from "@/features/branches/BranchPanel";
import type { StashesState } from "@/features/stashes/StashPanel";
import {
  HistoryPanel,
  type HistoryState,
} from "@/features/history/HistoryPanel";
import { InspectionPanel } from "@/features/inspection/InspectionPanel";
import { ChangesPanel } from "@/workspace/ChangesPanel";
import { ConflictBanner } from "@/workspace/ConflictBanner";
import { ErrorNotice } from "@/workspace/ErrorNotice";
import type {
  AppOperation,
  OpenState,
  RepositoryStatusState,
} from "@/workspace/types";
import type { CommitOptions, RunDelivery } from "@/types/delivery";
import type { Repository } from "@/types/repository";
import type { GitError } from "@/types/git";
import type { Stash } from "@/types/stash";
import type { FileChange } from "@/types/status";

/** Frames the active repository status and repository-level actions. */
export function RepositoryScreen({
  repository,
  repositoryError,
  openState,
  statusState,
  branchesState,
  stashesState,
  historyState,
  operation,
  changeOperationError,
  branchOperationError,
  branchOperationNotice,
  remoteOperationError,
  stashOperationError,
  conflictOperationError,
  operationNotice,
  onOpenRepository,
  onRefresh,
  onStage,
  onUnstage,
  onCommit,
  onSwitchBranch,
  onCreateBranch,
  onRenameBranch,
  onDeleteBranch,
  onMergeBranch,
  onRebaseBranch,
  onAbortOperation,
  onDelivery,
  onCreateStash,
  onApplyStash,
  onPopStash,
  onDropStash,
  onDiscard,
}: {
  onDiscard: (change: FileChange) => void;
  repository: Repository;
  repositoryError: GitError | null;
  openState: OpenState;
  statusState: RepositoryStatusState;
  branchesState: BranchesState;
  stashesState: StashesState;
  historyState: HistoryState;
  operation: AppOperation;
  changeOperationError: GitError | null;
  branchOperationError: GitError | null;
  branchOperationNotice: string | null;
  remoteOperationError: GitError | null;
  stashOperationError: GitError | null;
  conflictOperationError: GitError | null;
  operationNotice: string | null;
  onOpenRepository: () => void;
  onRefresh: () => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (options: CommitOptions) => Promise<boolean>;
  onSwitchBranch: (branchName: string) => Promise<boolean>;
  onCreateBranch: (branchName: string) => Promise<boolean>;
  onRenameBranch: (oldName: string, newName: string) => Promise<boolean>;
  onDeleteBranch: (branchName: string) => Promise<boolean>;
  onMergeBranch: (sourceBranch: string) => Promise<boolean>;
  onRebaseBranch: (sourceBranch: string) => Promise<boolean>;
  onAbortOperation: (
    kind: "merge" | "rebase" | "cherryPick" | "revert",
  ) => void;
  onDelivery: RunDelivery;
  onCreateStash: (message: string) => Promise<boolean>;
  onApplyStash: (stash: Stash) => Promise<boolean>;
  onPopStash: (stash: Stash) => Promise<boolean>;
  onDropStash: (stash: Stash) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"history" | "diff">("history");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selectedFile, setSelectedFile] = useState<{
    change: FileChange;
    kind: string;
  } | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(310);
  const screen = useRef<HTMLElement>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        screen.current?.closest("[hidden]") ||
        document.querySelector('[role="dialog"]')
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      setMode("history");
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const [inspectionCommit, setInspectionCommit] = useState<string | null>(null);
  const status = statusState.state === "ready" ? statusState.status : null;
  const isRefreshing =
    statusState.state === "loading" ||
    (statusState.state === "ready" && statusState.isRefreshing) ||
    branchesState.state === "loading" ||
    (branchesState.state === "ready" && branchesState.isRefreshing) ||
    stashesState.state === "loading" ||
    (stashesState.state === "ready" && stashesState.isRefreshing) ||
    historyState.state === "loading" ||
    (historyState.state === "ready" && historyState.isRefreshing);
  const isMutating = operation.state !== "idle";
  const controlsDisabled = isMutating || openState !== "idle";
  const hasActiveRepositoryOperation =
    status !== null && status.operation !== "none";
  const busyBranchName =
    operation.state === "switching" ||
    operation.state === "creating" ||
    operation.state === "renaming" ||
    operation.state === "deleting" ||
    operation.state === "merging" ||
    operation.state === "rebasing"
      ? operation.branchName
      : null;

  return (
    <main ref={screen} className={styles["repository-screen"]}>
      <RepositoryToolbar
        repository={repository}
        status={status}
        statusState={statusState}
        isRefreshing={isRefreshing}
        isMutating={isMutating}
        hasActiveRepositoryOperation={hasActiveRepositoryOperation}
        openState={openState}
        onDelivery={onDelivery}
        onRefresh={onRefresh}
        onOpenRepository={onOpenRepository}
        onStash={() => {
          setInspectorOpen(true);
          requestAnimationFrame(() => {
            const details = screen.current?.querySelector<HTMLDetailsElement>(
              `.${changesStyles["stash-disclosure"]}`,
            );
            if (details) details.open = true;
            screen.current
              ?.querySelector<HTMLInputElement>('[name="stashMessage"]')
              ?.focus();
          });
        }}
      />

      {repositoryError && (
        <div>
          <ErrorNotice error={repositoryError} />
        </div>
      )}

      {remoteOperationError && (
        <div>
          <ErrorNotice
            title="Git couldn’t synchronize this repository"
            error={remoteOperationError}
          />
        </div>
      )}

      <div role="status" aria-live="polite">
        {operationNotice && (
          <div className={styles["repository-notice"]}>
            <Check aria-hidden="true" />
            <p>{operationNotice}</p>
          </div>
        )}
      </div>

      {status && (
        <ConflictBanner
          status={status}
          operation={operation}
          operationError={conflictOperationError}
          isRefreshing={isRefreshing}
          controlsDisabled={controlsDisabled}
          onRefresh={onRefresh}
          onAbort={onAbortOperation}
        />
      )}

      <div
        className={cn(
          styles["repository-body"],
          !inspectorOpen && styles["repository-body--inspector-hidden"],
        )}
        style={
          { "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties
        }
      >
        <BranchPanel
          state={branchesState}
          operationError={branchOperationError}
          operationNotice={branchOperationNotice}
          actionsDisabled={controlsDisabled || hasActiveRepositoryOperation}
          busyBranchName={busyBranchName}
          onRefresh={onRefresh}
          onSwitch={onSwitchBranch}
          onCreate={onCreateBranch}
          onRename={onRenameBranch}
          onDelete={onDeleteBranch}
          onMerge={onMergeBranch}
          onRebase={onRebaseBranch}
        >
          {branchesState.state === "ready" && (
            <BranchControls
              branches={branchesState.branches}
              commit={inspectionCommit}
              disabled={
                controlsDisabled || isRefreshing || hasActiveRepositoryOperation
              }
              run={onDelivery}
            />
          )}
        </BranchPanel>
        <RepositoryMainContent
          mode={mode}
          filePath={selectedFile?.change.path}
          inspectorOpen={inspectorOpen}
          onModeChange={setMode}
          onInspectorToggle={() => setInspectorOpen(!inspectorOpen)}
          history={
            <HistoryPanel
              renderActions={(commit) => (
                <HistoryControls
                  key={commit.hash}
                  commit={commit}
                  head={status?.branch.oid ?? null}
                  branch={status?.branch.name ?? null}
                  disabled={
                    controlsDisabled ||
                    isRefreshing ||
                    !status ||
                    status.branch.isDetached ||
                    hasActiveRepositoryOperation
                  }
                  run={onDelivery}
                />
              )}
              onSelectCommit={(hash) => {
                setSelectedFile(null);
                setInspectionCommit(hash);
              }}
              state={historyState}
              controlsDisabled={controlsDisabled}
              onRefresh={onRefresh}
            />
          }
          diff={
            <InspectionPanel
              path={repository.path}
              status={status}
              commit={inspectionCommit}
              selectedFile={selectedFile}
              disabled={controlsDisabled}
              onDiscard={onDiscard}
            />
          }
        />
        <ChangesInspector
          open={inspectorOpen}
          width={inspectorWidth}
          onWidthChange={setInspectorWidth}
        >
          <ChangesPanel
            onSelectFile={(change, kind) => {
              setSelectedFile({ change, kind });
              setMode("diff");
            }}
            state={statusState}
            stashesState={stashesState}
            controlsDisabled={controlsDisabled}
            onRefresh={onRefresh}
            operation={operation}
            operationError={changeOperationError}
            stashOperationError={stashOperationError}
            onStage={onStage}
            onUnstage={onUnstage}
            onCommit={onCommit}
            onCreateStash={onCreateStash}
            onApplyStash={onApplyStash}
            onPopStash={onPopStash}
            onDropStash={onDropStash}
          />
        </ChangesInspector>
      </div>
    </main>
  );
}
