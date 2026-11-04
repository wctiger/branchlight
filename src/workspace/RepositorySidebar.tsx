import styles from "@/workspace/RepositorySidebar.module.css";
import { PaneDivider } from "@/workspace/PaneDivider";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function RepositorySidebar({
  compact,
  sidebarWidth,
  onCompactChange,
  onWidthChange,
  children,
}: {
  compact: boolean;
  sidebarWidth: number;
  onCompactChange: (compact: boolean) => void;
  onWidthChange: (width: number) => void;
  children: ReactNode;
}) {
  return (
    <aside
      className={cn(
        styles["repository-sidebar"],
        compact && styles["repository-sidebar--compact"],
      )}
      aria-label="Repositories"
    >
      <header className={styles["sidebar-heading"]}>
        <strong>Repositories</strong>
        <Button
          variant="ghost"
          aria-label={
            compact
              ? "Expand repository sidebar"
              : "Collapse repository sidebar"
          }
          aria-expanded={!compact}
          onClick={() => onCompactChange(!compact)}
        >
          {compact ? "»" : "«"}
        </Button>
      </header>
      {children}
      {!compact && (
        <PaneDivider label="Repository sidebar width" width={sidebarWidth} min={300} max={420} onWidthChange={onWidthChange} />
      )}
    </aside>
  );
}
