export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typeChanged"
  | "untracked"
  | "conflicted";

export interface FileChange {
  path: string;
  originalPath: string | null;
  status: FileStatus;
}

export interface BranchStatus {
  name: string | null;
  oid: string | null;
  isDetached: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

export type RepositoryOperation =
  "none" | "merge" | "rebase" | "cherryPick" | "revert";

export interface RepositoryStatus {
  operation: RepositoryOperation;
  branch: BranchStatus;
  staged: FileChange[];
  unstaged: FileChange[];
  conflicts: FileChange[];
  stashCount: number;
}

/** Display text shared by operation banners, notices, and recovery errors. */
export const repositoryOperationLabels = {
  merge: "Merge",
  rebase: "Rebase",
  cherryPick: "Cherry-pick",
  revert: "Revert",
} satisfies Record<Exclude<RepositoryOperation, "none">, string>;
