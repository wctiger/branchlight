import { createStore } from "zustand/vanilla";
import {
  chooseRepositoryFolder,
  getGitVersion,
  normalizeGitError,
  openRepository,
} from "@/lib/tauri";
import type { Repository } from "@/types/repository";
import type { RepositoryTab } from "@/workspace/RepositoryTabs";

type EditingGroup = { original: string; name: string } | null;
export type WorkspaceState = {
  gitReady: boolean;
  gitMessage: string;
  tabs: RepositoryTab[];
  active: string;
  groups: string[];
  editingGroup: EditingGroup;
  manageGroups: boolean;
  groupName: string;
  error: string;
  opening: boolean;
  checkGit: () => Promise<void>;
  open: () => Promise<void>;
  addRepository: (repository: Repository) => void;
  close: (tab: RepositoryTab) => void;
  feedback: (
    path: string,
    busy: boolean,
    error: boolean,
    dirty: boolean,
    branch?: string,
  ) => void;
  setActive: (path: string) => void;
  setError: (error: string) => void;
  setManageGroups: (open: boolean) => void;
  setGroupName: (name: string) => void;
  setEditingGroup: (group: EditingGroup) => void;
  createGroup: () => void;
  renameGroup: (group: string, value: string) => void;
  removeGroup: (group: string) => void;
  assignGroup: (path: string, group: string) => void;
};

export function createWorkspaceStore() {
  let gitRequest = 0;
  return createStore<WorkspaceState>()((set, get) => ({
    gitReady: false,
    gitMessage: "Checking system Git…",
    tabs: [],
    active: "",
    groups: [],
    editingGroup: null,
    manageGroups: false,
    groupName: "",
    error: "",
    opening: false,
    checkGit: async () => {
      const request = ++gitRequest;
      set({ gitReady: false });
      try {
        const output = await getGitVersion();
        if (request === gitRequest)
          set({ gitReady: true, gitMessage: output.stdout.trim() });
      } catch (error) {
        if (request === gitRequest)
          set({
            gitMessage: `System Git is unavailable: ${normalizeGitError(error).message}. Install Git or check PATH, then try again.`,
          });
      }
    },
    open: async () => {
      if (get().opening) return;
      set({ opening: true, error: "" });
      try {
        const path = await chooseRepositoryFolder();
        if (path) get().addRepository(await openRepository(path));
      } catch (error) {
        set({ error: normalizeGitError(error).message });
      } finally {
        set({ opening: false });
      }
    },
    addRepository: (repository) =>
      set((state) => ({
        tabs: state.tabs.some((tab) => tab.repository.path === repository.path)
          ? state.tabs
          : [
              ...state.tabs,
              {
                repository,
                group: "",
                busy: false,
                error: false,
                dirty: false,
              },
            ],
        active: repository.path,
      })),
    close: (tab) =>
      set((state) => {
        const current = state.tabs.find(
          (item) => item.repository.path === tab.repository.path,
        );
        if (current?.busy)
          return {
            error:
              "Wait for this repository's operation and refresh to finish before closing its tab.",
          };
        const tabs = state.tabs.filter(
          (item) => item.repository.path !== tab.repository.path,
        );
        return {
          tabs,
          active:
            state.active === tab.repository.path
              ? (tabs[0]?.repository.path ?? "")
              : state.active,
        };
      }),
    feedback: (path, busy, error, dirty, branch) =>
      set((state) => {
        const current = state.tabs.find((tab) => tab.repository.path === path);
        if (
          !current ||
          (current.busy === busy &&
            current.error === error &&
            current.dirty === dirty &&
            (branch === undefined || current.branch === branch))
        )
          return state;
        return {
          tabs: state.tabs.map((tab) =>
            tab === current
              ? { ...tab, busy, error, dirty, branch: branch ?? tab.branch }
              : tab,
          ),
        };
      }),
    setActive: (active) => set({ active }),
    setError: (error) => set({ error }),
    setManageGroups: (manageGroups) => set({ manageGroups }),
    setGroupName: (groupName) => set({ groupName }),
    setEditingGroup: (editingGroup) => set({ editingGroup }),
    createGroup: () =>
      set((state) => {
        const name = state.groupName.trim();
        return {
          groups:
            name && !state.groups.includes(name)
              ? [...state.groups, name]
              : state.groups,
          groupName: "",
        };
      }),
    renameGroup: (group, value) =>
      set((state) => {
        const name = value.trim();
        if (!name || name === group) return state;
        if (state.groups.includes(name))
          return { error: "A group with that name already exists." };
        return {
          editingGroup: null,
          groups: state.groups.map((item) => (item === group ? name : item)),
          tabs: state.tabs.map((tab) =>
            tab.group === group ? { ...tab, group: name } : tab,
          ),
        };
      }),
    removeGroup: (group) =>
      set((state) => ({
        groups: state.groups.filter((item) => item !== group),
        tabs: state.tabs.map((tab) =>
          tab.group === group ? { ...tab, group: "" } : tab,
        ),
      })),
    assignGroup: (path, group) =>
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.repository.path === path ? { ...tab, group } : tab,
        ),
      })),
  }));
}
