import changesStyles from "@/workspace/ChangesPanel.module.css";
import sharedStyles from "@/styles/shared.module.css";
import type { ReactNode } from "react";

export function ChangesInspector({
  open,
  width,
  onWidthChange,
  children,
}: {
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  children: ReactNode;
}) {
  return (
    <aside
      className={changesStyles["changes-inspector"]}
      hidden={!open}
      aria-label="Changes inspector"
    >
      {children}
      <input
        className={sharedStyles["sidebar-width"]}
        type="range"
        min="300"
        max="420"
        step="10"
        value={width}
        onChange={(event) => onWidthChange(Number(event.target.value))}
        aria-label="Changes inspector width"
      />
    </aside>
  );
}
