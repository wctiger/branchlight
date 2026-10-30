import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  searchHistory,
  normalizeGitError,
  type HistorySearchResult,
} from "@/lib/tauri";
import styles from "@/features/history/CommitSearch.module.css";

export function CommitSearch({
  path,
  refreshKey,
  onSelect,
}: {
  path: string;
  refreshKey: unknown;
  onSelect: (hash: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"message" | "hash">("message");
  const [state, setState] = useState<{
    key: string;
    result: HistorySearchResult | null;
    error: string;
    loading: boolean;
  }>({ key: "", result: null, error: "", loading: false });
  const sequence = useRef(0);
  const normalized = query.trim();
  const key = JSON.stringify([path, mode, normalized]);
  useEffect(() => {
    const id = ++sequence.current;
    if (!normalized) return;
    setState({ key, result: null, error: "", loading: true });
    const timer = setTimeout(async () => {
      try {
        const result = await searchHistory(path, normalized, mode);
        if (id === sequence.current)
          setState({ key, result, error: "", loading: false });
      } catch (error) {
        const failure = normalizeGitError(error);
        if (id === sequence.current)
          setState({
            key,
            result: null,
            error: `${failure.message} ${failure.output?.stderr ?? ""}`.trim(),
            loading: false,
          });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [path, mode, normalized, refreshKey]);
  const current = state.key === key && !!normalized ? state : null;
  return (
    <section className={styles.search} aria-label="Commit search">
      <div className={styles.fields}>
        <label>
          Search commits
          <Input
            type="search"
            maxLength={256}
            value={query}
            placeholder="Hash or commit message"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Search by
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as "message" | "hash")
            }
          >
            <option value="message">Message</option>
            <option value="hash">Hash</option>
          </select>
        </label>
        <Button
          variant="outline"
          disabled={!query}
          onClick={() => setQuery("")}
        >
          Clear search
        </Button>
      </div>
      <p>
        {mode === "message"
          ? "Search full commit messages across local refs, not just loaded rows. Up to 200 matching commits; literal text, case insensitive."
          : "Look up one unambiguous commit hash in this repository’s local object database (at least 4 hexadecimal characters)."}
      </p>
      {normalized && (!current || current.loading) && (
        <p role="status">Searching commits…</p>
      )}
      {current?.error && <p role="alert">{current.error}</p>}
      {current?.result && (
        <>
          <p role="status">
            {current.result.commits.length}{" "}
            {current.result.commits.length === 1 ? "match" : "matches"}
            {current.result.hasMore
              ? " · More matches exist; refine your search."
              : ""}
          </p>
          {current.result.commits.length === 0 && (
            <p>
              No matching commits. Try different text or a full commit hash.
            </p>
          )}
          <ul className={styles.results} aria-label="Commit search results">
            {current.result.commits.map((commit) => (
              <li key={commit.hash}>
                <Button
                  variant="ghost"
                  onClick={() => onSelect(commit.hash)}
                  aria-label={`Inspect ${commit.hash} ${commit.subject}`}
                >
                  <code>{commit.hash.slice(0, 12)}</code>
                  <span>{commit.subject || "(no subject)"}</span>
                  <span>{commit.author}</span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
