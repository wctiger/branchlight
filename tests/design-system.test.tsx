import { createWorkspaceStore } from "@/stores/workspace-store";
import { WorkspaceStoreContext } from "@/stores/workspace-context";
import branchStyles from "@/features/branches/BranchPanel.module.css";
import historyStyles from "@/features/history/HistoryPanel.module.css";
import "./setup-dom";
import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepositoryTabs, type RepositoryTab } from "@/workspace/RepositoryTabs";
import { StashPanel } from "@/features/stashes/StashPanel";
import { BranchPanel } from "@/features/branches/BranchPanel";
import { OperationDialog } from "@/components/operation-dialog";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import { visibleHistoryRange } from "@/features/history/viewport";
import { applyTheme, readTheme, themeStorageKey } from "@/lib/theme";
import { commits } from "./fixtures/backend";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
// Use the browser storage object even when Bun has an unrelated host localStorage.
const localStorage = window.localStorage;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage,
});

describe("dense repository navigation", () => {
  test("reaches all twelve tabs with arrows and End, while a busy repository cannot close", async () => {
    const tabs: RepositoryTab[] = Array.from({ length: 12 }, (_, i) => ({
      repository: { name: `repo-${i}`, path: `/repo-${i}` },
      group: "",
      busy: i === 11,
      error: false,
      dirty: true,
    }));
    const store = createWorkspaceStore();
    store.setState({ tabs, active: "/repo-0" });
    function Harness() {
      return (
        <WorkspaceStoreContext value={store}>
          <TooltipProvider>
            <RepositoryTabs />
          </TooltipProvider>
        </WorkspaceStoreContext>
      );
    }
    const view = render(<Harness />);
    const first = view.getByRole("button", {
      name: "repo-0, uncommitted changes",
    });
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "End" });
    const last = view.getByRole("button", {
      name: "repo-11, uncommitted changes, working",
    });
    expect(last.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(last);
    expect(
      (view.getByRole("button", { name: "Close repo-11" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Close repo-11" }));
    expect(store.getState().tabs).toHaveLength(12);
    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);
    const user = userEvent.setup({ document });
    await user.click(view.getByRole("button", { name: "All 12 repositories" }));
    expect(view.getAllByRole("menuitem").length).toBe(12);
  });
});

describe("virtualized commit history", () => {
  test("bounds rendered rows and reaches the last of 300 commits without losing selection on refresh", async () => {
    const selected: string[] = [];
    const state = {
      state: "ready" as const,
      commits,
      isRefreshing: false,
      refreshError: null,
    };
    const view = render(
      <HistoryPanel
        state={state}
        controlsDisabled={false}
        onRefresh={() => {}}
        onSelectCommit={(hash) => selected.push(hash)}
      />,
    );
    expect(
      view.container.querySelectorAll(`.${historyStyles["history-item"]}`)
        .length,
    ).toBeLessThan(40);
    const first = view.container.querySelector<HTMLButtonElement>(
      `.${historyStyles["history-item"]}`,
    )!;
    fireEvent.keyDown(first, { key: "End" });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-hash")).toBe(
        commits[299].hash,
      ),
    );
    expect(selected.at(-1)).toBe(commits[299].hash);
    const scroll = view.getByRole("region", {
      name: "Scrollable commit history",
    });
    const top = scroll.scrollTop;
    view.rerender(
      <HistoryPanel
        state={{ ...state, commits: structuredClone(commits) }}
        controlsDisabled={false}
        onRefresh={() => {}}
        onSelectCommit={(hash) => selected.push(hash)}
      />,
    );
    expect(scroll.scrollTop).toBe(top);
    expect(
      view.container
        .querySelector(`.${historyStyles["history-item"]}[aria-pressed="true"]`)
        ?.getAttribute("data-hash"),
    ).toBe(commits[299].hash);
    expect(
      view.container.querySelectorAll(`.${historyStyles["history-item"]}`)
        .length,
    ).toBeLessThan(40);
    // Mouse scrolling must not leave focus on a row that is about to be unmounted.
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
    expect(document.activeElement).toBe(scroll);
  });
  test("handles empty lists and end-of-list overscan without invalid row indexes", () => {
    expect(visibleHistoryRange(0, 0, 480, 32)).toEqual({ start: 0, end: 0 });
    expect(visibleHistoryRange(300, 9500, 480, 32)).toEqual({
      start: 288,
      end: 300,
    });
  });
});

test("confirmation starts on Cancel, Escape preserves the operation and restores the trigger", async () => {
  const user = userEvent.setup({ document });
  let mutations = 0;
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Discard</button>
        {open && (
          <OperationDialog
            title="Discard selected file?"
            description="Permanently lose this file's changes."
            onClose={() => setOpen(false)}
          >
            <button onClick={() => mutations++}>Confirm discard</button>
            <button onClick={() => setOpen(false)}>Cancel</button>
          </OperationDialog>
        )}
      </>
    );
  }
  const view = render(<Harness />);
  const trigger = view.getByRole("button", { name: "Discard" });
  await user.click(trigger);
  await waitFor(() =>
    expect(document.activeElement?.textContent).toBe("Cancel"),
  );
  await user.keyboard("{Escape}");
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(mutations).toBe(0);
});

test("appearance reads saved choices and resolves explicit modes without relying on the OS", () => {
  localStorage.setItem(themeStorageKey, "dark");
  expect(readTheme()).toBe("dark");
  applyTheme("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  applyTheme("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  localStorage.setItem(themeStorageKey, "invalid");
  expect(readTheme()).toBe("system");
});

test("merge/rebase chooser opens from the selected branch and starts on Cancel", async () => {
  const user = userEvent.setup({ document });
  const main = {
    name: "main",
    fullRef: "refs/heads/main",
    commit: "a".repeat(40),
    isCurrent: true,
    upstream: null,
  };
  const feature = {
    ...main,
    name: "feature/work",
    fullRef: "refs/heads/feature/work",
    isCurrent: false,
  };
  const succeed = async () => true;
  const view = render(
    <BranchPanel
      state={{
        state: "ready",
        branches: { local: [main, feature], remote: [] },
        isRefreshing: false,
        refreshError: null,
      }}
      operationError={null}
      operationNotice={null}
      actionsDisabled={false}
      busyBranchName={null}
      onRefresh={() => {}}
      onSwitch={succeed}
      onCreate={succeed}
      onRename={succeed}
      onDelete={succeed}
      onMerge={succeed}
      onRebase={succeed}
    />,
  );
  await user.click(
    view.container.querySelectorAll<HTMLButtonElement>(
      `.${branchStyles["branch-item"]}`,
    )[1],
  );
  await user.click(view.getByRole("button", { name: "Merge / rebase…" }));
  expect(view.getByRole("dialog")).not.toBeNull();
  await waitFor(() =>
    expect(document.activeElement?.textContent).toBe("Cancel"),
  );
  await user.keyboard("{Escape}");
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});

test("busy confirmations reject Escape and backdrop presses until the operation settles", async () => {
  const user = userEvent.setup({ document });
  let closed = 0;
  const view = render(
    <OperationDialog
      title="Discard?"
      description="Changes will be lost."
      busy
      onClose={() => closed++}
    >
      <Button disabled>Confirm discard</Button>
      <Button disabled>Cancel</Button>
    </OperationDialog>,
  );
  await user.keyboard("{Escape}");
  await user.click(
    document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!,
  );
  expect(closed).toBe(0);
  expect(view.getByRole("dialog")).not.toBeNull();
  view.rerender(
    <OperationDialog
      title="Discard?"
      description="Changes will be lost."
      onClose={() => closed++}
    >
      <Button>Confirm discard</Button>
      <Button>Cancel</Button>
    </OperationDialog>,
  );
  await user.click(
    document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!,
  );
  expect(closed).toBe(0);
  await user.keyboard("{Escape}");
  expect(closed).toBe(1);
});

test("Base UI action buttons do not submit forms and explicit submit buttons do", async () => {
  const user = userEvent.setup({ document });
  let submissions = 0;
  const view = render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submissions++;
      }}
    >
      <Button>Action</Button>
      <Button type="submit">Save</Button>
    </form>,
  );
  await user.click(view.getByRole("button", { name: "Action" }));
  expect(submissions).toBe(0);
  await user.click(view.getByRole("button", { name: "Save" }));
  expect(submissions).toBe(1);
});

test("cancelling stash drop returns focus to the same mounted Drop button", async () => {
  const user = userEvent.setup({ document });
  const succeed = async () => true;
  const view = render(
    <StashPanel
      state={{
        state: "ready",
        stashes: [
          {
            reference: "stash@{0}",
            commit: "a".repeat(40),
            message: "Saved changes",
          },
        ],
        isRefreshing: false,
        refreshError: null,
      }}
      operationError={null}
      actionsDisabled={false}
      isCreating={false}
      busyReference={null}
      busyOperation={null}
      onRefresh={() => {}}
      onCreate={succeed}
      onApply={succeed}
      onPop={succeed}
      onDrop={succeed}
    />,
  );
  const trigger = view.getByRole("button", { name: "Drop", exact: true });
  await user.click(trigger);
  expect(trigger.isConnected).toBe(true);
  await waitFor(() =>
    expect(document.activeElement?.textContent).toBe("Cancel"),
  );
  await user.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("graph nodes select commits, retain keyboard focus, and expose bounded parents", async () => {
  const selected: string[] = [], inspected: string[] = [];
  const subset = commits.slice(0, 3);
  const props = {state: {state: "ready" as const, commits: subset, isRefreshing: false, refreshError: null}, controlsDisabled: true,
    onRefresh: () => {}, onSelectCommit: (hash: string) => selected.push(hash), onInspectCommit: (hash: string) => inspected.push(hash)};
  const view = render(<HistoryPanel {...props} />);
  const graphNode = view.getByRole("button", {name: `Select graph commit ${subset[1].hash} ${subset[1].subject}`});
  fireEvent.click(graphNode);
  expect(selected.at(-1)).toBe(subset[1].hash);
  expect(graphNode.getAttribute("aria-pressed")).toBe("true");
  await waitFor(() => expect(document.activeElement === graphNode).toBe(true));
  fireEvent.keyDown(document.activeElement!, {key: "ArrowDown"});
  await waitFor(() => expect(document.activeElement?.getAttribute("data-graph-hash")).toBe(subset[2].hash));
  expect(selected.at(-1)).toBe(subset[2].hash);
  expect(view.getByText(/outside loaded history/)).toBeTruthy();
  fireEvent.click(view.getByRole("button", {name: "Inspect selected commit"}));
  expect(inspected).toEqual([subset[2].hash]);
  view.rerender(<HistoryPanel {...props} state={{...props.state, commits: structuredClone(subset)}} />);
  expect(view.getByRole("button", {name: `Select graph commit ${subset[2].hash} ${subset[2].subject}`}).getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(document.activeElement!, {key: "Home"});
  await waitFor(() => expect(document.activeElement?.getAttribute("data-graph-hash")).toBe(subset[0].hash));
  fireEvent.click(view.getByRole("button", {name: `Select parent ${subset[1].hash}`}));
  await waitFor(() => expect(document.activeElement?.getAttribute("data-hash")).toBe(subset[1].hash));
});

test("appearance selection persists across remounts and follows system changes only in system mode", async () => {
  const { ThemeSelect } = await import("../src/components/theme-select");
  const original = globalThis.matchMedia;
  const listeners = new Set<() => void>();
  const media = {matches: false, addEventListener: (_type: string, callback: () => void) => listeners.add(callback), removeEventListener: (_type: string, callback: () => void) => listeners.delete(callback)};
  globalThis.matchMedia = () => media as unknown as MediaQueryList;
  try {
    const user = userEvent.setup({document});
    let view = render(<ThemeSelect />);
    await user.selectOptions(view.getByLabelText("Appearance"), "dark");
    expect(localStorage.getItem(themeStorageKey)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    view.unmount();
    view = render(<ThemeSelect />);
    expect((view.getByLabelText("Appearance") as HTMLSelectElement).value).toBe("dark");
    await user.selectOptions(view.getByLabelText("Appearance"), "light");
    act(() => {media.matches = true;listeners.forEach(listener => listener());});
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.selectOptions(view.getByLabelText("Appearance"), "system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    act(() => {media.matches = false;listeners.forEach(listener => listener());});
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  } finally {globalThis.matchMedia = original;}
});
