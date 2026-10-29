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
export type DeliveryAction =
  | { kind: "createAt"; name: string; revision: string; checkout: boolean }
  | { kind: "checkoutRemote"; name: string; reference: string }
  | { kind: "upstream"; name: string; reference: string }
  | { kind: "fetch"; remote: string; prune: boolean }
  | { kind: "pull"; strategy: PullStrategy }
  | { kind: "push" }
  | { kind: "force"; review: PushReview };
export type RunDelivery = (action: DeliveryAction) => Promise<boolean>;
