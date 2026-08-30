export interface Commit {
  hash: string;
  parents: string[];
  refs: string[];
  subject: string;
  author: string;
  timestamp: number;
}
