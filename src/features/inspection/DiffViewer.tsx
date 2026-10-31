import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
import { RawPatch } from "@/features/inspection/DiffRenderBoundary";
import styles from "@/features/inspection/DiffViewer.module.css";

import { tokenStyles, themes, themeSnapshot, subscribeTheme } from "@/features/inspection/diff-theme";

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
        <Virtualizer className={styles.viewport}>
          <ParsedDiff key={diff.text} files={model.files} />
        </Virtualizer>
      )}
    </div>
  );
}
