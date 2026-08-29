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

export interface RepositoryStatus {
  branch: BranchStatus;
  staged: FileChange[];
  unstaged: FileChange[];
  conflicts: FileChange[];
  stashCount: number;
}
