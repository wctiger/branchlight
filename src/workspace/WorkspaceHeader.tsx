import styles from "@/workspace/WorkspaceHeader.module.css";
import { IconButton } from "@/components/icon-button";
import { FolderOpen, Folders } from "lucide-react";
import { DialogTrigger } from "@/components/ui/dialog";
import { ThemeSelect } from "@/components/theme-select";
import { CommandPalette } from "@/features/CommandPalette";
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
        <IconButton
          data-command="workspace.open"
          variant="outline"
          onClick={() => onOpen()}
          disabled={opening || !gitReady}
          label={opening ? "Opening…" : "Open repository"}
          icon={FolderOpen}
        />
        <DialogTrigger render={<IconButton variant="ghost" data-command="workspace.groups" label="Groups" icon={Folders} />} />
        <ThemeSelect />
        <CommandPalette />
      </div>
    </header>
  );
}
