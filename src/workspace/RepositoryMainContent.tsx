import styles from "@/workspace/RepositoryMainContent.module.css";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Keep both modes mounted so history selection, scroll, and inspection state survive switches. */
export function RepositoryMainContent({
  mode,
  filePath,
  inspectorOpen,
  onModeChange,
  onInspectorToggle,
  history,
  diff,
}: {
  mode: "history" | "diff";
  filePath?: string;
  inspectorOpen: boolean;
  onModeChange: (mode: "history" | "diff") => void;
  onInspectorToggle: () => void;
  history: ReactNode;
  diff: ReactNode;
}) {
  return (
    <div className={styles["main-column"]}>
      <div className={styles["main-view-toolbar"]}>
        <Button
          variant="ghost"
          aria-pressed={mode === "history"}
          data-command="view.history"
          onClick={() => onModeChange("history")}
        >
          History
        </Button>
        <Button
          variant="ghost"
          aria-pressed={mode === "diff"}
          data-command="view.diff"
          onClick={() => onModeChange("diff")}
        >
          Diff
        </Button>
        <span className={styles["selected-file-path"]} title={filePath}>
          {mode === "diff"
            ? (filePath ?? "Compare revisions")
            : "Commit history"}
        </span>
        <Button
          variant="outline"
          aria-expanded={inspectorOpen}
          data-command="view.changes"
          onClick={() => onInspectorToggle()}
        >
          {inspectorOpen ? "Hide changes" : "Show changes"}
        </Button>
      </div>

      <div className={styles["main-mode"]} hidden={mode !== "history"}>
        {history}
      </div>
      <div className={styles["main-mode"]} hidden={mode !== "diff"}>
        {diff}
      </div>
    </div>
  );
}
