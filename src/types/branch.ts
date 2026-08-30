export interface Branch {
  name: string;
  fullRef: string;
  commit: string | null;
  isCurrent: boolean;
  upstream: string | null;
}

export interface Branches {
  local: Branch[];
  remote: Branch[];
}
