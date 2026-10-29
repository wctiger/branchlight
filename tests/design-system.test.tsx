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
    const closed: string[] = [];
    const tabs: RepositoryTab[] = Array.from({ length: 12 }, (_, i) => ({
      repository: { name: `repo-${i}`, path: `/repo-${i}` },
      group: "",
      busy: i === 11,
      error: false,
      dirty: true,
    }));
    function Harness() {
      const [active, setActive] = useState("/repo-0");
      return (
        <TooltipProvider>
          <RepositoryTabs
            tabs={tabs}
            groups={[]}
            active={active}
            onSelect={setActive}
            onGroup={() => {}}
            onClose={(tab) => closed.push(tab.repository.path)}
          />
        </TooltipProvider>
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
    expect(closed).toEqual([]);
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
      view.container.querySelectorAll(".history-item").length,
    ).toBeLessThan(40);
    const first =
      view.container.querySelector<HTMLButtonElement>(".history-item")!;
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
        .querySelector('[aria-pressed="true"]')
        ?.getAttribute("data-hash"),
    ).toBe(commits[299].hash);
    expect(
      view.container.querySelectorAll(".history-item").length,
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
    view.container.querySelectorAll<HTMLButtonElement>(".branch-item")[1],
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
