import {
  Component,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  VirtualizedFileDiff,
  type FileDiffMetadata,
  type FileDiff as DiffInstance,
} from "@pierre/diffs";
import {
  FileDiff,
  Virtualizer,
  useVirtualizer,
  type FileDiffOptions,
} from "@pierre/diffs/react";
import { Button } from "@/components/ui/button";
import type { TextDiff } from "@/lib/tauri";
import { prepareDiff } from "@/features/inspection/diff-model";
import styles from "@/features/inspection/DiffViewer.module.css";

// Static, application-owned CSS crosses the library's Shadow DOM boundary.
// Repository text is never inserted into CSS or raw HTML.
const tokenStyles = `
:host {
  --diffs-font-family: var(--font-mono);
  --diffs-font-size: var(--type-body);
  --diffs-line-height: 20px;
  --diffs-light-bg: var(--surface-panel);
  --diffs-dark-bg: var(--surface-panel);
  --diffs-fg-number-override: var(--text-secondary);
  --diffs-bg-addition-override: var(--git-add-background);
  --diffs-bg-deletion-override: var(--git-delete-background);
  --diffs-bg-addition-number-override: var(--git-add-background);
  --diffs-bg-deletion-number-override: var(--git-delete-background);
  --diffs-bg-context-override: var(--surface-panel);
  --diffs-bg-context-gutter-override: var(--surface-panel);
  --diffs-bg-separator-override: var(--surface-subtle);
  --diffs-bg-buffer-override: var(--surface-subtle);
  --diffs-addition-color-override: var(--git-add-text);
  --diffs-deletion-color-override: var(--git-delete-text);
  --diffs-modified-color-override: var(--text-accent);
  --diffs-tab-size: 4;
}`;
const themes = { light: "pierre-light", dark: "pierre-dark" } as const;
function themeSnapshot(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
function subscribeTheme(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function RawPatch({ text, reason }: { text: string; reason: string }) {
  return (
    <>
      <p role="status">{reason}</p>
      <pre className={styles.raw}>{text}</pre>
    </>
  );
}

/** Renderer failure retains the exact captured text, never an empty or fabricated diff. */
class RenderBoundary extends Component<
  { text: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: { text: string }) {
    if (previous.text !== this.props.text && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <RawPatch
        text={this.props.text}
        reason="The diff renderer is unavailable. Showing Git’s original output as plain text."
      />
    ) : (
      this.props.children
    );
  }
}

function FileSurface({
  file,
  layout,
  theme,
  instances,
}: {
  file: FileDiffMetadata;
  layout: "unified" | "split";
  theme: "light" | "dark";
  instances: React.RefObject<Map<FileDiffMetadata, DiffInstance>>;
}) {
  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      theme: themes,
      themeType: theme,
      diffStyle: layout,
      hunkSeparators: "metadata",
      unsafeCSS: tokenStyles,
      disableErrorHandling: true,
      onPostRender: (_node, instance, phase) => {
        if (phase === "unmount") instances.current.delete(file);
        else instances.current.set(file, instance);
      },
    }),
    [file, layout, theme, instances],
  );
  return <FileDiff fileDiff={file} options={options} />;
}

function ParsedDiff({ files }: { files: FileDiffMetadata[] }) {
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const theme = useSyncExternalStore<"light" | "dark">(
    subscribeTheme,
    themeSnapshot,
    () => "light",
  );
  const virtualizer = useVirtualizer();
  const instances = useRef(new Map<FileDiffMetadata, DiffInstance>());
  const [selectedHunk, setSelectedHunk] = useState(-1);
  const hunks = useMemo(
    () => files.flatMap((file) => file.hunks.map((hunk) => ({ file, hunk }))),
    [files],
  );
  const navigate = useCallback(
    (direction: number) => {
      if (!hunks.length) return;
      const index =
        selectedHunk < 0
          ? direction > 0
            ? 0
            : hunks.length - 1
          : (selectedHunk + direction + hunks.length) % hunks.length;
      const { file, hunk } = hunks[index];
      const instance = instances.current.get(file);
      if (!(instance instanceof VirtualizedFileDiff) || !virtualizer) return;
      const side = hunk.additionCount > 0 ? "additions" : "deletions";
      const position = instance.getLinePosition(
        side === "additions" ? hunk.additionStart : hunk.deletionStart,
        side,
      );
      if (!position) return;
      virtualizer.scrollTo({
        top: Math.max(0, (instance.top ?? 0) + position.top - 40),
      });
      setSelectedHunk(index);
    },
    [hunks, selectedHunk, virtualizer],
  );
  return (
    <>
      <div className={styles.toolbar} aria-label="Diff navigation">
        <Button
          variant="outline"
          disabled={!hunks.length}
          onClick={() => navigate(-1)}
        >
          Previous hunk
        </Button>
        <Button
          variant="outline"
          disabled={!hunks.length}
          onClick={() => navigate(1)}
        >
          Next hunk
        </Button>
        <span role="status">
          {selectedHunk >= 0 ? `${selectedHunk + 1} / ` : ""}
          {hunks.length} {hunks.length === 1 ? "hunk" : "hunks"}
        </span>
        <label>
          Layout{" "}
          <select
            aria-label="Diff layout"
            value={layout}
            onChange={(event) =>
              setLayout(event.target.value as "unified" | "split")
            }
          >
            <option value="unified">Unified</option>
            <option value="split">Side by side</option>
          </select>
        </label>
      </div>
      {files.map((file, index) => (
        <FileSurface
          key={index}
          file={file}
          layout={layout}
          theme={theme}
          instances={instances}
        />
      ))}
    </>
  );
}

/** Renders the backend's patch without recomputing or extending its captured contents. */
export default function DiffViewer({ diff }: { diff: TextDiff }) {
  const model = useMemo(() => prepareDiff(diff), [diff]);
  return (
    <div className={styles.viewer} role="region" aria-label="File diff">
      {model.kind === "empty" ? (
        <p>No text changes in this comparison.</p>
      ) : model.kind === "raw" ? (
        <RawPatch text={diff.text} reason={model.reason} />
      ) : (
        <RenderBoundary text={diff.text}>
          <Virtualizer className={styles.viewport}>
            <ParsedDiff key={diff.text} files={model.files} />
          </Virtualizer>
        </RenderBoundary>
      )}
    </div>
  );
}
