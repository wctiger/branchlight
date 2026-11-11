import styles from "@/workspace/WorkspaceLayout.module.css";
import { Button } from "@/components/ui/button";
import { BranchlightMark } from "@/workspace/icons";
import type { CSSProperties, ReactNode } from "react";

export function WorkspaceLayout({
  width,
  header,
  sidebar,
  children,
}: {
  width: number;
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={styles["workspace-shell"]}
      style={{ "--repository-sidebar-width": `${width}px` } as CSSProperties}
    >
      {header}
      {sidebar}
      <div className={styles["workspace-content"]}>{children}</div>
    </div>
  );
}

export function WorkspaceLanding({
  opening,
  gitReady,
  onOpen,
}: {
  opening: boolean;
  gitReady: boolean;
  onOpen: () => void;
}) {
  return (
    <main className={styles["landing-screen"]}>
      <section className={styles["landing-card"]}>
        <h1>
          <BranchlightMark />
          Open a repository
        </h1>
        <p>
          Branchlight uses your installed Git and local configuration.
        </p>
        <Button
          variant="default"
          onClick={() => onOpen()}
          disabled={opening || !gitReady}
        >
          Open repository
        </Button>
      </section>
    </main>
  );
}
