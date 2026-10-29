import { Button } from "@/components/ui/button";
import type { CSSProperties, ReactNode } from "react";
import "@/App.css";

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
      className="workspace-shell"
      style={{ "--repository-sidebar-width": `${width}px` } as CSSProperties}
    >
      {header}
      {sidebar}
      <div className="workspace-content">{children}</div>
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
    <main className="landing-screen">
      <section className="landing-card">
        <h1>Branchlight</h1>
        <p>
          Switch repositories from the sidebar. Each uses your installed Git and
          local configuration.
        </p>
        <Button
          variant="outline"
          onClick={() => onOpen()}
          disabled={opening || !gitReady}
        >
          Open repository
        </Button>
      </section>
    </main>
  );
}
