import styles from "@/features/history/HistoryPanel.module.css";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { historyRowHeight } from "@/lib/design-tokens";
import type { GitError } from "@/types/git";
import type { Commit } from "@/types/history";
import { layoutCommitGraph } from "@/features/history/graph";
import { visibleHistoryRange } from "@/features/history/viewport";

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
  search?: ReactNode;
  renderActions?: (commit: Commit) => ReactNode;
  state: HistoryState;
  controlsDisabled: boolean;
  onRefresh: () => void;
  onSelectCommit: (hash: string) => void;
}
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
function dateText(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : dateFormatter.format(date);
}
const graphColor = (lane: number) => `var(--graph-lane-${(lane % 4) + 1})`;

/** Virtualized bounded history, retaining hash selection and native keyboard focus. */
export function HistoryPanel({
  state,
  controlsDisabled,
  onRefresh,
  onSelectCommit,
  renderActions,
  search,
}: HistoryPanelProps) {
  const titleId = useId();
  const commits = useMemo(
    () => (state.state === "ready" ? state.commits : []),
    [state],
  );
  const graph = useMemo(() => layoutCommitGraph(commits), [commits]);
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(480);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const selected = commits.find((commit) => commit.hash === selectedHash);
  const range = visibleHistoryRange(
    commits.length,
    scrollTop,
    height,
    historyRowHeight,
  );
  const graphWidth = 24 + graph.laneCount * 14;
  const totalHeight = commits.length * historyRowHeight;
  const laneX = (lane: number) => 14 + lane * 14;
  const rowY = (row: number) => row * historyRowHeight + historyRowHeight / 2;
  useEffect(() => {
    if (!commits.some((commit) => commit.hash === selectedHash))
      setSelectedHash(commits[0]?.hash ?? null);
  }, [commits, selectedHash]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => {
      if (element.clientHeight) setHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [state.state]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (element.scrollTop > Math.max(0, totalHeight - element.clientHeight))
      element.scrollTop = Math.max(0, totalHeight - element.clientHeight);
    setScrollTop(element.scrollTop);
  }, [totalHeight]);
  function choose(index: number, focus = false) {
    const commit = commits[index];
    if (!commit) return;
    setSelectedHash(commit.hash);
    onSelectCommit(commit.hash);
    if (focus && viewport.current) {
      const element = viewport.current;
      const top = index * historyRowHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (
        top + historyRowHeight >
        element.scrollTop + element.clientHeight
      )
        element.scrollTop = top + historyRowHeight - element.clientHeight;
      setScrollTop(element.scrollTop);
      requestAnimationFrame(() =>
        element
          .querySelector<HTMLButtonElement>(`[data-hash="${commit.hash}"]`)
          ?.focus({ preventScroll: true }),
      );
    }
  }
  function navigate(event: KeyboardEvent, index: number) {
    const next =
      event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? commits.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      choose(Math.max(0, Math.min(commits.length - 1, next)), true);
    }
  }
  const failure =
    state.state === "error"
      ? state.error
      : state.state === "ready"
        ? state.refreshError
        : null;
  return (
    <aside data-slot="history-panel" className={styles["history-panel"]} aria-labelledby={titleId}>
      <header className={styles["history-panel__header"]}>
        <h2 id={titleId}>History</h2>
        <Badge variant="secondary">{commits.length} loaded</Badge>
        {state.state === "ready" && state.isRefreshing && (
          <span role="status">Refreshing…</span>
        )}
      </header>
      <p className={styles["history-bound"]}>
        Latest 200 commits from Git
        {commits.length > 200 ? " · synthetic fixture" : ""}
      </p>
      {search}
      {failure && (
        <div role="alert" className={styles["history-error"]}>
          <strong>History unavailable</strong>
          <p>{failure.message}</p>
          {failure.output && (
            <pre>{failure.output.stderr || failure.output.stdout}</pre>
          )}
          <Button
            variant="outline"
            disabled={controlsDisabled}
            onClick={onRefresh}
          >
            Try again
          </Button>
        </div>
      )}
      {(state.state === "idle" || state.state === "loading") && (
        <p role="status">Reading commits…</p>
      )}
      {state.state === "ready" && !commits.length && (
        <p className={styles["history-panel__empty"]}>
          No commits yet. Refresh after the first commit.
        </p>
      )}
      <div
        ref={viewport}
        className={styles["history-timeline"]}
        tabIndex={0}
        role="region"
        aria-label="Scrollable commit history"
        onKeyDown={(event) => {
          if (event.target === event.currentTarget) {
            const index = commits.findIndex(
              (commit) => commit.hash === selectedHash,
            );
            navigate(
              event,
              index >= range.start && index < range.end
                ? index
                : Math.floor(scrollTop / historyRowHeight),
            );
          }
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          const focused = document.activeElement as HTMLElement | null;
          if (
            focused?.classList.contains(styles["history-item"]) &&
            element.contains(focused)
          ) {
            const row = commits.findIndex(
              (commit) => commit.hash === focused.dataset.hash,
            );
            if (
              row * historyRowHeight < element.scrollTop ||
              (row + 1) * historyRowHeight >
                element.scrollTop + element.clientHeight
            )
              element.focus({ preventScroll: true });
          }
          setScrollTop(element.scrollTop);
        }}
      >
        <div
          className={styles["history-canvas"]}
          style={{ height: totalHeight, minWidth: graphWidth + 560 }}
        >
          <svg
            className={styles["history-graph"]}
            width={graphWidth}
            height={totalHeight}
            aria-label="Commit parent relationships"
            role="img"
          >
            {graph.edges
              .filter(
                (edge) => edge.fromRow < range.end && edge.toRow >= range.start,
              )
              .map((edge) => (
                <path
                  key={`${edge.childHash}:${edge.parentHash}`}
                  d={`M ${laneX(edge.fromLane)} ${rowY(edge.fromRow)} L ${laneX(edge.toLane)} ${rowY(edge.toRow)}`}
                  stroke={graphColor(edge.fromLane)}
                />
              ))}
            {graph.nodes.slice(range.start, range.end).map((node) => (
              <g
                key={node.hash}
                transform={`translate(${laneX(node.lane)} ${rowY(node.row)})`}
              >
                <circle
                  r={node.hash === selectedHash ? 7 : 5}
                  className={styles["history-graph__node-ring"]}
                />
                <circle r="3" fill={graphColor(node.lane)} />
              </g>
            ))}
          </svg>
          <ul
            className={styles["history-list"]}
            aria-label="Recent commits; use Up, Down, Home and End"
            style={{ marginLeft: graphWidth, height: totalHeight }}
          >
            {commits.slice(range.start, range.end).map((commit, offset) => {
              const index = range.start + offset;
              const full = `${commit.hash} · ${commit.subject || "(no subject)"} · ${commit.author || "Unknown author"} · ${dateText(commit.timestamp)} · ${commit.parents.length} parents${commit.refs.length ? " · " + commit.refs.join(", ") : ""}`;
              return (
                <li
                  key={commit.hash}
                  aria-posinset={index + 1}
                  aria-setsize={commits.length}
                  style={{
                    top: index * historyRowHeight,
                    height: historyRowHeight,
                  }}
                >
                  <button
                    className={styles["history-item"]}
                    data-hash={commit.hash}
                    type="button"
                    title={full}
                    aria-label={full}
                    aria-pressed={commit.hash === selectedHash}
                    tabIndex={commit.hash === selectedHash ? 0 : -1}
                    onClick={() => choose(index)}
                    onKeyDown={(event) => navigate(event, index)}
                  >
                    <code>{commit.hash.slice(0, 8)}</code>
                    <strong>{commit.subject || "(no subject)"}</strong>
                    <span
                      className={styles["history-item__refs"]}
                      title={commit.refs.join(", ")}
                    >
                      <span>{commit.refs[0]}</span>
                      {commit.refs.length > 1 && (
                        <b>+{commit.refs.length - 1}</b>
                      )}
                    </span>
                    <span className={styles["history-item__author"]}>
                      {commit.author || "Unknown author"}
                    </span>
                    <time>{dateText(commit.timestamp)}</time>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {selected && (
        <footer className={styles["history-selection"]}>
          {renderActions?.(selected)}
          <code>{selected.hash.slice(0, 12)}</code>
          <strong>{selected.subject || "(no subject)"}</strong>
          <span>
            {selected.author} · {dateText(selected.timestamp)}
          </span>
          {!!selected.refs.length && <span>{selected.refs.join(" · ")}</span>}
          <span>
            {selected.parents.length}{" "}
            {selected.parents.length === 1 ? "parent" : "parents"}
          </span>
          <span>
            {selected.parents.map((parent) => (
              <code key={parent} title={parent}>
                {parent.slice(0, 8)}{" "}
              </code>
            ))}
          </span>
        </footer>
      )}
    </aside>
  );
}
