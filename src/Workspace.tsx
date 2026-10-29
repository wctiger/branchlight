import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { RepositoryApp } from "@/App";
import {
  chooseRepositoryFolder,
  getGitVersion,
  normalizeGitError,
  openRepository,
} from "@/lib/tauri";
import { RepositoryTabs, type RepositoryTab } from "@/workspace/RepositoryTabs";
import { WorkspaceLayout, WorkspaceLanding } from "@/workspace/WorkspaceLayout";
import { WorkspaceHeader } from "@/workspace/WorkspaceHeader";
import { WorkspaceGroups, GroupRenameForm } from "@/workspace/WorkspaceGroups";
import { RepositorySidebar } from "@/workspace/RepositorySidebar";
import { RepositoryCreation } from "@/workspace/RepositoryCreation";
import { useRepositorySidebar } from "@/workspace/useRepositorySidebar";

type Tab = RepositoryTab;
export default function Workspace() {
  const { compact, setCompact, sidebarWidth, setSidebarWidth } =
    useRepositorySidebar();
  const [gitReady, setGitReady] = useState(false);
  const [gitMessage, setGitMessage] = useState("Checking system Git…");
  const checkGit = useCallback(async () => {
    setGitReady(false);
    try {
      const output = await getGitVersion();
      setGitReady(true);
      setGitMessage(output.stdout.trim());
    } catch (error) {
      setGitMessage(
        `System Git is unavailable: ${normalizeGitError(error).message}. Install Git or check PATH, then try again.`,
      );
    }
  }, []);
  useEffect(() => {
    void checkGit();
  }, [checkGit]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [editingGroup, setEditingGroup] = useState<{
    original: string;
    name: string;
  } | null>(null);
  const [manageGroups, setManageGroups] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const busyPaths = useRef(new Set<string>());
  const feedback = useCallback(
    (
      path: string,
      busy: boolean,
      error: boolean,
      dirty: boolean,
      branch?: string,
    ) => {
      if (busy) busyPaths.current.add(path);
      else busyPaths.current.delete(path);
      setTabs((tabs) => {
        const current = tabs.find((tab) => tab.repository.path === path);
        if (
          !current ||
          (current.busy === busy &&
            current.error === error &&
            current.dirty === dirty &&
            (branch === undefined || current.branch === branch))
        )
          return tabs;
        return tabs.map((tab) =>
          tab === current
            ? { ...tab, busy, error, dirty, branch: branch ?? tab.branch }
            : tab,
        );
      });
    },
    [],
  );
  const open = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setError("");
    try {
      const path = await chooseRepositoryFolder();
      if (!path) return;
      const repository = await openRepository(path);
      setTabs((tabs) =>
        tabs.some((tab) => tab.repository.path === repository.path)
          ? tabs
          : [
              ...tabs,
              {
                repository,
                group: "",
                busy: false,
                error: false,
                dirty: false,
              },
            ],
      );
      setActive(repository.path);
    } catch (error) {
      setError(normalizeGitError(error).message);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }, []);
  function close(tab: Tab) {
    if (busyPaths.current.has(tab.repository.path)) {
      setError(
        "Wait for this repository's operation and refresh to finish before closing its tab.",
      );
      return;
    }
    setTabs((tabs) => tabs.filter((item) => item !== tab));
    if (active === tab.repository.path)
      setActive(tabs.find((item) => item !== tab)?.repository.path ?? "");
  }
  function renameGroup(group: string, value: string) {
    const name = value.trim();
    if (!name || name === group) return;
    if (groups.includes(name)) {
      setError("A group with that name already exists.");
      return;
    }
    setEditingGroup(null);
    setGroups(groups.map((item) => (item === group ? name : item)));
    setTabs((tabs) =>
      tabs.map((tab) => (tab.group === group ? { ...tab, group: name } : tab)),
    );
  }
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
            onCreate={() => {
              const name = groupName.trim();
              if (name && !groups.includes(name)) setGroups([...groups, name]);
              setGroupName("");
            }}
            onRename={(group) => {
              setEditingGroup({ original: group, name: group });
              setManageGroups(false);
            }}
            onRemove={(group) => {
              setGroups(groups.filter((item) => item !== group));
              setTabs((tabs) =>
                tabs.map((tab) =>
                  tab.group === group ? { ...tab, group: "" } : tab,
                ),
              );
            }}
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
          <RepositoryTabs
            tabs={tabs}
            active={active}
            groups={groups}
            onSelect={setActive}
            onClose={close}
            onGroup={(path, group) =>
              setTabs((tabs) =>
                tabs.map((tab) =>
                  tab.repository.path === path ? { ...tab, group } : tab,
                ),
              )
            }
          />
          <p className="system-git-status" role="status">
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
            onCreated={(repository) => {
              setTabs((tabs) =>
                tabs.some((tab) => tab.repository.path === repository.path)
                  ? tabs
                  : [
                      ...tabs,
                      {
                        repository,
                        group: "",
                        busy: false,
                        error: false,
                        dirty: false,
                      },
                    ],
              );
              setActive(repository.path);
            }}
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
        <p role="alert" className="workspace-error">
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
          className="repository-view"
          key={tab.repository.path}
          hidden={active !== tab.repository.path}
        >
          <RepositoryApp
            initialRepository={tab.repository}
            onOpen={() => void open()}
            onFeedback={feedback}
          />
        </div>
      ))}
    </WorkspaceLayout>
  );
}
