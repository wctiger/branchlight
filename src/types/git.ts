export interface GitOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type GitErrorCode =
  | "workingDirectoryUnavailable"
  | "processStartFailed"
  | "commandFailed"
  | "invalidRepositoryPath"
  | "repositoryUnavailable"
  | "invalidRepositoryResponse"
  | "invalidStatusResponse"
  | "invalidBranchesResponse"
  | "invalidStashesResponse"
  | "invalidHistoryResponse"
  | "invalidOperationInput"
  | "unknown";

export interface GitError {
  code: GitErrorCode;
  message: string;
  output?: GitOutput;
}
