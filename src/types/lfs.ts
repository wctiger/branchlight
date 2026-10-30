export interface LfsState {
  available: boolean;
  version: string;
  filterConfigured: boolean;
  hookPath: string;
  hookInstalled: boolean;
  storagePath: string;
  pruneAllowed: boolean;
  pruneReason: string;
  patterns: {
    pattern: string;
    source: string;
    tracked: boolean;
    lockable: boolean;
  }[];
  files: {
    name: string;
    oid: string;
    size: number;
    checkout: boolean;
    downloaded: boolean;
  }[];
  head: string | null;
}
export interface LfsProgress {
  active: boolean;
  message: string;
}
export interface LfsPruneReview {
  report: string;
  token: string;
}
export type LfsAction =
  | { kind: "initialize" }
  | { kind: "track" | "untrack"; directory: string; pattern: string }
  | { kind: "fetch" | "pull" | "push"; remote: string; expectedHead: string }
  | { kind: "checkout"; expectedHead: string }
  | { kind: "prune"; token: string };
