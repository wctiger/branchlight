import { usePanelWidth } from "@/workspace/usePanelWidth";
import { PaneDivider } from "@/workspace/PaneDivider";
import type { FileChange } from "@/types/status";
import { useRepositoryStore } from "@/stores/repository-context";
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
import { BranchPanel } from "@/features/branches/BranchPanel";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import { TagsPanel } from "@/features/history/TagsPanel";
import { CommitSearch } from "@/features/history/CommitSearch";
import { InspectionPanel } from "@/features/inspection/InspectionPanel";
import { ChangesPanel } from "@/workspace/ChangesPanel";
import { ConflictBanner } from "@/workspace/ConflictBanner";
import { ErrorNotice } from "@/workspace/ErrorNotice";
import { SubmodulesPanel } from "@/features/SubmodulesPanel";
import { useWorkspaceStore } from "@/stores/workspace-context";
import { ExternalTools } from "@/features/ExternalTools";

/** Frames the active repository status and repository-level actions. */
export function RepositoryScreen() {
  const addRepository = useWorkspaceStore(state => state.addRepository);
  const {
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
    onRecoverRebase,
    onDelivery,
    onCreateStash,
    onApplyStash,
    onPopStash,
    onDropStash,
    onDiscard,
    onSaveConflict,
    onLaunchExternalTool,
  } = useRepositoryStore((state) => state);
  const [mode, setMode] = useState<"history" | "diff">("history");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selectedFile, setSelectedFile] = useState<{
    change: FileChange;
    kind: string;
  } | null>(null);
  const [inspectorWidth, setInspectorWidth] = usePanelWidth("branchlight.inspectorWidth", 310, 300, 420);
  const [branchWidth, setBranchWidth] = usePanelWidth("branchlight.branchWidth", 230, 220, 360);
  const body = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  const branchMax = bodyWidth > 0
    ? Math.max(220, Math.min(360, bodyWidth - 480 - (inspectorOpen ? inspectorWidth : 0)))
    : 360;
  const inspectorMax = bodyWidth > 0
    ? Math.max(300, Math.min(420, bodyWidth - branchWidth - 480))
    : 420;
  useEffect(() => {
    const element = body.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let previousWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (!width || width === previousWidth) return;
      previousWidth = width;
      setBodyWidth(width);
      // Preserve the main column on resize. The persistent toggle can explicitly reopen it.
      if (width < branchWidth + 480 + inspectorWidth) setInspectorOpen(false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [branchWidth, inspectorWidth]);
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
  const [displayedFile, setDisplayedFile] = useState<{ path: string; kind: string | null }>({
    path: "",
    kind: null,
  });
  const currentFile = displayedFile.kind === "staged"
    ? status?.staged.find(file => file.path === displayedFile.path)
    : displayedFile.kind === "unstaged"
      ? status?.conflicts.find(file => file.path === displayedFile.path)
        ?? status?.unstaged.find(file => file.path === displayedFile.path)
      : undefined;
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
    <main ref={screen} data-repository-context={repository.path} data-selected-file={currentFile?.path} className={styles["repository-screen"]}>
      <RepositoryToolbar
        submodules={<SubmodulesPanel path={repository.path} disabled={controlsDisabled || isRefreshing || hasActiveRepositoryOperation} run={onDelivery} error={conflictOperationError} onOpened={addRepository} />}
        externalTools={<ExternalTools path={repository.path} file={currentFile?.path ?? null}
          kind={currentFile ? displayedFile.kind : null} conflicted={currentFile?.status === "conflicted"}
          disabled={controlsDisabled || isRefreshing} launch={onLaunchExternalTool} refresh={onRefresh} />}
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
          onRecoverRebase={onRecoverRebase}
        />
      )}

      <div
        ref={body}
        className={cn(
          styles["repository-body"],
          !inspectorOpen && styles["repository-body--inspector-hidden"],
        )}
        style={
          { "--inspector-width": `${inspectorWidth}px`, "--branch-width": `${branchWidth}px` } as React.CSSProperties
        }
      >
        <div className={styles["branch-column"]}>
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
            <TagsPanel
              path={repository.path}
              revision={inspectionCommit ?? status?.branch.oid ?? null}
              disabled={controlsDisabled || isRefreshing}
              refreshKey={status}
              run={onDelivery}
              onInspectCommit={(hash) => {
                setSelectedFile(null);
                setInspectionCommit(hash);
                setMode("diff");
              }}
            />
          </BranchPanel>
          <PaneDivider label="Branch sidebar width" width={branchWidth} min={220} max={branchMax} onWidthChange={setBranchWidth} />
        </div>
        <RepositoryMainContent
          mode={mode}
          filePath={displayedFile.path || undefined}
          inspectorOpen={inspectorOpen}
          onModeChange={setMode}
          onInspectorToggle={() => setInspectorOpen(!inspectorOpen)}
          history={
            <HistoryPanel
              onInspectCommit={(hash) => {
                setSelectedFile(null);
                setInspectionCommit(hash);
                setMode("diff");
              }}
              search={<CommitSearch path={repository.path} refreshKey={historyState} onSelect={(hash) => {
                setSelectedFile(null);
                setInspectionCommit(hash);
                setMode("diff");
              }} />}
              renderActions={(commit) => (
                <HistoryControls
                  key={commit.hash}
                  path={repository.path}
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
              onSelectFile={setSelectedFile}
              onDisplayFile={setDisplayedFile}
              disabled={controlsDisabled}
              onDiscard={onDiscard}
              onStage={onStage}
              onUnstage={onUnstage}
              onSaveConflict={onSaveConflict}
            />
          }
        />
        <ChangesInspector
          open={inspectorOpen}
          width={inspectorWidth}
          maxWidth={inspectorMax}
          onWidthChange={setInspectorWidth}
        >
          <ChangesPanel
            currentKind={displayedFile.kind}
            currentFile={mode === "diff" ? currentFile : undefined}
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
