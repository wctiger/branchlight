/** Number only hunk contents, preserving Git metadata and no-newline markers. */
export function diffLines(text: string) {
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  return text.split("\n").map((text) => {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      oldRemaining = Number(hunk[2] ?? 1);
      newLine = Number(hunk[3]);
      newRemaining = Number(hunk[4] ?? 1);
    }
    let old: number | "" = "";
    let next: number | "" = "";
    if (
      !hunk &&
      (text.startsWith(" ") || text.startsWith("-")) &&
      oldRemaining > 0
    ) {
      old = oldLine++;
      oldRemaining--;
    }
    if (
      !hunk &&
      (text.startsWith(" ") || text.startsWith("+")) &&
      newRemaining > 0
    ) {
      next = newLine++;
      newRemaining--;
    }
    return { text, old, next, hunk: !!hunk };
  });
}
