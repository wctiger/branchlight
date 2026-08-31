import { useEffect, useMemo, useState } from "react";

import type { GitError } from "../../types/git";
import type { Commit } from "../../types/history";
import { layoutCommitGraph } from "./graph";

const HISTORY_ROW_HEIGHT = 104;
const GRAPH_LANE_SPACING = 18;
const GRAPH_PADDING = 13;
const graphColors = ["#43815a", "#b06b35", "#6179a8", "#9a5d91", "#5e8d8a"];

export type HistoryState =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "ready";
      commits: Commit[];
      isRefreshing: boolean;
      refreshError: GitError | null;
    }
  | { state: "error"; error: GitError };

interface HistoryPanelProps {
  state: HistoryState;
  controlsDisabled: boolean;
  onRefresh: () => void;
}

/** Formats Git's Unix author timestamp for the user's current locale. */
function formatCommitDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** Returns a machine-readable date only when the Git timestamp fits JavaScript's range. */
function commitDateTime(timestamp: number): string | undefined {
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Shows captured Git output for a history retrieval failure. */
function HistoryError({ error }: { error: GitError }) {
  const details =
    error.output?.stderr.trim() || error.output?.stdout.trim() || undefined;

  return (
    <div className="history-error" role="alert">
      <strong>Git couldn’t load commit history.</strong>
      <p>{error.message}</p>
      {details && <pre>{details}</pre>}
    </div>
  );
}

/** Renders a selectable, read-only list of the repository's bounded history. */
export function HistoryPanel({
  state,
  controlsDisabled,
  onRefresh,
}: HistoryPanelProps) {
  const commits = useMemo(
    () => (state.state === "ready" ? state.commits : []),
    [state],
  );
  const graph = useMemo(() => layoutCommitGraph(commits), [commits]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const selectedCommit = commits.find((commit) => commit.hash === selectedHash);
  const graphWidth =
    GRAPH_PADDING * 2 +
    Math.max(0, graph.laneCount - 1) * GRAPH_LANE_SPACING +
    12;
  const graphHeight = commits.length * HISTORY_ROW_HEIGHT;
  /** Converts a zero-based graph lane into its SVG center coordinate. */
  const laneX = (lane: number) =>
    GRAPH_PADDING + lane * GRAPH_LANE_SPACING + 6;
  /** Converts a commit row into the matching SVG and list-row center. */
  const rowY = (row: number) =>
    row * HISTORY_ROW_HEIGHT + HISTORY_ROW_HEIGHT / 2;

  useEffect(() => {
    if (!commits.some((commit) => commit.hash === selectedHash)) {
      setSelectedHash(commits[0]?.hash ?? null);
    }
  }, [commits, selectedHash]);

  return (
    <aside className="history-panel" aria-labelledby="history-title">
      <header className="history-panel__header">
        <div>
          <p className="eyebrow">Read-only</p>
          <h2 id="history-title">Recent history</h2>
        </div>
        <span>{commits.length}</span>
      </header>

      {(state.state === "idle" || state.state === "loading") && (
        <div className="history-panel__status" aria-live="polite">
          <span className="small-spinner" aria-hidden="true" />
          <span>Reading commits…</span>
        </div>
      )}

      {state.state === "error" && (
        <div className="history-panel__status">
          <HistoryError error={state.error} />
          <button
            className="secondary-button"
            type="button"
            disabled={controlsDisabled}
            onClick={onRefresh}
          >
            Try again
          </button>
        </div>
      )}

      {state.state === "ready" && state.refreshError && (
        <HistoryError error={state.refreshError} />
      )}

      {state.state === "ready" && commits.length === 0 && (
        <div className="history-panel__empty">
          <strong>No commits yet</strong>
          <p>The first commit will appear here after the next refresh.</p>
        </div>
      )}

      {state.state === "ready" && commits.length > 0 && (
        <div
          className="history-timeline"
          style={{
            gridTemplateColumns: `${graphWidth}px minmax(220px, 1fr)`,
          }}
        >
          <svg
            className="history-graph"
            width={graphWidth}
            height={graphHeight}
            viewBox={`0 0 ${graphWidth} ${graphHeight}`}
            role="img"
            aria-label={`Commit graph with ${graph.laneCount} ${graph.laneCount === 1 ? "lane" : "lanes"}`}
          >
            <g className="history-graph__edges">
              {graph.edges.map((edge) => (
                <path
                  key={`${edge.childHash}:${edge.parentHash}`}
                  d={`M ${laneX(edge.fromLane)} ${rowY(edge.fromRow)} L ${laneX(edge.toLane)} ${rowY(edge.toRow)}`}
                  stroke={graphColors[edge.fromLane % graphColors.length]}
                />
              ))}
            </g>
            <g className="history-graph__nodes">
              {graph.nodes.map((node) => (
                <g
                  key={node.hash}
                  className={
                    node.hash === selectedHash
                      ? "history-graph__node history-graph__node--selected"
                      : "history-graph__node"
                  }
                  transform={`translate(${laneX(node.lane)} ${rowY(node.row)})`}
                >
                  <circle className="history-graph__node-ring" r="8" />
                  <circle
                    className="history-graph__node-core"
                    r="5"
                    fill={graphColors[node.lane % graphColors.length]}
                  />
                </g>
              ))}
            </g>
          </svg>

          <ul
            className="history-list"
            aria-label="Recent commits"
            style={{ height: graphHeight }}
          >
            {commits.map((commit) => (
              <li key={commit.hash} style={{ height: HISTORY_ROW_HEIGHT }}>
                <button
                  className={`history-item${commit.hash === selectedHash ? " history-item--selected" : ""}`}
                  type="button"
                  aria-pressed={commit.hash === selectedHash}
                  onClick={() => setSelectedHash(commit.hash)}
                >
                  {commit.refs.length > 0 && (
                    <span className="history-item__refs" aria-label="Branch refs">
                      {commit.refs.map((ref, index) => (
                        <span key={`${ref}:${index}`} title={ref}>
                          {ref}
                        </span>
                      ))}
                    </span>
                  )}
                  <strong>{commit.subject || "(no subject)"}</strong>
                  <span className="history-item__metadata">
                    <span>{commit.author || "Unknown author"}</span>
                    <time dateTime={commitDateTime(commit.timestamp)}>
                      {formatCommitDate(commit.timestamp)}
                    </time>
                  </span>
                  <span className="history-item__identity">
                    <code>{commit.hash.slice(0, 8)}</code>
                    {commit.parents.length > 1 && (
                      <span>{commit.parents.length}-parent merge</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedCommit && (
        <footer className="history-selection" aria-live="polite">
          <span>Selected commit</span>
          <code title={selectedCommit.hash}>{selectedCommit.hash}</code>
          <span>
            {selectedCommit.parents.length === 0
              ? "Root commit"
              : `${selectedCommit.parents.length} ${selectedCommit.parents.length === 1 ? "parent" : "parents"}`}
          </span>
          {selectedCommit.parents.length > 0 && (
            <span className="history-selection__parents">
              <span>Parents</span>
              {selectedCommit.parents.map((parent) => (
                <code key={parent} title={parent}>
                  {parent.slice(0, 8)}
                </code>
              ))}
            </span>
          )}
        </footer>
      )}
    </aside>
  );
}
