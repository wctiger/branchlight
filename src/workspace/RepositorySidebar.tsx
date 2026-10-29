import styles from "@/workspace/RepositorySidebar.module.css";
import sharedStyles from "@/styles/shared.module.css";
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
        <input
          className={sharedStyles["sidebar-width"]}
          type="range"
          min="300"
          max="420"
          step="10"
          value={sidebarWidth}
          onChange={(event) => onWidthChange(Number(event.target.value))}
          aria-label="Repository sidebar width"
        />
      )}
    </aside>
  );
}
