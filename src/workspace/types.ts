import type { GitError } from "@/types/git";
import type { RepositoryStatus } from "@/types/status";

export type OpenState = "idle" | "choosing" | "validating";

export type RepositoryStatusState =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "ready";
      status: RepositoryStatus;
      isRefreshing: boolean;
      refreshError: GitError | null;
    }
  | { state: "error"; error: GitError };

export type AppOperation =
  | { state: "idle" }
  | { state: "staging"; path: string }
  | { state: "unstaging"; path: string }
  | { state: "discarding"; path: string }
  | { state: "committing" }
  | { state: "editingHistory" }
  | { state: "abortingHistory" }
  | { state: "switching"; branchName: string }
  | { state: "creating"; branchName: string }
  | { state: "renaming"; branchName: string }
  | { state: "deleting"; branchName: string }
  | { state: "fetching" }
  | { state: "pulling" }
  | { state: "pushing" }
  | { state: "stashing" }
  | { state: "applyingStash"; stashRef: string }
  | { state: "poppingStash"; stashRef: string }
  | { state: "droppingStash"; stashRef: string }
  | { state: "merging"; branchName: string }
  | { state: "rebasing"; branchName: string }
  | { state: "abortingMerge" }
  | { state: "abortingRebase" }
  | { state: "recoveringRebase" }
  | { state: "resolvingConflict"; path: string }
  | { state: "tagging" }
  | { state: "lfs" }
  | { state: "launchingTool" };
