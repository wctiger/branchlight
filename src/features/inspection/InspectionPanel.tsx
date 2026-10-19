import { useEffect, useId, useRef, useState } from "react";
import { compareRevisions, getTextDiff, getFileBlame, getFileHistory, normalizeGitError } from "../../lib/tauri";
import type { Comparison, FileCommit, TextDiff } from "../../lib/tauri";
import type { RepositoryStatus, FileChange } from "../../types/status";

type BlameLine = { hash: string; author: string; summary: string; number: string; text: string };
function parseBlame(text: string): BlameLine[] {
  const result: BlameLine[] = [];
  let hash = "", author = "", summary = "", number = "";
  for (const line of text.split("\n")) {
    const header = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(line);
    if (header) { hash = header[1]; number = header[2]; author = ""; summary = ""; }
    else if (line.startsWith("author ")) author = line.slice(7);
    else if (line.startsWith("summary ")) summary = line.slice(8);
    else if (line.startsWith("\t")) result.push({ hash, author, summary, number, text: line.slice(1) });
  }
  return result;
}
export function InspectionPanel({ path, status, commit, disabled, onDiscard }: {
  path: string; status: RepositoryStatus | null; commit: string | null; disabled: boolean;
  onDiscard: (change: FileChange) => void;
}) {
  const discardTitleId = useId();
  const [discardSelection, setDiscardSelection] = useState<FileChange | null>(null);
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
  function invalidate() { request.current++; setLoading(false); setDiff(null); setHistory(null); setBlame(null); setError(""); }
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { invalidate(); setComparison(null); setDiscardSelection(null); }, [status]);
  async function load<T>(action: () => Promise<T>, apply: (value: T) => void) {
    const id = ++request.current;
    setLoading(true); setError(""); setDiff(null); setHistory(null); setBlame(null);
    try { const value = await action(); if (id === request.current) apply(value); }
    catch (error) { if (id === request.current) { const failure = normalizeGitError(error); setError(`${failure.message} ${failure.output?.stderr.trim() ?? ""}`); } }
    finally { if (id === request.current) setLoading(false); }
  }
  function compare(from: string, to: string) {
    setComparison(null);
    void load(() => compareRevisions(path, from, to), setComparison);
  }
  useEffect(() => {
    if (commit) { setBase("@parent"); setTarget(commit); compare("@parent", commit); }
    // Commit changes intentionally drive a new comparison; typed inputs do not.
  }, [commit, path]);
  function showChange(change: FileChange, kind: string) {
    setFile(change.path);
    setComparison(null);
    if (change.status === "untracked") {
      invalidate(); setError("Untracked contents have no index comparison. Stage the whole file to inspect its addition, or use an external editor."); return;
    }
    void load(() => getTextDiff(path, kind, change.path), setDiff);
  }
  const unsupportedPaths = new Set([...(status?.staged ?? []), ...(status?.unstaged ?? [])]
    .filter((change) => ["added", "renamed", "copied", "conflicted"].includes(change.status))
    .map((change) => change.path));
  const unavailable = (change: FileChange) => unsupportedPaths.has(change.path) || change.path.endsWith("/");
  return <section className="inspection-panel" aria-label="Change inspection">
    <h2>Inspect changes</h2>
    <p>Read-only text comparisons. Diffs are limited to 512 KiB. Binary content has no text preview.</p>
    {discardSelection && <section role="alertdialog" aria-modal="false" aria-labelledby={discardTitleId}>
      <h3 id={discardTitleId}>Discard selected file?</h3>
      <code>{discardSelection.path}</code>
      <p>{discardSelection.status === "untracked"
        ? "Permanently delete this untracked file. It cannot be recovered through Git."
        : "Permanently discard all staged AND unstaged changes for this path. Both the index and working tree will match HEAD."}</p>
      <button disabled={disabled} onClick={() => { onDiscard(discardSelection); setDiscardSelection(null); }}>Discard this file</button>
      <button onClick={() => setDiscardSelection(null)}>Cancel</button>
    </section>}
    <div className="inspection-columns">
      {[{ label: "Unstaged · index → worktree", kind: "unstaged", files: status?.unstaged ?? [] }, { label: "Staged · HEAD → index", kind: "staged", files: status?.staged ?? [] }].map((section) => <section key={section.kind}>
        <h3>{section.label}</h3>
        {!section.files.length && <p>No changes</p>}
        <ul>{section.files.map((change) => <li key={change.path}>
          <button disabled={disabled} onClick={() => showChange(change, section.kind)}>{change.status}: {change.path}</button>
          {change.originalPath && <span> from {change.originalPath}</span>}
          <button disabled={disabled || unavailable(change) || status?.operation !== "none" || !!status?.conflicts.length} title={unavailable(change) ? "Discard unavailable for additions, copies, renames, conflicts and directories" : "Discard both staged and unstaged changes for this path"} onClick={() => setDiscardSelection(change)}>Discard</button>
        </li>)}</ul>
      </section>)}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); compare(base, target); }}>
      <h3>Compare revisions</h3>
      <p>Compare base tree → target tree. A selected commit uses its first parent; a root commit uses the empty tree.</p>
      <label>Base <input value={base} onChange={(event) => { invalidate(); setComparison(null); setBase(event.target.value); }} /></label>
      <label>Target <input value={target} onChange={(event) => { invalidate(); setComparison(null); setTarget(event.target.value); }} /></label>
      <button disabled={disabled || !base || !target}>Compare</button>
      <button type="button" disabled={disabled || base === "@parent"} onClick={() => { setBase(target); setTarget(base); compare(target, base); }}>Reverse</button>
    </form>
    {comparison && <section><p><code>{comparison.base}</code> → <code>{comparison.target}</code></p>
      {!comparison.files.length && <p>No changed paths between these revisions.</p>}
      <ul>{comparison.files.map((change) => <li key={change.path}><button disabled={disabled} onClick={() => { setFile(change.path); void load(() => getTextDiff(path, "revisions", change.path, comparison.base, comparison.target), setDiff); }}>{change.status} {change.originalPath ? `${change.originalPath} → ` : ""}{change.path}</button></li>)}</ul>
    </section>}
    <form onSubmit={(event) => { event.preventDefault(); setComparison(null); void load(() => getFileHistory(path, file, revision), setHistory); }}>
      <h3>File history and blame</h3>
      <p>Up to 100 commits at the exact path and revision. Rename tracing is not included. Deleted paths may have history; blame requires a file present at the selected commit. Uncommitted contents are not attributed.</p>
      <label>Path <input value={file} onChange={(event) => { invalidate(); setFile(event.target.value); }} placeholder="src/App.tsx" /></label>
      <label>Revision <input value={revision} onChange={(event) => { invalidate(); setRevision(event.target.value); }} /></label>
      <button disabled={disabled || !file || !revision}>File history</button>
      <button type="button" disabled={disabled || !file || !revision} onClick={() => { setComparison(null); void load(() => getFileBlame(path, file, revision), (value) => { setDiff(value); setBlame(parseBlame(value.text)); }); }}>Blame</button>
    </form>
    {loading && <p role="status">Loading inspection…</p>}
    {error && <p role="alert">{error}</p>}
    {history && <section><h3>{file} · {revision}</h3>{!history.length && <p>No commits for this exact path at this revision.</p>}<ul>{history.map((entry) => <li key={entry.hash}><button onClick={() => { setBase("@parent"); setTarget(entry.hash); compare("@parent", entry.hash); }}>{entry.hash.slice(0, 8)} · {entry.subject}</button> {entry.author} · {new Date(Number(entry.timestamp) * 1000).toLocaleString()}</li>)}</ul></section>}
    {diff && <section><h3>{diff.context}</h3>{diff.truncated && <p role="status">Output truncated at 512 KiB. Inspect the complete output with an external Git tool.</p>}
      {diff.binary ? <p>Binary content: text preview unavailable.</p> : blame ? <div className="blame-lines">{blame.map((line, index) => <div key={index}><button title={line.summary} onClick={() => { setBase("@parent"); setTarget(line.hash); compare("@parent", line.hash); }}>{line.hash.slice(0, 8)} · {line.author}</button><span>{line.number}</span><code>{line.text}</code></div>)}</div> : <pre className="text-diff">{diff.text || "No text changes in this comparison."}</pre>}
    </section>}
  </section>;
}
