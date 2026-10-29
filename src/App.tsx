import { useCallback, useEffect, useRef, useState } from "react";
import { RepositoryScreen } from "@/workspace/RepositoryScreen";
import type {
  OpenState,
  RepositoryStatusState,
  AppOperation,
} from "@/workspace/types";
import type { CommitOptions, DeliveryAction } from "@/types/delivery";
import {
  abortMerge,
  abortHistoryOperation,
  executeHistoryAction,
  abortRebase,
  applyStash,
  composeCommit,
  createBranchAt,
  checkoutRemoteBranch,
  setBranchUpstream,
  forcePush,
  createBranch,
  createStash,
  deleteBranch,
  discardFile,
  dropStash,
  fetchRemote,
  getBranches,
  getHistory,
  getRepositoryStatus,
  getStashes,
  mergeBranch,
  normalizeGitError,
  popStash,
  pullRemote,
  pushRemote,
  rebaseOntoBranch,
  renameBranch,
  stageFile,
  switchBranch,
  unstageFile,
} from "@/lib/tauri";
import type { BranchesState } from "@/features/branches/BranchPanel";
import type { StashesState } from "@/features/stashes/StashPanel";
import type { HistoryState } from "@/features/history/HistoryPanel";
import type { GitError } from "@/types/git";
import type { Repository } from "@/types/repository";
import type { Stash } from "@/types/stash";
import type { FileChange } from "@/types/status";

type StashMutation =
  | { kind: "create"; message: string }
  | { kind: "apply"; stash: Stash }
  | { kind: "pop"; stash: Stash }
  | { kind: "drop"; stash: Stash };

type BranchMutation =
  | { kind: "switch"; branchName: string }
  | { kind: "create"; branchName: string }
  | { kind: "rename"; branchName: string; newName: string }
  | { kind: "delete"; branchName: string };

/** Owns system Git, repository, status, and mutation state for the app. */
export function RepositoryApp({
  initialRepository,
  onOpen,
  onFeedback,
}: {
  initialRepository: Repository;
  onOpen: () => void;
  onFeedback: (
    path: string,
    busy: boolean,
    error: boolean,
    dirty: boolean,
    branch?: string,
  ) => void;
}) {
  const repository = initialRepository;
  const repositoryError: GitError | null = null;
  const openState: OpenState = "idle";
  const [repositoryStatus, setRepositoryStatus] =
    useState<RepositoryStatusState>({ state: "idle" });
  const [branchesState, setBranchesState] = useState<BranchesState>({
    state: "idle",
  });
  const [stashesState, setStashesState] = useState<StashesState>({
    state: "idle",
  });
  const [historyState, setHistoryState] = useState<HistoryState>({
    state: "idle",
  });
  const [operation, setOperation] = useState<AppOperation>({
    state: "idle",
  });
  const [changeOperationError, setChangeOperationError] =
    useState<GitError | null>(null);
  const [branchOperationError, setBranchOperationError] =
    useState<GitError | null>(null);
  const [branchOperationNotice, setBranchOperationNotice] = useState<
    string | null
  >(null);
  const [remoteOperationError, setRemoteOperationError] =
    useState<GitError | null>(null);
  const [stashOperationError, setStashOperationError] =
    useState<GitError | null>(null);
  const [conflictOperationError, setConflictOperationError] =
    useState<GitError | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const statusRequestId = useRef(0);
  const branchesRequestId = useRef(0);
  const stashesRequestId = useRef(0);
  const historyRequestId = useRef(0);
  const repositoryMutationInFlight = useRef(false);

  /** Refreshes Git state while retaining the last successful snapshot on failure. */
  const refreshRepositoryStatus = useCallback(
    async (repositoryPath: string) => {
      const requestId = ++statusRequestId.current;
      setRepositoryStatus((current) =>
        current.state === "ready"
          ? { ...current, isRefreshing: true, refreshError: null }
          : { state: "loading" },
      );

      try {
        const status = await getRepositoryStatus(repositoryPath);
        if (requestId === statusRequestId.current) {
          setRepositoryStatus({
            state: "ready",
            status,
            isRefreshing: false,
            refreshError: null,
          });
        }
      } catch (error) {
        const normalizedError = normalizeGitError(error);
        setRepositoryStatus((current) => {
          if (requestId !== statusRequestId.current) {
            return current;
          }

          return current.state === "ready"
            ? {
                ...current,
                isRefreshing: false,
                refreshError: normalizedError,
              }
            : { state: "error", error: normalizedError };
        });
      }
    },
    [],
  );

  /** Refreshes branch refs while retaining the last successful snapshot on failure. */
  const refreshBranches = useCallback(async (repositoryPath: string) => {
    const requestId = ++branchesRequestId.current;
    setBranchesState((current) =>
      current.state === "ready"
        ? { ...current, isRefreshing: true, refreshError: null }
        : { state: "loading" },
    );

    try {
      const branches = await getBranches(repositoryPath);
      if (requestId === branchesRequestId.current) {
        setBranchesState({
          state: "ready",
          branches,
          isRefreshing: false,
          refreshError: null,
        });
      }
    } catch (error) {
      const normalizedError = normalizeGitError(error);
      setBranchesState((current) => {
        if (requestId !== branchesRequestId.current) {
          return current;
        }

        return current.state === "ready"
          ? {
              ...current,
              isRefreshing: false,
              refreshError: normalizedError,
            }
          : { state: "error", error: normalizedError };
      });
    }
  }, []);

  /** Refreshes stash entries while retaining the last successful snapshot on failure. */
  const refreshStashes = useCallback(async (repositoryPath: string) => {
    const requestId = ++stashesRequestId.current;
    setStashesState((current) =>
      current.state === "ready"
        ? { ...current, isRefreshing: true, refreshError: null }
        : { state: "loading" },
    );

    try {
      const stashes = await getStashes(repositoryPath);
      if (requestId === stashesRequestId.current) {
        setStashesState({
          state: "ready",
          stashes,
          isRefreshing: false,
          refreshError: null,
        });
      }
    } catch (error) {
      const normalizedError = normalizeGitError(error);
      setStashesState((current) => {
        if (requestId !== stashesRequestId.current) {
          return current;
        }

        return current.state === "ready"
          ? {
              ...current,
              isRefreshing: false,
              refreshError: normalizedError,
            }
          : { state: "error", error: normalizedError };
      });
    }
  }, []);

  /** Refreshes bounded history while retaining the last successful snapshot on failure. */
  const refreshHistory = useCallback(async (repositoryPath: string) => {
    const requestId = ++historyRequestId.current;
    setHistoryState((current) =>
      current.state === "ready"
        ? { ...current, isRefreshing: true, refreshError: null }
        : { state: "loading" },
    );

    try {
      const commits = await getHistory(repositoryPath);
      if (requestId === historyRequestId.current) {
        setHistoryState({
          state: "ready",
          commits,
          isRefreshing: false,
          refreshError: null,
        });
      }
    } catch (error) {
      const normalizedError = normalizeGitError(error);
      setHistoryState((current) => {
        if (requestId !== historyRequestId.current) {
          return current;
        }

        return current.state === "ready"
          ? {
              ...current,
              isRefreshing: false,
              refreshError: normalizedError,
            }
          : { state: "error", error: normalizedError };
      });
    }
  }, []);

  /** Refreshes every repository view after external or in-app Git changes. */
  const refreshRepositoryState = useCallback(
    async (repositoryPath: string) => {
      await Promise.all([
        refreshRepositoryStatus(repositoryPath),
        refreshBranches(repositoryPath),
        refreshStashes(repositoryPath),
        refreshHistory(repositoryPath),
      ]);
    },
    [refreshBranches, refreshHistory, refreshRepositoryStatus, refreshStashes],
  );

  /** Atomically prevents a second Git mutation before React can render disabled controls. */
  const beginRepositoryMutation = useCallback(() => {
    if (repositoryMutationInFlight.current) {
      return false;
    }
    repositoryMutationInFlight.current = true;
    onFeedback(
      repository.path,
      true,
      false,
      repositoryStatus.state === "ready" &&
        Boolean(
          repositoryStatus.status.staged.length ||
          repositoryStatus.status.unstaged.length ||
          repositoryStatus.status.conflicts.length,
        ),
      repositoryStatus.state === "ready"
        ? (repositoryStatus.status.branch.name ?? "Detached HEAD")
        : undefined,
    );
    return true;
  }, [onFeedback, repository.path, repositoryStatus]);

  /** Refreshes every Git-backed view and always releases the mutation guard. */
  const finishRepositoryMutation = useCallback(
    async (repositoryPath: string) => {
      try {
        await refreshRepositoryState(repositoryPath);
      } finally {
        repositoryMutationInFlight.current = false;
        setOperation({ state: "idle" });
      }
    },
    [refreshRepositoryState],
  );

  /** Clears stale action feedback before a new command or explicit refresh. */
  const clearOperationFeedback = useCallback(() => {
    setChangeOperationError(null);
    setBranchOperationError(null);
    setBranchOperationNotice(null);
    setRemoteOperationError(null);
    setStashOperationError(null);
    setConflictOperationError(null);
    setOperationNotice(null);
  }, []);

  useEffect(() => {
    if (repository) {
      void refreshRepositoryState(repository.path);
    }
  }, [refreshRepositoryState, repository]);

  const handleOpenRepository = onOpen;

  useEffect(() => {
    onFeedback(
      repository.path,
      operation.state !== "idle",
      Boolean(
        changeOperationError ||
        branchOperationError ||
        remoteOperationError ||
        stashOperationError ||
        conflictOperationError ||
        repositoryStatus.state === "error" ||
        branchesState.state === "error" ||
        stashesState.state === "error" ||
        historyState.state === "error" ||
        (repositoryStatus.state === "ready" && repositoryStatus.refreshError) ||
        (branchesState.state === "ready" && branchesState.refreshError) ||
        (stashesState.state === "ready" && stashesState.refreshError) ||
        (historyState.state === "ready" && historyState.refreshError),
      ),
      repositoryStatus.state === "ready" &&
        Boolean(
          repositoryStatus.status.staged.length ||
          repositoryStatus.status.unstaged.length ||
          repositoryStatus.status.conflicts.length,
        ),
      repositoryStatus.state === "ready"
        ? (repositoryStatus.status.branch.name ?? "Detached HEAD")
        : undefined,
    );
  }, [
    repository.path,
    operation.state,
    changeOperationError,
    branchOperationError,
    remoteOperationError,
    stashOperationError,
    conflictOperationError,
    repositoryStatus,
    branchesState,
    stashesState,
    historyState,
    onFeedback,
  ]);

  const handleDiscard = async (change: FileChange) => {
    const untracked = change.status === "untracked";
    if (!beginRepositoryMutation()) return;
    clearOperationFeedback();
    setOperation({ state: "discarding", path: change.path });
    try {
      await discardFile(
        repository.path,
        change.path,
        untracked ? "untracked" : "tracked",
      );
      setOperationNotice(`Discarded ${change.path}.`);
    } catch (error) {
      setChangeOperationError(normalizeGitError(error));
    }
    await finishRepositoryMutation(repository.path);
  };

  /** Runs one whole-file mutation and refreshes Git state after every attempt. */
  const handleFileOperation = useCallback(
    async (kind: "stage" | "unstage", filePath: string) => {
      if (
        !repository ||
        operation.state !== "idle" ||
        !beginRepositoryMutation()
      ) {
        return;
      }

      clearOperationFeedback();
      setOperation({
        state: kind === "stage" ? "staging" : "unstaging",
        path: filePath,
      });

      try {
        if (kind === "stage") {
          await stageFile(repository.path, filePath);
        } else {
          await unstageFile(repository.path, filePath);
        }
        setOperationNotice(
          `${kind === "stage" ? "Staged" : "Unstaged"} ${filePath}.`,
        );
      } catch (error) {
        setChangeOperationError(normalizeGitError(error));
      }
      await finishRepositoryMutation(repository.path);
    },
    [
      beginRepositoryMutation,
      clearOperationFeedback,
      finishRepositoryMutation,
      operation.state,
      repository,
    ],
  );

  const handleCommit = useCallback(
    async (options: CommitOptions): Promise<boolean> => {
      if (operation.state !== "idle" || !beginRepositoryMutation())
        return false;
      clearOperationFeedback();
      setOperation({ state: "committing" });
      let committed = false;
      try {
        const result = await composeCommit(repository.path, options);
        committed = true;
        setOperationNotice(
          result.pushError
            ? "Commit succeeded and remains local; push failed. Use Push after resolving the error."
            : options.pushAfterCommit
              ? "Commit created and pushed successfully."
              : "Commit created successfully.",
        );
        if (result.pushError) setRemoteOperationError(result.pushError);
      } catch (error) {
        setChangeOperationError(normalizeGitError(error));
      }
      await finishRepositoryMutation(repository.path);
      return committed;
    },
    [
      operation.state,
      beginRepositoryMutation,
      clearOperationFeedback,
      repository.path,
      finishRepositoryMutation,
    ],
  );

  /** Runs a local branch mutation and refreshes all state after every attempt. */
  const handleBranchMutation = useCallback(
    async (mutation: BranchMutation): Promise<boolean> => {
      if (
        !repository ||
        operation.state !== "idle" ||
        repositoryMutationInFlight.current
      ) {
        return false;
      }

      clearOperationFeedback();
      const selectedBranch =
        branchesState.state === "ready"
          ? branchesState.branches.local.find(
              (branch) => branch.name === mutation.branchName,
            )
          : undefined;
      if (mutation.kind === "delete" && selectedBranch?.isCurrent) {
        setBranchOperationError({
          code: "invalidOperationInput",
          message:
            "Switch to another branch before deleting the current branch.",
        });
        return false;
      }
      if (!beginRepositoryMutation()) {
        return false;
      }

      setOperation(
        mutation.kind === "switch"
          ? { state: "switching", branchName: mutation.branchName }
          : mutation.kind === "create"
            ? { state: "creating", branchName: mutation.branchName }
            : mutation.kind === "rename"
              ? { state: "renaming", branchName: mutation.branchName }
              : { state: "deleting", branchName: mutation.branchName },
      );

      let succeeded = false;
      try {
        if (mutation.kind === "switch") {
          await switchBranch(repository.path, mutation.branchName);
        } else if (mutation.kind === "create") {
          await createBranch(repository.path, mutation.branchName);
        } else if (mutation.kind === "rename") {
          await renameBranch(
            repository.path,
            mutation.branchName,
            mutation.newName,
          );
        } else {
          await deleteBranch(repository.path, mutation.branchName);
        }

        setBranchOperationNotice(
          mutation.kind === "switch"
            ? `Switched to ${mutation.branchName}.`
            : mutation.kind === "create"
              ? `Created and switched to ${mutation.branchName}.`
              : mutation.kind === "rename"
                ? `Renamed ${mutation.branchName} to ${mutation.newName}.`
                : `Deleted ${mutation.branchName}.`,
        );
        succeeded = true;
      } catch (error) {
        setBranchOperationError(normalizeGitError(error));
      }
      await finishRepositoryMutation(repository.path);
      return succeeded;
    },
    [
      beginRepositoryMutation,
      branchesState,
      clearOperationFeedback,
      finishRepositoryMutation,
      operation.state,
      repository,
    ],
  );

  /** Merges or rebases the current branch using one validated local source branch. */
  const handleBranchIntegration = useCallback(
    async (
      kind: "merge" | "rebase",
      sourceBranch: string,
    ): Promise<boolean> => {
      if (
        !repository ||
        operation.state !== "idle" ||
        repositoryMutationInFlight.current
      ) {
        return false;
      }

      clearOperationFeedback();
      const destinationBranch =
        branchesState.state === "ready"
          ? branchesState.branches.local.find((branch) => branch.isCurrent)
          : undefined;
      const source =
        branchesState.state === "ready"
          ? branchesState.branches.local.find(
              (branch) => branch.name === sourceBranch && !branch.isCurrent,
            )
          : undefined;
      if (!source || !destinationBranch) {
        setBranchOperationError({
          code: "invalidOperationInput",
          message:
            "Choose a non-current local branch and a checked-out destination.",
        });
        return false;
      }
      if (!beginRepositoryMutation()) {
        return false;
      }

      setOperation({
        state: kind === "merge" ? "merging" : "rebasing",
        branchName: sourceBranch,
      });

      let succeeded = false;
      try {
        if (kind === "merge") {
          await mergeBranch(repository.path, sourceBranch);
          setBranchOperationNotice(
            `Merged ${sourceBranch} into ${destinationBranch.name}.`,
          );
        } else {
          await rebaseOntoBranch(repository.path, sourceBranch);
          setBranchOperationNotice(
            `Rebased ${destinationBranch.name} onto ${sourceBranch}.`,
          );
        }
        succeeded = true;
      } catch (error) {
        setBranchOperationError(normalizeGitError(error));
      }

      await finishRepositoryMutation(repository.path);
      return succeeded;
    },
    [
      beginRepositoryMutation,
      branchesState,
      clearOperationFeedback,
      finishRepositoryMutation,
      operation.state,
      repository,
    ],
  );

  /** Aborts only the operation reported by Git and refreshes every view afterward. */
  const handleAbortOperation = useCallback(
    async (kind: "merge" | "rebase" | "cherryPick" | "revert") => {
      if (
        !repository ||
        operation.state !== "idle" ||
        repositoryMutationInFlight.current
      ) {
        return;
      }

      clearOperationFeedback();
      const activeOperation =
        repositoryStatus.state === "ready"
          ? repositoryStatus.status.operation
          : "none";
      if (activeOperation !== kind) {
        setConflictOperationError({
          code: "invalidOperationInput",
          message: `Git does not report an active ${kind} to abort. Refresh status and try again.`,
        });
        return;
      }
      if (!beginRepositoryMutation()) {
        return;
      }

      setOperation({
        state:
          kind === "merge"
            ? "abortingMerge"
            : kind === "rebase"
              ? "abortingRebase"
              : "abortingHistory",
      });

      try {
        if (kind === "merge") {
          await abortMerge(repository.path);
        } else if (kind === "rebase") {
          await abortRebase(repository.path);
        } else {
          await abortHistoryOperation(repository.path, kind);
        }
        setOperationNotice(`${kind} aborted successfully.`);
      } catch (error) {
        setConflictOperationError(normalizeGitError(error));
      }

      await finishRepositoryMutation(repository.path);
    },
    [
      beginRepositoryMutation,
      clearOperationFeedback,
      finishRepositoryMutation,
      operation.state,
      repository,
      repositoryStatus,
    ],
  );

  const handleDelivery = useCallback(
    async (action: DeliveryAction): Promise<boolean> => {
      if (operation.state !== "idle" || !beginRepositoryMutation())
        return false;
      clearOperationFeedback();
      const branchAction =
        action.kind === "createAt" ||
        action.kind === "checkoutRemote" ||
        action.kind === "upstream";
      setOperation(
        action.kind === "history"
          ? { state: "editingHistory" }
          : branchAction
            ? { state: "creating", branchName: action.name }
            : {
                state:
                  action.kind === "fetch"
                    ? "fetching"
                    : action.kind === "pull"
                      ? "pulling"
                      : "pushing",
              },
      );
      let succeeded = false;
      try {
        switch (action.kind) {
          case "history":
            await executeHistoryAction(
              repository.path,
              action.expectedHead,
              action.expectedBranch,
              action.action,
            );
            break;
          case "createAt":
            await createBranchAt(
              repository.path,
              action.name,
              action.revision,
              action.checkout,
            );
            break;
          case "checkoutRemote":
            await checkoutRemoteBranch(
              repository.path,
              action.name,
              action.reference,
            );
            break;
          case "upstream":
            await setBranchUpstream(
              repository.path,
              action.name,
              action.reference,
            );
            break;
          case "fetch":
            await fetchRemote(repository.path, action.remote, action.prune);
            break;
          case "pull":
            await pullRemote(repository.path, action.strategy);
            break;
          case "push":
            await pushRemote(repository.path);
            break;
          case "force":
            await forcePush(repository.path, action.review);
            break;
        }
        setOperationNotice("Git operation completed successfully.");
        succeeded = true;
      } catch (error) {
        if (action.kind === "history")
          setConflictOperationError(normalizeGitError(error));
        else if (branchAction)
          setBranchOperationError(normalizeGitError(error));
        else setRemoteOperationError(normalizeGitError(error));
      }
      await finishRepositoryMutation(repository.path);
      return succeeded;
    },
    [
      operation.state,
      beginRepositoryMutation,
      clearOperationFeedback,
      repository.path,
      finishRepositoryMutation,
    ],
  );

  /** Runs one stash mutation and refreshes Git-backed state even after conflicts. */
  const handleStashMutation = useCallback(
    async (mutation: StashMutation): Promise<boolean> => {
      if (
        !repository ||
        operation.state !== "idle" ||
        !beginRepositoryMutation()
      ) {
        return false;
      }

      clearOperationFeedback();
      setOperation(
        mutation.kind === "create"
          ? { state: "stashing" }
          : mutation.kind === "apply"
            ? { state: "applyingStash", stashRef: mutation.stash.reference }
            : mutation.kind === "pop"
              ? { state: "poppingStash", stashRef: mutation.stash.reference }
              : { state: "droppingStash", stashRef: mutation.stash.reference },
      );

      let succeeded = false;
      try {
        if (mutation.kind === "create") {
          await createStash(repository.path, mutation.message);
        } else if (mutation.kind === "apply") {
          await applyStash(repository.path, mutation.stash);
        } else if (mutation.kind === "pop") {
          await popStash(repository.path, mutation.stash);
        } else {
          await dropStash(repository.path, mutation.stash);
        }
        setOperationNotice(
          mutation.kind === "create"
            ? "Stash created successfully."
            : mutation.kind === "apply"
              ? `${mutation.stash.reference} applied successfully.`
              : mutation.kind === "pop"
                ? `${mutation.stash.reference} popped successfully.`
                : `${mutation.stash.reference} dropped successfully.`,
        );
        succeeded = true;
      } catch (error) {
        setStashOperationError(normalizeGitError(error));
      }

      await finishRepositoryMutation(repository.path);
      return succeeded;
    },
    [
      beginRepositoryMutation,
      clearOperationFeedback,
      finishRepositoryMutation,
      operation.state,
      repository,
    ],
  );

  if (repository) {
    return (
      <RepositoryScreen
        onDiscard={(change) => void handleDiscard(change)}
        repository={repository}
        repositoryError={repositoryError}
        openState={openState}
        statusState={repositoryStatus}
        branchesState={branchesState}
        stashesState={stashesState}
        historyState={historyState}
        operation={operation}
        changeOperationError={changeOperationError}
        branchOperationError={branchOperationError}
        branchOperationNotice={branchOperationNotice}
        remoteOperationError={remoteOperationError}
        stashOperationError={stashOperationError}
        conflictOperationError={conflictOperationError}
        operationNotice={operationNotice}
        onOpenRepository={() => void handleOpenRepository()}
        onRefresh={() => {
          clearOperationFeedback();
          void refreshRepositoryState(repository.path);
        }}
        onStage={(path) => void handleFileOperation("stage", path)}
        onUnstage={(path) => void handleFileOperation("unstage", path)}
        onCommit={handleCommit}
        onSwitchBranch={(branchName) =>
          handleBranchMutation({ kind: "switch", branchName })
        }
        onCreateBranch={(branchName) =>
          handleBranchMutation({ kind: "create", branchName })
        }
        onRenameBranch={(branchName, newName) =>
          handleBranchMutation({ kind: "rename", branchName, newName })
        }
        onDeleteBranch={(branchName) =>
          handleBranchMutation({ kind: "delete", branchName })
        }
        onMergeBranch={(sourceBranch) =>
          handleBranchIntegration("merge", sourceBranch)
        }
        onRebaseBranch={(sourceBranch) =>
          handleBranchIntegration("rebase", sourceBranch)
        }
        onAbortOperation={(kind) => void handleAbortOperation(kind)}
        onDelivery={handleDelivery}
        onCreateStash={(message) =>
          handleStashMutation({ kind: "create", message })
        }
        onApplyStash={(stash) => handleStashMutation({ kind: "apply", stash })}
        onPopStash={(stash) => handleStashMutation({ kind: "pop", stash })}
        onDropStash={(stash) => handleStashMutation({ kind: "drop", stash })}
      />
    );
  }

  return null;
}
