export interface Branch {
  name: string;
  fullRef: string;
  commit: string | null;
  isCurrent: boolean;
  upstream: string | null;
  ahead?: number | null;
  behind?: number | null;
}

export interface Branches {
  local: Branch[];
  remote: Branch[];
}
