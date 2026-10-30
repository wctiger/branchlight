import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import type { TextDiff } from "@/lib/tauri";

export type DiffModel =
  | { kind: "empty" }
  | { kind: "raw"; reason: string }
  | { kind: "parsed"; files: FileDiffMetadata[] };

/** Only complete, ordinary patches are safe to interpret as a two-sided diff. */
export function prepareDiff(diff: TextDiff): DiffModel {
  if (!diff.text.trim()) return { kind: "empty" };
  if (diff.truncated)
    return {
      kind: "raw",
      reason:
        "Showing the captured patch as plain text because it is incomplete.",
    };
  if (/^(?:diff --(?:cc|combined) |@@@)/m.test(diff.text)) {
    return {
      kind: "raw",
      reason:
        "Combined conflict diff: showing Git’s patch as plain text. Resolve conflicts with an external Git tool.",
    };
  }
  try {
    const files = parsePatchFiles(diff.text, undefined, true).flatMap(
      (patch) => patch.files,
    );
    if (files.length) return { kind: "parsed", files };
  } catch {
    // Git settings or incomplete output can produce patches the renderer cannot parse.
  }
  return {
    kind: "raw",
    reason:
      "This patch format cannot be rendered. Showing Git’s original output as plain text.",
  };
}
