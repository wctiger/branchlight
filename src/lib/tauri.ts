import { invoke } from "@tauri-apps/api/core";

import type { GitError, GitErrorCode, GitOutput } from "../types/git";

const gitErrorCodes: GitErrorCode[] = [
  "workingDirectoryUnavailable",
  "processStartFailed",
  "commandFailed",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGitErrorCode(value: unknown): value is GitErrorCode {
  return (
    typeof value === "string" &&
    gitErrorCodes.some((errorCode) => errorCode === value)
  );
}

function isGitOutput(value: unknown): value is GitOutput {
  return (
    isRecord(value) &&
    typeof value.stdout === "string" &&
    typeof value.stderr === "string" &&
    (typeof value.exitCode === "number" || value.exitCode === null)
  );
}

export function getGitVersion(): Promise<GitOutput> {
  return invoke<GitOutput>("get_git_version");
}

export function normalizeGitError(error: unknown): GitError {
  if (typeof error === "string") {
    return { code: "unknown", message: error };
  }

  if (!isRecord(error)) {
    return {
      code: "unknown",
      message: "Branchlight could not read the response from system Git.",
    };
  }

  const code = isGitErrorCode(error.code) ? error.code : "unknown";
  const message =
    typeof error.message === "string"
      ? error.message
      : "Branchlight could not read the response from system Git.";
  const output = isGitOutput(error.output) ? error.output : undefined;

  return output ? { code, message, output } : { code, message };
}
