import type { GitError, GitOutput } from "./git";

export type PullStrategy = "merge" | "rebase" | "fastForwardOnly";
export interface PushReview {
  branch: string;
  localOid: string;
  remote: string;
  remoteRef: string;
  expectedOid: string;
  destinationId: string;
}
export interface CommitOptions {
  summary: string;
  body: string;
  skipHooks: boolean;
  pushAfterCommit: boolean;
}
export interface CommitResult {
  output: GitOutput;
  pushError: GitError | null;
}
export type HistoryAction =
  | { kind: "interactiveRebase"; revision: string; steps: RebaseStep[] }
  | { kind: "amend"; message: string }
  | { kind: "reword"; revision: string; message: string }
  | { kind: "cherryPick" | "revert"; revision: string }
  | { kind: "reset"; revision: string; mode: "soft" | "mixed" | "hard" };
export type DeliveryAction =
  | { kind: "submodule"; review: import("./submodules").SubmoduleReview }
  | { kind: "lfs"; action: import("./lfs").LfsAction }
  | { kind: "createTag"; name: string; revision: string; annotation: string | null }
  | { kind: "deleteTag"; name: string; expectedOid: string }
  | { kind: "history"; expectedHead: string; expectedBranch: string; action: HistoryAction }
  | { kind: "createAt"; name: string; revision: string; checkout: boolean }
  | { kind: "checkoutRemote"; name: string; reference: string }
  | { kind: "upstream"; name: string; reference: string }
  | { kind: "fetch"; remote: string; prune: boolean }
  | { kind: "pull"; strategy: PullStrategy }
  | { kind: "push" }
  | { kind: "force"; review: PushReview };
export type RunDelivery = (action: DeliveryAction) => Promise<boolean>;
export interface RebaseStep {
  hash: string;
  action: "pick" | "drop" | "squash" | "reword";
  message?: string | null;
}
