import navigationStyles from "@/workspace/RepositorySidebar.module.css";
import styles from "@/workspace/WorkspaceGroups.module.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export type EditingGroup = { original: string; name: string };
export function WorkspaceGroups({
  groups,
  editingGroup,
  groupName,
  onGroupNameChange,
  onCreate,
  onRename,
  onRemove,
}: {
  groups: string[];
  editingGroup: EditingGroup | null;
  groupName: string;
  onGroupNameChange: (name: string) => void;
  onCreate: () => void;
  onRename: (group: string) => void;
  onRemove: (group: string) => void;
}) {
  return (
    <DialogContent finalFocus={() => (editingGroup ? false : true)}>
      <DialogHeader>
        <DialogTitle>Repository groups</DialogTitle>
        <DialogDescription>
          Organize open repositories. Changes last for this session.
        </DialogDescription>
      </DialogHeader>
      <form
        className={styles["group-create"]}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <Input
          aria-label="New group name"
          placeholder="New group"
          value={groupName}
          onChange={(event) => onGroupNameChange(event.target.value)}
        />
        <Button type="submit" variant="default" disabled={!groupName.trim()}>
          Create group
        </Button>
      </form>
      {groups.map((group) => (
        <div className={styles["group-manager-row"]} key={group}>
          <strong>{group}</strong>
          <Button
            variant="outline"
            onClick={() => {
              onRename(group);
            }}
          >
            Rename
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onRemove(group);
            }}
          >
            Remove group
          </Button>
        </div>
      ))}
      {!groups.length && <p>No groups yet.</p>}
    </DialogContent>
  );
}

export function GroupRenameForm({
  editingGroup,
  onSave,
  onNameChange,
  onCancel,
}: {
  editingGroup: EditingGroup;
  onSave: () => void;
  onNameChange: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className={navigationStyles["repository-create"]}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label>
        Rename {editingGroup.original}{" "}
        <Input
          autoFocus
          value={editingGroup.name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      <Button type="submit" variant="outline">
        Save group name
      </Button>
      <Button variant="outline" type="button" onClick={() => onCancel()}>
        Cancel
      </Button>
    </form>
  );
}
