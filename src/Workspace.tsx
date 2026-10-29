import { createWorkspaceStore } from "@/stores/workspace-store";
import {
  WorkspaceStoreContext,
  useWorkspaceStore,
} from "@/stores/workspace-context";
import navigationStyles from "@/workspace/RepositorySidebar.module.css";
import sharedStyles from "@/styles/shared.module.css";
import layoutStyles from "@/workspace/WorkspaceLayout.module.css";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { RepositoryApp } from "@/App";
import { RepositoryTabs } from "@/workspace/RepositoryTabs";
import { WorkspaceLayout, WorkspaceLanding } from "@/workspace/WorkspaceLayout";
import { WorkspaceHeader } from "@/workspace/WorkspaceHeader";
import { WorkspaceGroups, GroupRenameForm } from "@/workspace/WorkspaceGroups";
import { RepositorySidebar } from "@/workspace/RepositorySidebar";
import { RepositoryCreation } from "@/workspace/RepositoryCreation";
import { useRepositorySidebar } from "@/workspace/useRepositorySidebar";

export default function Workspace() {
  const [store] = useState(createWorkspaceStore);
  return (
    <WorkspaceStoreContext value={store}>
      <WorkspaceContent />
    </WorkspaceStoreContext>
  );
}

function WorkspaceContent() {
  const { compact, setCompact, sidebarWidth, setSidebarWidth } =
    useRepositorySidebar();
  const {
    gitReady,
    gitMessage,
    checkGit,
    tabs,
    active,
    groups,
    editingGroup,
    manageGroups,
    groupName,
    error,
    opening,
    open,
    setManageGroups,
    setGroupName,
    setEditingGroup,
    setError,
    createGroup,
    renameGroup,
    removeGroup,
    addRepository,
  } = useWorkspaceStore((state) => state);
  useEffect(() => {
    void checkGit();
  }, [checkGit]);
  return (
    <WorkspaceLayout
      width={compact ? 160 : sidebarWidth}
      header={
        <Dialog open={manageGroups} onOpenChange={setManageGroups}>
          <WorkspaceHeader
            opening={opening}
            gitReady={gitReady}
            onOpen={() => void open()}
          />
          <WorkspaceGroups
            groups={groups}
            editingGroup={editingGroup}
            groupName={groupName}
            onGroupNameChange={setGroupName}
            onCreate={createGroup}
            onRename={(group) => {
              setEditingGroup({ original: group, name: group });
              setManageGroups(false);
            }}
            onRemove={removeGroup}
          />
        </Dialog>
      }
      sidebar={
        <RepositorySidebar
          compact={compact}
          sidebarWidth={sidebarWidth}
          onCompactChange={setCompact}
          onWidthChange={setSidebarWidth}
        >
          <RepositoryTabs />
          <p className={navigationStyles["system-git-status"]} role="status">
            {gitMessage}{" "}
            {!gitReady && (
              <Button variant="outline" onClick={() => void checkGit()}>
                Check again
              </Button>
            )}
          </p>
          <RepositoryCreation
            gitReady={gitReady}
            onError={setError}
            onCreated={addRepository}
          />
        </RepositorySidebar>
      }
    >
      {editingGroup && (
        <GroupRenameForm
          editingGroup={editingGroup}
          onSave={() => renameGroup(editingGroup.original, editingGroup.name)}
          onNameChange={(name) => setEditingGroup({ ...editingGroup, name })}
          onCancel={() => setEditingGroup(null)}
        />
      )}
      {error && (
        <p role="alert" className={sharedStyles["workspace-error"]}>
          {error}
        </p>
      )}
      {!tabs.length && (
        <WorkspaceLanding
          opening={opening}
          gitReady={gitReady}
          onOpen={() => void open()}
        />
      )}
      {tabs.map((tab) => (
        <div
          className={layoutStyles["repository-view"]}
          key={tab.repository.path}
          hidden={active !== tab.repository.path}
        >
          <RepositoryApp initialRepository={tab.repository} />
        </div>
      ))}
    </WorkspaceLayout>
  );
}
