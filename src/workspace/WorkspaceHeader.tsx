import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { ThemeSelect } from "@/components/theme-select";

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
    <header className="workspace-chrome">
      <div className="workspace-tools">
        <strong className="app-wordmark">
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
