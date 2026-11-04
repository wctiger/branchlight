import changesStyles from "@/workspace/ChangesPanel.module.css";
import { PaneDivider } from "@/workspace/PaneDivider";
import type { ReactNode } from "react";

export function ChangesInspector({
  open,
  width,
  maxWidth = 420,
  onWidthChange,
  children,
}: {
  open: boolean;
  width: number;
  maxWidth?: number;
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
      <PaneDivider label="Changes inspector width" width={width} min={300} max={maxWidth} edge="left" onWidthChange={onWidthChange} />
    </aside>
  );
}
