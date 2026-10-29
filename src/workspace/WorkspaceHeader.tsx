import styles from "@/workspace/WorkspaceHeader.module.css";
import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { ThemeSelect } from "@/components/theme-select";
import { BranchlightMark } from "@/workspace/icons";

export function WorkspaceHeader({
  opening,
  gitReady,
  onOpen,
}: {
  opening: boolean;
  gitReady: boolean;
  onOpen: () => void;
}) {
  return (
    <header className={styles["workspace-chrome"]}>
      <div className={styles["workspace-tools"]}>
        <strong className={styles["app-wordmark"]}>
          <BranchlightMark />
          Branchlight<span> / Workspace</span>
        </strong>
        <Button
          variant="outline"
          onClick={() => onOpen()}
          disabled={opening || !gitReady}
        >
          {opening ? "Opening…" : "Open repository"}
        </Button>
        <DialogTrigger render={<Button variant="ghost" />}>
          Groups
        </DialogTrigger>
        <ThemeSelect />
      </div>
    </header>
  );
}
