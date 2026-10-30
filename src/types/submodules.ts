export interface Submodule {
  name: string;
  path: string;
  url: string | null;
  branch: string | null;
  expectedOid: string | null;
  currentOid: string | null;
  initialized: boolean;
  dirty: boolean;
  error: string | null;
  commonDirectory: string | null;
}
export type SubmoduleAction =
  | { kind: "add"; path: string; source: string }
  | { kind: "edit"; path: string; url: string; branch: string | null }
  | { kind: "initialize" | "update" | "reset" | "remove"; path: string };
export interface SubmoduleReview {
  action: SubmoduleAction;
  token: string;
  path: string;
  parentHead: string | null;
  expectedOid: string | null;
  currentOid: string | null;
  effects: string;
}
