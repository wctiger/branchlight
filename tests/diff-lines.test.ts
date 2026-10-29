import { expect, test } from "bun:test";
import { diffLines } from "../src/features/inspection/diff-lines";

test("diff numbering separates additions, deletions, context and metadata", () => {
  const lines = diffLines(
    "--- a/file\n+++ b/file\n@@ -4,2 +8,2 @@\n same\n--- removed\n+++ added\n\\ No newline at end of file\n",
  );
  expect(lines.map(({ old, next }) => [old, next])).toEqual([
    ["", ""],
    ["", ""],
    ["", ""],
    [4, 8],
    [5, ""],
    ["", 9],
    ["", ""],
    ["", ""],
  ]);
  expect(lines.filter((line) => line.hunk)).toHaveLength(1);
});

test("diff numbering resets at each hunk and handles empty original files", () => {
  const lines = diffLines(
    "@@ -0,0 +1,2 @@\n+one\n+two\n@@ -20 +30 @@\n-old\n+new",
  );
  expect(lines.map(({ old, next }) => [old, next])).toEqual([
    ["", ""],
    ["", 1],
    ["", 2],
    ["", ""],
    [20, ""],
    ["", 30],
  ]);
});
