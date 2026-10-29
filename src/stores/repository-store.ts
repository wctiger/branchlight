import { createStore } from "zustand/vanilla";
import type {
  OpenState,
  RepositoryStatusState,
  AppOperation,
} from "@/workspace/types";
import type { CommitOptions, DeliveryAction } from "@/types/delivery";
import {
  abortMerge,
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
import type { RunDelivery } from "@/types/delivery";
type StashMutation =
  | {
      kind: "create";
      message: string;
    }
  | {
      kind: "apply";
      stash: Stash;
    }
  | {
      kind: "pop";
      stash: Stash;
    }
  | {
      kind: "drop";
      stash: Stash;
    };
type BranchMutation =
  | {
      kind: "switch";
      branchName: string;
    }
  | {
      kind: "create";
      branchName: string;
    }
  | {
      kind: "rename";
      branchName: string;
      newName: string;
    }
  | {
      kind: "delete";
      branchName: string;
    };
export type RepositoryState = {
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
  onRefresh: () => Promise<void>;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (options: CommitOptions) => Promise<boolean>;
  onSwitchBranch: (branchName: string) => Promise<boolean>;
  onCreateBranch: (branchName: string) => Promise<boolean>;
  onRenameBranch: (oldName: string, newName: string) => Promise<boolean>;
  onDeleteBranch: (branchName: string) => Promise<boolean>;
  onMergeBranch: (sourceBranch: string) => Promise<boolean>;
  onRebaseBranch: (sourceBranch: string) => Promise<boolean>;
  onAbortOperation: (kind: "merge" | "rebase") => void;
  onDelivery: RunDelivery;
  onCreateStash: (message: string) => Promise<boolean>;
  onApplyStash: (stash: Stash) => Promise<boolean>;
  onPopStash: (stash: Stash) => Promise<boolean>;
  onDropStash: (stash: Stash) => Promise<boolean>;
};

/** One store per open repository; request counters and mutation guards never cross tabs. */
export function createRepositoryStore(
  repository: Repository,
  onOpen: () => void,
) {
  return createStore<RepositoryState>()((set, get) => {
    const setRepositoryStatus = (
      value:
        | RepositoryStatusState
        | ((current: RepositoryStatusState) => RepositoryStatusState),
    ) =>
      set((current) => ({
        statusState:
          typeof value === "function" ? value(current.statusState) : value,
      }));
    const setBranchesState = (
      value: BranchesState | ((current: BranchesState) => BranchesState),
    ) =>
      set((current) => ({
        branchesState:
          typeof value === "function" ? value(current.branchesState) : value,
      }));
    const setStashesState = (
      value: StashesState | ((current: StashesState) => StashesState),
    ) =>
      set((current) => ({
        stashesState:
          typeof value === "function" ? value(current.stashesState) : value,
      }));
    const setHistoryState = (
      value: HistoryState | ((current: HistoryState) => HistoryState),
    ) =>
      set((current) => ({
        historyState:
          typeof value === "function" ? value(current.historyState) : value,
      }));
    let statusRequestId = 0;
    let branchesRequestId = 0;
    let stashesRequestId = 0;
    let historyRequestId = 0;
    let repositoryMutationInFlight = false;

    /** Refreshes Git state while retaining the last successful snapshot on failure. */
    const refreshRepositoryStatus = async (repositoryPath: string) => {
      const requestId = ++statusRequestId;
      setRepositoryStatus((current) =>
        current.state === "ready"
          ? {
              ...current,
              isRefreshing: true,
              refreshError: null,
            }
          : {
              state: "loading",
            },
      );
      try {
        const status = await getRepositoryStatus(repositoryPath);
        if (requestId === statusRequestId) {
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
          if (requestId !== statusRequestId) {
            return current;
          }
          return current.state === "ready"
            ? {
                ...current,
                isRefreshing: false,
                refreshError: normalizedError,
              }
            : {
                state: "error",
                error: normalizedError,
              };
        });
      }
    };

    /** Refreshes branch refs while retaining the last successful snapshot on failure. */
    const refreshBranches = async (repositoryPath: string) => {
      const requestId = ++branchesRequestId;
      setBranchesState((current) =>
        current.state === "ready"
          ? {
              ...current,
              isRefreshing: true,
              refreshError: null,
            }
          : {
              state: "loading",
            },
      );
      try {
        const branches = await getBranches(repositoryPath);
        if (requestId === branchesRequestId) {
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
          if (requestId !== branchesRequestId) {
            return current;
          }
          return current.state === "ready"
            ? {
                ...current,
                isRefreshing: false,
                refreshError: normalizedError,
              }
            : {
                state: "error",
                error: normalizedError,
              };
        });
      }
    };

    /** Refreshes stash entries while retaining the last successful snapshot on failure. */
    const refreshStashes = async (repositoryPath: string) => {
      const requestId = ++stashesRequestId;
      setStashesState((current) =>
        current.state === "ready"
          ? {
              ...current,
              isRefreshing: true,
              refreshError: null,
            }
          : {
              state: "loading",
            },
      );
      try {
        const stashes = await getStashes(repositoryPath);
        if (requestId === stashesRequestId) {
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
          if (requestId !== stashesRequestId) {
            return current;
          }
          return current.state === "ready"
            ? {
                ...current,
                isRefreshing: false,
                refreshError: normalizedError,
              }
            : {
                state: "error",
                error: normalizedError,
              };
        });
      }
    };

    /** Refreshes bounded history while retaining the last successful snapshot on failure. */
    const refreshHistory = async (repositoryPath: string) => {
      const requestId = ++historyRequestId;
      setHistoryState((current) =>
        current.state === "ready"
          ? {
              ...current,
              isRefreshing: true,
              refreshError: null,
            }
          : {
              state: "loading",
            },
      );
      try {
        const commits = await getHistory(repositoryPath);
        if (requestId === historyRequestId) {
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
          if (requestId !== historyRequestId) {
            return current;
          }
          return current.state === "ready"
            ? {
                ...current,
                isRefreshing: false,
                refreshError: normalizedError,
              }
            : {
                state: "error",
                error: normalizedError,
              };
        });
      }
    };

    /** Refreshes every repository view after external or in-app Git changes. */
    const refreshRepositoryState = async (repositoryPath: string) => {
      await Promise.all([
        refreshRepositoryStatus(repositoryPath),
        refreshBranches(repositoryPath),
        refreshStashes(repositoryPath),
        refreshHistory(repositoryPath),
      ]);
    };

    /** Atomically prevents a second Git mutation before React can render disabled controls. */
    const beginRepositoryMutation = () => {
      if (repositoryMutationInFlight) {
        return false;
      }
      repositoryMutationInFlight = true;
      return true;
    };

    /** Refreshes every Git-backed view and always releases the mutation guard. */
    const finishRepositoryMutation = async (repositoryPath: string) => {
      try {
        await refreshRepositoryState(repositoryPath);
      } finally {
        repositoryMutationInFlight = false;
        set({
          operation: {
            state: "idle",
          },
        });
      }
    };

    /** Clears stale action feedback before a new command or explicit refresh. */
    const clearOperationFeedback = () =>
      set({
        changeOperationError: null,
        branchOperationError: null,
        branchOperationNotice: null,
        remoteOperationError: null,
        stashOperationError: null,
        conflictOperationError: null,
        operationNotice: null,
      });
    const handleDiscard = async (change: FileChange) => {
      const untracked = change.status === "untracked";
      if (!beginRepositoryMutation()) return;
      clearOperationFeedback();
      set({
        operation: {
          state: "discarding",
          path: change.path,
        },
      });
      try {
        await discardFile(
          repository.path,
          change.path,
          untracked ? "untracked" : "tracked",
        );
        set({
          operationNotice: `Discarded ${change.path}.`,
        });
      } catch (error) {
        set({
          changeOperationError: normalizeGitError(error),
        });
      }
      await finishRepositoryMutation(repository.path);
    };

    /** Runs one whole-file mutation and refreshes Git state after every attempt. */
    const handleFileOperation = async (
      kind: "stage" | "unstage",
      filePath: string,
    ) => {
      if (get().operation.state !== "idle" || !beginRepositoryMutation()) {
        return;
      }
      clearOperationFeedback();
      set({
        operation: {
          state: kind === "stage" ? "staging" : "unstaging",
          path: filePath,
        },
      });
      try {
        if (kind === "stage") {
          await stageFile(repository.path, filePath);
        } else {
          await unstageFile(repository.path, filePath);
        }
        set({
          operationNotice: `${kind === "stage" ? "Staged" : "Unstaged"} ${filePath}.`,
        });
      } catch (error) {
        set({
          changeOperationError: normalizeGitError(error),
        });
      }
      await finishRepositoryMutation(repository.path);
    };
    const handleCommit = async (options: CommitOptions): Promise<boolean> => {
      if (get().operation.state !== "idle" || !beginRepositoryMutation())
        return false;
      clearOperationFeedback();
      set({
        operation: {
          state: "committing",
        },
      });
      let committed = false;
      try {
        const result = await composeCommit(repository.path, options);
        committed = true;
        set({
          operationNotice: result.pushError
            ? "Commit succeeded and remains local; push failed. Use Push after resolving the error."
            : options.pushAfterCommit
              ? "Commit created and pushed successfully."
              : "Commit created successfully.",
        });
        if (result.pushError)
          set({
            remoteOperationError: result.pushError,
          });
      } catch (error) {
        set({
          changeOperationError: normalizeGitError(error),
        });
      }
      await finishRepositoryMutation(repository.path);
      return committed;
    };

    /** Runs a local branch mutation and refreshes all state after every attempt. */
    const handleBranchMutation = async (
      mutation: BranchMutation,
    ): Promise<boolean> => {
      const branchesState = get().branchesState;
      if (get().operation.state !== "idle" || repositoryMutationInFlight) {
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
        set({
          branchOperationError: {
            code: "invalidOperationInput",
            message:
              "Switch to another branch before deleting the current branch.",
          },
        });
        return false;
      }
      if (!beginRepositoryMutation()) {
        return false;
      }
      set({
        operation:
          mutation.kind === "switch"
            ? {
                state: "switching",
                branchName: mutation.branchName,
              }
            : mutation.kind === "create"
              ? {
                  state: "creating",
                  branchName: mutation.branchName,
                }
              : mutation.kind === "rename"
                ? {
                    state: "renaming",
                    branchName: mutation.branchName,
                  }
                : {
                    state: "deleting",
                    branchName: mutation.branchName,
                  },
      });
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
        set({
          branchOperationNotice:
            mutation.kind === "switch"
              ? `Switched to ${mutation.branchName}.`
              : mutation.kind === "create"
                ? `Created and switched to ${mutation.branchName}.`
                : mutation.kind === "rename"
                  ? `Renamed ${mutation.branchName} to ${mutation.newName}.`
                  : `Deleted ${mutation.branchName}.`,
        });
        succeeded = true;
      } catch (error) {
        set({
          branchOperationError: normalizeGitError(error),
        });
      }
      await finishRepositoryMutation(repository.path);
      return succeeded;
    };

    /** Merges or rebases the current branch using one validated local source branch. */
    const handleBranchIntegration = async (
      kind: "merge" | "rebase",
      sourceBranch: string,
    ): Promise<boolean> => {
      const branchesState = get().branchesState;
      if (get().operation.state !== "idle" || repositoryMutationInFlight) {
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
        set({
          branchOperationError: {
            code: "invalidOperationInput",
            message:
              "Choose a non-current local branch and a checked-out destination.",
          },
        });
        return false;
      }
      if (!beginRepositoryMutation()) {
        return false;
      }
      set({
        operation: {
          state: kind === "merge" ? "merging" : "rebasing",
          branchName: sourceBranch,
        },
      });
      let succeeded = false;
      try {
        if (kind === "merge") {
          await mergeBranch(repository.path, sourceBranch);
          set({
            branchOperationNotice: `Merged ${sourceBranch} into ${destinationBranch.name}.`,
          });
        } else {
          await rebaseOntoBranch(repository.path, sourceBranch);
          set({
            branchOperationNotice: `Rebased ${destinationBranch.name} onto ${sourceBranch}.`,
          });
        }
        succeeded = true;
      } catch (error) {
        set({
          branchOperationError: normalizeGitError(error),
        });
      }
      await finishRepositoryMutation(repository.path);
      return succeeded;
    };

    /** Aborts only the operation reported by Git and refreshes every view afterward. */
    const handleAbortOperation = async (kind: "merge" | "rebase") => {
      const statusState = get().statusState;
      if (get().operation.state !== "idle" || repositoryMutationInFlight) {
        return;
      }
      clearOperationFeedback();
      const activeOperation =
        statusState.state === "ready" ? statusState.status.operation : "none";
      if (activeOperation !== kind) {
        set({
          conflictOperationError: {
            code: "invalidOperationInput",
            message: `Git does not report an active ${kind} to abort. Refresh status and try again.`,
          },
        });
        return;
      }
      if (!beginRepositoryMutation()) {
        return;
      }
      set({
        operation: {
          state: kind === "merge" ? "abortingMerge" : "abortingRebase",
        },
      });
      try {
        if (kind === "merge") {
          await abortMerge(repository.path);
        } else {
          await abortRebase(repository.path);
        }
        set({
          operationNotice: `${kind === "merge" ? "Merge" : "Rebase"} aborted successfully.`,
        });
      } catch (error) {
        set({
          conflictOperationError: normalizeGitError(error),
        });
      }
      await finishRepositoryMutation(repository.path);
    };
    const handleDelivery = async (action: DeliveryAction): Promise<boolean> => {
      if (get().operation.state !== "idle" || !beginRepositoryMutation())
        return false;
      clearOperationFeedback();
      const branchAction =
        action.kind === "createAt" ||
        action.kind === "checkoutRemote" ||
        action.kind === "upstream";
      set({
        operation: branchAction
          ? {
              state: "creating",
              branchName: action.name,
            }
          : {
              state:
                action.kind === "fetch"
                  ? "fetching"
                  : action.kind === "pull"
                    ? "pulling"
                    : "pushing",
            },
      });
      let succeeded = false;
      try {
        switch (action.kind) {
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
        set({
          operationNotice: "Git operation completed successfully.",
        });
        succeeded = true;
      } catch (error) {
        if (branchAction)
          set({
            branchOperationError: normalizeGitError(error),
          });
        else
          set({
            remoteOperationError: normalizeGitError(error),
          });
      }
      await finishRepositoryMutation(repository.path);
      return succeeded;
    };

    /** Runs one stash mutation and refreshes Git-backed state even after conflicts. */
    const handleStashMutation = async (
      mutation: StashMutation,
    ): Promise<boolean> => {
      if (get().operation.state !== "idle" || !beginRepositoryMutation()) {
        return false;
      }
      clearOperationFeedback();
      set({
        operation:
          mutation.kind === "create"
            ? {
                state: "stashing",
              }
            : mutation.kind === "apply"
              ? {
                  state: "applyingStash",
                  stashRef: mutation.stash.reference,
                }
              : mutation.kind === "pop"
                ? {
                    state: "poppingStash",
                    stashRef: mutation.stash.reference,
                  }
                : {
                    state: "droppingStash",
                    stashRef: mutation.stash.reference,
                  },
      });
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
        set({
          operationNotice:
            mutation.kind === "create"
              ? "Stash created successfully."
              : mutation.kind === "apply"
                ? `${mutation.stash.reference} applied successfully.`
                : mutation.kind === "pop"
                  ? `${mutation.stash.reference} popped successfully.`
                  : `${mutation.stash.reference} dropped successfully.`,
        });
        succeeded = true;
      } catch (error) {
        set({
          stashOperationError: normalizeGitError(error),
        });
      }
      await finishRepositoryMutation(repository.path);
      return succeeded;
    };
    return {
      onDiscard: (change) => void handleDiscard(change),
      repository,
      repositoryError: null,
      openState: "idle",
      statusState: {
        state: "idle",
      },
      branchesState: {
        state: "idle",
      },
      stashesState: {
        state: "idle",
      },
      historyState: {
        state: "idle",
      },
      operation: {
        state: "idle",
      },
      changeOperationError: null,
      branchOperationError: null,
      branchOperationNotice: null,
      remoteOperationError: null,
      stashOperationError: null,
      conflictOperationError: null,
      operationNotice: null,
      onOpenRepository: () => void onOpen(),
      onRefresh: () => {
        clearOperationFeedback();
        return refreshRepositoryState(repository.path);
      },
      onStage: (path) => void handleFileOperation("stage", path),
      onUnstage: (path) => void handleFileOperation("unstage", path),
      onCommit: handleCommit,
      onSwitchBranch: (branchName) =>
        handleBranchMutation({
          kind: "switch",
          branchName,
        }),
      onCreateBranch: (branchName) =>
        handleBranchMutation({
          kind: "create",
          branchName,
        }),
      onRenameBranch: (branchName, newName) =>
        handleBranchMutation({
          kind: "rename",
          branchName,
          newName,
        }),
      onDeleteBranch: (branchName) =>
        handleBranchMutation({
          kind: "delete",
          branchName,
        }),
      onMergeBranch: (sourceBranch) =>
        handleBranchIntegration("merge", sourceBranch),
      onRebaseBranch: (sourceBranch) =>
        handleBranchIntegration("rebase", sourceBranch),
      onAbortOperation: (kind) => void handleAbortOperation(kind),
      onDelivery: handleDelivery,
      onCreateStash: (message) =>
        handleStashMutation({
          kind: "create",
          message,
        }),
      onApplyStash: (stash) =>
        handleStashMutation({
          kind: "apply",
          stash,
        }),
      onPopStash: (stash) =>
        handleStashMutation({
          kind: "pop",
          stash,
        }),
      onDropStash: (stash) =>
        handleStashMutation({
          kind: "drop",
          stash,
        }),
    };
  });
}
