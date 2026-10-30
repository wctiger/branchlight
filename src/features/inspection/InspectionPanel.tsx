import styles from "@/features/inspection/InspectionPanel.module.css";
import { OperationDialog } from "@/components/operation-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiffRenderBoundary } from "@/features/inspection/DiffRenderBoundary";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

const DiffViewer = lazy(() => import("@/features/inspection/DiffViewer"));
const ConflictResolver = lazy(() => import("@/features/inspection/ConflictResolver"));
import {
  compareRevisions,
  getTextDiff,
  getFileBlame,
  getFileHistory,
  normalizeGitError,
} from "@/lib/tauri";
import type { Comparison, FileCommit, TextDiff } from "@/lib/tauri";
import type { RepositoryStatus, FileChange } from "@/types/status";

type BlameLine = {
  hash: string;
  author: string;
  summary: string;
  number: string;
  text: string;
};
function parseBlame(text: string): BlameLine[] {
  const result: BlameLine[] = [];
  let hash = "",
    author = "",
    summary = "",
    number = "";
  for (const line of text.split("\n")) {
    const header = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(line);
    if (header) {
      hash = header[1];
      number = header[2];
      author = "";
      summary = "";
    } else if (line.startsWith("author ")) author = line.slice(7);
    else if (line.startsWith("summary ")) summary = line.slice(8);
    else if (line.startsWith("\t"))
      result.push({ hash, author, summary, number, text: line.slice(1) });
  }
  return result;
}
export function InspectionPanel({
  path,
  status,
  commit,
  disabled,
  onDiscard,
  onSaveConflict,
  selectedFile,
}: {
  selectedFile?: { change: FileChange; kind: string } | null;
  path: string;
  status: RepositoryStatus | null;
  commit: string | null;
  disabled: boolean;
  onDiscard: (change: FileChange) => void;
  onSaveConflict?: (snapshot: import("@/lib/tauri").ConflictFile, output: string, markResolved: boolean) => Promise<boolean>;
}) {
  const [discardSelection, setDiscardSelection] = useState<FileChange | null>(
    null,
  );
  const [base, setBase] = useState("HEAD");
  const [target, setTarget] = useState("HEAD");
  const [file, setFile] = useState("");
  const [revision, setRevision] = useState("HEAD");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [diff, setDiff] = useState<TextDiff | null>(null);
  const [history, setHistory] = useState<FileCommit[] | null>(null);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  function invalidate() {
    request.current++;
    setLoading(false);
    setDiff(null);
    setHistory(null);
    setBlame(null);
    setError("");
  }
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    invalidate();
    setComparison(null);
    setDiscardSelection(null);
  }, [status]);
  async function load<T>(action: () => Promise<T>, apply: (value: T) => void) {
    const id = ++request.current;
    setLoading(true);
    setError("");
    setDiff(null);
    setHistory(null);
    setBlame(null);
    try {
      const value = await action();
      if (id === request.current) apply(value);
    } catch (error) {
      if (id === request.current) {
        const failure = normalizeGitError(error);
        setError(`${failure.message} ${failure.output?.stderr.trim() ?? ""}`);
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  function compare(from: string, to: string) {
    setComparison(null);
    void load(() => compareRevisions(path, from, to), setComparison);
  }
  useEffect(() => {
    if (commit) {
      setBase("@parent");
      setTarget(commit);
      compare("@parent", commit);
    }
    // Commit changes intentionally drive a new comparison; typed inputs do not.
  }, [commit, path]);
  function showChange(change: FileChange, kind: string) {
    setFile(change.path);
    setComparison(null);
    if (change.status === "untracked") {
      invalidate();
      setError(
        "Untracked contents have no index comparison. Stage the whole file to inspect its addition, or use an external editor.",
      );
      return;
    }
    void load(() => getTextDiff(path, kind, change.path), setDiff);
  }
  useEffect(() => {
    if (!selectedFile) return;
    if (!status) {
      showChange(selectedFile.change, selectedFile.kind);
      return;
    }
    const groups: { kind: string; files: FileChange[] }[] = [
      { kind: "unstaged", files: status.conflicts },
      { kind: "unstaged", files: status.unstaged },
      { kind: "staged", files: status.staged },
    ];
    const matches = groups.flatMap(({ kind, files }) =>
      files
        .filter((change) => change.path === selectedFile.change.path)
        .map((change) => ({ kind, change })),
    );
    const current =
      matches.find(({ kind }) => kind === selectedFile.kind) ?? matches[0];
    if (current) showChange(current.change, current.kind);
    else invalidate();
    // Follow files between status groups, preserving the chosen comparison when both exist.
  }, [selectedFile, status, path]);
  const unsupportedPaths = new Set(
    [...(status?.staged ?? []), ...(status?.unstaged ?? [])]
      .filter((change) =>
        ["added", "renamed", "copied", "conflicted"].includes(change.status),
      )
      .map((change) => change.path),
  );
  const unavailable = (change: FileChange) =>
    unsupportedPaths.has(change.path) || change.path.endsWith("/");
  const conflictPath = selectedFile && onSaveConflict && status?.conflicts.some(change => change.path === selectedFile.change.path)
    ? selectedFile.change.path : null;
  return (
    <section
      className={styles["inspection-panel"]}
      aria-label="Change inspection"
    >
      <h2>{file || "Inspect changes"}</h2>
      {conflictPath && onSaveConflict && (
        <DiffRenderBoundary text={diff?.text ?? "Unable to load the conflict resolver. Use an external Git tool and refresh status."}>
          <Suspense fallback={<p role="status">Loading conflict resolver…</p>}>
            <ConflictResolver key={`${path}:${conflictPath}`} path={path} filePath={conflictPath} disabled={disabled} onSave={onSaveConflict} />
          </Suspense>
        </DiffRenderBoundary>
      )}
      <p>
        Read-only text comparisons. Diffs are limited to 512 KiB. Binary content
        has no text preview.
      </p>
      {discardSelection && (
        <OperationDialog
          title="Discard selected file?"
          busy={disabled}
          onClose={() => setDiscardSelection(null)}
          description={
            <>
              <code>{discardSelection.path}</code>
              <p>
                {discardSelection.status === "untracked"
                  ? "Permanently delete this untracked file. It cannot be recovered through Git."
                  : "Permanently discard all staged AND unstaged changes for this path. Both the index and working tree will match HEAD."}
              </p>
            </>
          }
        >
          <Button
            variant="destructive"
            disabled={disabled}
            onClick={() => {
              onDiscard(discardSelection);
              setDiscardSelection(null);
            }}
          >
            Discard this file
          </Button>
          <Button variant="outline" onClick={() => setDiscardSelection(null)}>
            Cancel
          </Button>
        </OperationDialog>
      )}
      <details className={styles["inspection-tools"]}>
        <summary>Compare revisions, file history and discard</summary>
        <div className={styles["inspection-columns"]}>
          {[
            {
              label: "Unstaged · index → worktree",
              kind: "unstaged",
              files: status?.unstaged ?? [],
            },
            {
              label: "Staged · HEAD → index",
              kind: "staged",
              files: status?.staged ?? [],
            },
          ].map((section) => (
            <section key={section.kind}>
              <h3>{section.label}</h3>
              {!section.files.length && <p>No changes</p>}
              <ul>
                {section.files.map((change) => (
                  <li key={change.path}>
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() => showChange(change, section.kind)}
                    >
                      {change.status}: {change.path}
                    </Button>
                    {change.originalPath && (
                      <span> from {change.originalPath}</span>
                    )}
                    <Button
                      variant="outline"
                      disabled={
                        disabled ||
                        unavailable(change) ||
                        status?.operation !== "none" ||
                        !!status?.conflicts.length
                      }
                      title={
                        unavailable(change)
                          ? "Discard unavailable for additions, copies, renames, conflicts and directories"
                          : "Discard both staged and unstaged changes for this path"
                      }
                      onClick={() => setDiscardSelection(change)}
                    >
                      Discard
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            compare(base, target);
          }}
        >
          <h3>Compare revisions</h3>
          <p>
            Compare base tree → target tree. A selected commit uses its first
            parent; a root commit uses the empty tree.
          </p>
          <label>
            Base{" "}
            <Input
              value={base}
              onChange={(event) => {
                invalidate();
                setComparison(null);
                setBase(event.target.value);
              }}
            />
          </label>
          <label>
            Target{" "}
            <Input
              value={target}
              onChange={(event) => {
                invalidate();
                setComparison(null);
                setTarget(event.target.value);
              }}
            />
          </label>
          <Button
            type="submit"
            variant="outline"
            disabled={disabled || !base || !target}
          >
            Compare
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={disabled || base === "@parent"}
            onClick={() => {
              setBase(target);
              setTarget(base);
              compare(target, base);
            }}
          >
            Reverse
          </Button>
        </form>
        {comparison && (
          <section>
            <p>
              <code>{comparison.base}</code> → <code>{comparison.target}</code>
            </p>
            {!comparison.files.length && (
              <p>No changed paths between these revisions.</p>
            )}
            <ul>
              {comparison.files.map((change) => (
                <li key={change.path}>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      setFile(change.path);
                      void load(
                        () =>
                          getTextDiff(
                            path,
                            "revisions",
                            change.path,
                            comparison.base,
                            comparison.target,
                          ),
                        setDiff,
                      );
                    }}
                  >
                    {change.status}{" "}
                    {change.originalPath ? `${change.originalPath} → ` : ""}
                    {change.path}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setComparison(null);
            void load(() => getFileHistory(path, file, revision), setHistory);
          }}
        >
          <h3>File history and blame</h3>
          <p>
            Up to 100 commits at the exact path and revision. Rename tracing is
            not included. Deleted paths may have history; blame requires a file
            present at the selected commit. Uncommitted contents are not
            attributed.
          </p>
          <label>
            Path{" "}
            <Input
              value={file}
              onChange={(event) => {
                invalidate();
                setFile(event.target.value);
              }}
              placeholder="src/App.tsx"
            />
          </label>
          <label>
            Revision{" "}
            <Input
              value={revision}
              onChange={(event) => {
                invalidate();
                setRevision(event.target.value);
              }}
            />
          </label>
          <Button
            type="submit"
            variant="outline"
            disabled={disabled || !file || !revision}
          >
            File history
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={disabled || !file || !revision}
            onClick={() => {
              setComparison(null);
              void load(
                () => getFileBlame(path, file, revision),
                (value) => {
                  setDiff(value);
                  setBlame(parseBlame(value.text));
                },
              );
            }}
          >
            Blame
          </Button>
        </form>
      </details>
      {loading && <p role="status">Loading inspection…</p>}
      {error && <p role="alert">{error}</p>}
      {history && (
        <section>
          <h3>
            {file} · {revision}
          </h3>
          {!history.length && (
            <p>No commits for this exact path at this revision.</p>
          )}
          <ul>
            {history.map((entry) => (
              <li key={entry.hash}>
                <Button
                  variant="outline"
                  onClick={() => {
                    setBase("@parent");
                    setTarget(entry.hash);
                    compare("@parent", entry.hash);
                  }}
                >
                  {entry.hash.slice(0, 8)} · {entry.subject}
                </Button>{" "}
                {entry.author} ·{" "}
                {new Date(Number(entry.timestamp) * 1000).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff && !conflictPath && (
        <section>
          <h3>{diff.context}</h3>
          {diff.truncated && (
            <p role="status">
              Output truncated at 512 KiB. Inspect the complete output with an
              external Git tool.
            </p>
          )}
          {diff.binary ? (
            <p>Binary content: text preview unavailable.</p>
          ) : blame ? (
            <div className={styles["blame-lines"]}>
              {blame.map((line, index) => (
                <div key={index}>
                  <Button
                    variant="outline"
                    title={line.summary}
                    onClick={() => {
                      setBase("@parent");
                      setTarget(line.hash);
                      compare("@parent", line.hash);
                    }}
                  >
                    {line.hash.slice(0, 8)} · {line.author}
                  </Button>
                  <span>{line.number}</span>
                  <code>{line.text}</code>
                </div>
              ))}
            </div>
          ) : (
            <DiffRenderBoundary text={diff.text}>
              <Suspense fallback={<p role="status">Loading diff viewer…</p>}>
                <DiffViewer diff={diff} />
              </Suspense>
            </DiffRenderBoundary>
          )}
        </section>
      )}
    </section>
  );
}
