import "./setup-dom";
import { expect, test } from "bun:test";
import { prepareDiff } from "../src/features/inspection/diff-model";
import type { TextDiff } from "../src/lib/tauri";

const patch =
  "diff --git a/file.ts b/file.ts\nindex 1111111..2222222 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n-const old = 1;\n+const next = 2;\n same\n";
const diff = (text: string, truncated = false): TextDiff => ({
  context: "HEAD → index",
  text,
  truncated,
  binary: false,
});

test("Pierre receives ordinary Git patches with stable old/new line coordinates", () => {
  const model = prepareDiff(diff(patch));
  expect(model.kind).toBe("parsed");
  if (model.kind !== "parsed") throw new Error("Expected a parsed patch");
  expect(model.files).toHaveLength(1);
  expect(model.files[0].name).toBe("file.ts");
  expect(model.files[0].hunks[0].additionStart).toBe(1);
  expect(model.files[0].hunks[0].deletionStart).toBe(1);
});

test("metadata-only renames remain visible instead of becoming no-changes messages", () => {
  const model = prepareDiff(
    diff(
      "diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n",
    ),
  );
  expect(model.kind).toBe("parsed");
  if (model.kind !== "parsed") throw new Error("Expected rename metadata");
  expect(model.files[0].name).toBe("new.txt");
  expect(model.files[0].prevName).toBe("old.txt");
});

test("truncated and combined conflict patches use an explicit raw fallback", () => {
  expect(prepareDiff(diff(patch, true))).toMatchObject({
    kind: "raw",
    reason: expect.stringContaining("incomplete"),
  });
  expect(
    prepareDiff(
      diff("diff --cc file.ts\n@@@ -1,2 -1,2 +1,6 @@@\n++<<<<<<< HEAD\n"),
    ),
  ).toMatchObject({
    kind: "raw",
    reason: expect.stringContaining("Combined conflict diff"),
  });
});

test("unknown patch formats stay available as raw output while empty diffs are explicit", () => {
  expect(
    prepareDiff(diff("unexpected output <script>unsafe()</script>")),
  ).toMatchObject({ kind: "raw" });
  expect(prepareDiff(diff(""))).toEqual({ kind: "empty" });
});
