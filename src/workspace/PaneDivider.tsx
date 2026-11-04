import { useEffect, useRef, useState } from "react";
import styles from "@/workspace/PaneDivider.module.css";

/** A full-height hit target centered on an existing pane border. */
export function PaneDivider({ label, width, min, max, edge = "right", onWidthChange }: {
  label: string;
  width: number;
  min: number;
  max: number;
  edge?: "left" | "right";
  onWidthChange: (width: number) => void;
}) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = edge === "right" ? 1 : -1;
  const update = (value: number) => onWidthChange(Math.min(max, Math.max(min, value)));
  useEffect(() => {
    if (!dragging) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [dragging]);
  const finish = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div
      className={styles.divider}
      data-edge={edge}
      data-dragging={dragging || undefined}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointerId === event.pointerId) {
          update(start.width + (event.clientX - start.x) * direction);
        }
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        finish();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 50 : 10;
        if (event.key === "ArrowLeft") update(width - step * direction);
        else if (event.key === "ArrowRight") update(width + step * direction);
        else if (event.key === "Home") update(min);
        else if (event.key === "End") update(max);
        else return;
        event.preventDefault();
      }}
    />
  );
}
