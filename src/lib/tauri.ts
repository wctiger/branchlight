import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { GitError, GitErrorCode, GitOutput } from "../types/git";
import type { Repository } from "../types/repository";

const gitErrorCodes: GitErrorCode[] = [
  "workingDirectoryUnavailable",
  "processStartFailed",
  "commandFailed",
  "invalidRepositoryPath",
  "repositoryUnavailable",
  "invalidRepositoryResponse",
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

export async function chooseRepositoryFolder(): Promise<string | null> {
  const selectedPath = await open({
    title: "Open a Git Repository",
    directory: true,
    multiple: false,
    canCreateDirectories: false,
  });

  return typeof selectedPath === "string" ? selectedPath : null;
}

export function openRepository(path: string): Promise<Repository> {
  return invoke<Repository>("open_repository", { path });
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
