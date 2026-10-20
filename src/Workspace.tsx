import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { useCallback, useEffect, useRef, useState } from "react";
import { RepositoryApp } from "./App";
import {
  chooseRepositoryFolder,
  createRepository,
  getGitVersion,
  normalizeGitError,
  openRepository,
} from "./lib/tauri";
import {
  RepositoryTabs,
  type RepositoryTab,
} from "./components/repository-tabs";
import { ThemeSelect } from "./components/theme-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./components/ui/dialog";

type Tab = RepositoryTab;
export default function Workspace() {
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
  const [destination, setDestination] = useState("");
  const [source, setSource] = useState("");
  const [creation, setCreation] = useState<{
    destination: string;
    message: string;
    busy: boolean;
  } | null>(null);
  const creatingRef = useRef(false);
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
    (path: string, busy: boolean, error: boolean, dirty: boolean) => {
      if (busy) busyPaths.current.add(path);
      else busyPaths.current.delete(path);
      setTabs((tabs) => {
        const current = tabs.find((tab) => tab.repository.path === path);
        if (
          !current ||
          (current.busy === busy &&
            current.error === error &&
            current.dirty === dirty)
        )
          return tabs;
        return tabs.map((tab) =>
          tab === current ? { ...tab, busy, error, dirty } : tab,
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
  async function create(clone: boolean) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    const chosenDestination = destination;
    setCreation({
      destination: chosenDestination,
      message: clone
        ? "Cloning with system Git…"
        : "Initializing with system Git…",
      busy: true,
    });
    try {
      const repository = await createRepository(
        chosenDestination,
        clone ? source : null,
      );
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
      setCreation({
        destination: chosenDestination,
        message: "Repository ready.",
        busy: false,
      });
    } catch (error) {
      const failure = normalizeGitError(error);
      setCreation({
        destination: chosenDestination,
        message: `${failure.message} ${failure.output?.stderr.trim() ?? ""}`,
        busy: false,
      });
    } finally {
      creatingRef.current = false;
    }
  }
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
    <>
      <Dialog open={manageGroups} onOpenChange={setManageGroups}>
        <header className="workspace-chrome">
          <div className="workspace-tools">
            <strong className="app-wordmark">
              Branchlight<span> / Workspace</span>
            </strong>
            <Button
              variant="outline"
              onClick={() => void open()}
              disabled={opening || !gitReady}
            >
              {opening ? "Opening…" : "Open repository"}
            </Button>
            <DialogTrigger render={<Button variant="ghost" />}>
              Groups
            </DialogTrigger>
            <ThemeSelect />
          </div>
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
        </header>
        <DialogContent finalFocus={() => (editingGroup ? false : true)}>
          <DialogHeader>
            <DialogTitle>Repository groups</DialogTitle>
            <DialogDescription>
              Organize open repositories. Changes last for this session.
            </DialogDescription>
          </DialogHeader>
          <form
            className="group-create"
            onSubmit={(event) => {
              event.preventDefault();
              const name = groupName.trim();
              if (name && !groups.includes(name)) setGroups([...groups, name]);
              setGroupName("");
            }}
          >
            <Input
              aria-label="New group name"
              placeholder="New group"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            />
            <Button
              type="submit"
              variant="default"
              disabled={!groupName.trim()}
            >
              Create group
            </Button>
          </form>
          {groups.map((group) => (
            <div className="group-manager-row" key={group}>
              <strong>{group}</strong>
              <Button
                variant="outline"
                onClick={() => {
                  setEditingGroup({ original: group, name: group });
                  setManageGroups(false);
                }}
              >
                Rename
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setGroups(groups.filter((item) => item !== group));
                  setTabs((tabs) =>
                    tabs.map((tab) =>
                      tab.group === group ? { ...tab, group: "" } : tab,
                    ),
                  );
                }}
              >
                Remove group
              </Button>
            </div>
          ))}
          {!groups.length && <p>No groups yet.</p>}
        </DialogContent>
      </Dialog>
      <p className="system-git-status" role="status">
        {gitMessage}{" "}
        {!gitReady && (
          <Button variant="outline" onClick={() => void checkGit()}>
            Check again
          </Button>
        )}
      </p>
      {editingGroup && (
        <form
          className="repository-create"
          onSubmit={(event) => {
            event.preventDefault();
            renameGroup(editingGroup.original, editingGroup.name);
          }}
        >
          <label>
            Rename {editingGroup.original}{" "}
            <Input
              autoFocus
              value={editingGroup.name}
              onChange={(event) =>
                setEditingGroup({ ...editingGroup, name: event.target.value })
              }
            />
          </label>
          <Button type="submit" variant="outline">
            Save group name
          </Button>
          <Button
            variant="outline"
            type="button"
            onClick={() => setEditingGroup(null)}
          >
            Cancel
          </Button>
        </form>
      )}
      <details className="repository-create">
        <summary>Initialize or clone a repository</summary>
        <p>
          Choose a new directory inside an existing parent. Existing
          destinations are never overwritten. Partial results are retained on
          failure.
        </p>
        <label>
          New destination directory{" "}
          <Input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="Absolute path to a new directory"
          />
        </label>
        <Button
          variant="outline"
          disabled={!!creation?.busy}
          onClick={() => {
            void chooseRepositoryFolder()
              .then((parent) => {
                if (parent) setDestination(`${parent}/new-repository`);
              })
              .catch((error) => setError(normalizeGitError(error).message));
          }}
        >
          Choose parent folder
        </Button>
        <label>
          Clone source URL or local path{" "}
          <Input
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          disabled={!!creation?.busy || !destination || !gitReady}
          onClick={() => void create(false)}
        >
          Initialize
        </Button>
        <Button
          variant="outline"
          disabled={!!creation?.busy || !destination || !source || !gitReady}
          onClick={() => void create(true)}
        >
          Clone
        </Button>
        {creation && (
          <p role="status" aria-busy={creation.busy}>
            <code>{creation.destination}</code>: {creation.message}
          </p>
        )}
      </details>
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      {!tabs.length && (
        <main className="landing-screen">
          <section className="landing-card">
            <h1>Branchlight</h1>
            <p>
              Open repositories in independent tabs. Each uses your installed
              Git and local configuration.
            </p>
            <Button
              variant="outline"
              onClick={() => void open()}
              disabled={opening || !gitReady}
            >
              Open repository
            </Button>
          </section>
        </main>
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
    </>
  );
}
