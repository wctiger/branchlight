import { createWorkspaceStore } from "@/stores/workspace-store";
import { WorkspaceStoreContext } from "@/stores/workspace-context";

import "./setup-dom";
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke as fixture } from "./fixtures/backend";
import type { CommitOptions, DeliveryAction } from "../src/types/delivery";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let intercept:
  | ((
      command: string,
      args: Record<string, unknown>,
    ) => Promise<unknown> | undefined)
  | undefined;
let commitFailure = false;
let pushFailure = false;
let reviewOid = "b".repeat(40);
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    const intercepted = intercept?.(command, args);
    if (intercepted) return intercepted;
    if (command === "compose_commit") {
      if (commitFailure)
        throw {
          code: "commandFailed",
          message: "Hook rejected the commit",
          output: { stdout: "", stderr: "Hook failed", exitCode: 1 },
        };
      return {
        output: { stdout: "Committed", stderr: "", exitCode: 0 },
        pushError: pushFailure
          ? {
              code: "invalidOperationInput",
              message: "Set upstream before pushing",
            }
          : null,
      };
    }
    if (command === "get_remotes") return ["origin", "backup"];
    if (command === "review_push")
      return {
        branch: "main",
        localOid: "a".repeat(40),
        remote: "origin",
        remoteRef: "refs/heads/main",
        expectedOid: reviewOid,
        destinationId: "reviewed",
      };
    if (
      [
        "force_push",
        "fetch_remote",
        "pull_remote",
        "push_remote",
        "create_branch_at",
        "checkout_remote_branch",
        "set_branch_upstream",
      ].includes(command)
    )
      return { stdout: "ok", stderr: "", exitCode: 0 };
    return fixture(command, args);
  },
}));
const { CommitComposer, RemoteControls, BranchControls } =
  await import("../src/features/DeliveryControls");
const { createRepositoryStore } = await import("@/stores/repository-store");
const { RepositoryApp } = await import("../src/App");

afterEach(() => {
  cleanup();
  calls.length = 0;
  intercept = undefined;
  commitFailure = false;
  pushFailure = false;
  reviewOid = "b".repeat(40);
});

test("failed commit preserves summary/body and successful commit resets the per-commit hook bypass", async () => {
  const user = userEvent.setup({ document });
  let succeeds = false;
  const options: CommitOptions[] = [];
  const view = render(
    <CommitComposer
      staged={2}
      disabled={false}
      onCommit={async (value) => {
        options.push(value);
        return succeeds;
      }}
    />,
  );
  await user.type(view.getByLabelText("Summary"), "Keep draft");
  await user.type(view.getByLabelText("Body (optional)"), "Detailed body");
  await user.click(view.getByRole("checkbox", { name: /Skip pre-commit/ }));
  await user.click(view.getByRole("button", { name: "Commit", exact: true }));
  expect((view.getByLabelText("Summary") as HTMLInputElement).value).toBe(
    "Keep draft",
  );
  expect(
    (view.getByLabelText("Body (optional)") as HTMLTextAreaElement).value,
  ).toBe("Detailed body");
  succeeds = true;
  await user.click(view.getByRole("button", { name: "Commit", exact: true }));
  expect(options[1]).toEqual({
    summary: "Keep draft",
    body: "Detailed body",
    skipHooks: true,
    pushAfterCommit: false,
  });
  await waitFor(() =>
    expect((view.getByLabelText("Summary") as HTMLInputElement).value).toBe(""),
  );
  expect(
    (
      view.getByRole("checkbox", {
        name: /Skip pre-commit/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
});

test("remote dialogs send the selected remote, prune choice and typed pull strategy", async () => {
  const user = userEvent.setup({ document });
  const actions: DeliveryAction[] = [];
  const view = render(
    <RemoteControls
      path="/fixtures/repo"
      disabled={false}
      run={async (action) => {
        actions.push(action);
        return true;
      }}
    />,
  );
  await user.click(view.getByRole("button", { name: "Fetch…" }));
  await waitFor(() => expect(view.getAllByRole("option").length).toBe(2));
  await user.selectOptions(view.getByRole("combobox"), "backup");
  await user.click(view.getByRole("checkbox"));
  await user.click(view.getByRole("button", { name: "Fetch", exact: true }));
  expect(actions[0]).toEqual({ kind: "fetch", remote: "backup", prune: true });
  await user.click(view.getByRole("button", { name: "Pull…" }));
  await user.selectOptions(view.getByRole("combobox"), "rebase");
  await user.click(view.getByRole("button", { name: "Pull", exact: true }));
  expect(actions[1]).toEqual({ kind: "pull", strategy: "rebase" });
});

test("force confirmation starts on Cancel and sends the original reviewed lease", async () => {
  const user = userEvent.setup({ document });
  const actions: DeliveryAction[] = [];
  const view = render(
    <RemoteControls
      path="/fixtures/repo"
      disabled={false}
      run={async (action) => {
        actions.push(action);
        return true;
      }}
    />,
  );
  await user.click(view.getByRole("button", { name: "Force push…" }));
  await waitFor(() => expect(view.getByText("b".repeat(40))).not.toBeNull());
  expect(document.activeElement?.textContent).toBe("Cancel");
  reviewOid = "c".repeat(40);
  await user.click(
    view.getByRole("button", { name: "Push with reviewed lease" }),
  );
  expect(actions[0].kind).toBe("force");
  if (actions[0].kind === "force")
    expect(actions[0].review.expectedOid).toBe("b".repeat(40));
});

test("branch controls use the selected commit, explicit checkout and selected tracking ref", async () => {
  const user = userEvent.setup({ document });
  const actions: DeliveryAction[] = [];
  const view = render(
    <BranchControls
      commit={"d".repeat(40)}
      disabled={false}
      run={async (action) => {
        actions.push(action);
        return true;
      }}
      branches={{
        local: [
          {
            name: "main",
            fullRef: "refs/heads/main",
            commit: "d".repeat(40),
            isCurrent: true,
            upstream: null,
          },
        ],
        remote: [
          {
            name: "origin/main",
            fullRef: "refs/remotes/origin/main",
            commit: "d".repeat(40),
            isCurrent: false,
            upstream: null,
          },
        ],
      }}
    />,
  );
  await user.click(view.getByText("Branch start point and upstream"));
  await user.type(view.getByLabelText("New local branch"), "feature");
  await user.click(view.getByRole("checkbox"));
  await user.click(
    view.getByRole("button", { name: "Create at selected commit" }),
  );
  expect(actions[0]).toEqual({
    kind: "createAt",
    name: "feature",
    revision: "d".repeat(40),
    checkout: true,
  });
  await user.selectOptions(
    view.getByLabelText("Remote-tracking branch"),
    "refs/remotes/origin/main",
  );
  await user.selectOptions(
    view.getByLabelText("Existing local branch"),
    "main",
  );
  await user.click(view.getByRole("button", { name: "Set upstream" }));
  expect(actions[1]).toEqual({
    kind: "upstream",
    name: "main",
    reference: "refs/remotes/origin/main",
  });
});

test("commit success with push failure clears the draft, refreshes the source and never creates a duplicate", async () => {
  const user = userEvent.setup({ document });
  pushFailure = true;
  const view = render(
    <WorkspaceStoreContext value={createWorkspaceStore()}>
      <RepositoryApp
        initialRepository={{ name: "test", path: "/fixtures/test" }}
      />
    </WorkspaceStoreContext>,
  );
  await waitFor(() => expect(view.getByLabelText("Summary")).not.toBeNull());
  await user.type(view.getByLabelText("Summary"), "Commit once");
  await user.click(view.getByRole("checkbox", { name: /Push to upstream/ }));
  const previousReads = calls.filter(
    (call) => call.command === "get_repository_status",
  ).length;
  await user.click(view.getByRole("button", { name: "Commit", exact: true }));
  await waitFor(() =>
    expect(view.getByText(/Commit succeeded and remains local/)).not.toBeNull(),
  );
  expect(calls.filter((call) => call.command === "compose_commit").length).toBe(
    1,
  );
  expect(
    calls.filter((call) => call.command === "get_repository_status").length,
  ).toBeGreaterThan(previousReads);
  expect((view.getByLabelText("Summary") as HTMLInputElement).value).toBe("");
});

const { InspectionPanel } =
  await import("../src/features/inspection/InspectionPanel");
const { ChangesPanel } = await import("../src/workspace/ChangesPanel");
const change = {
  path: "src/review.ts",
  status: "modified" as const,
  originalPath: null,
};
const emptyStatus = {
  operation: "none" as const,
  branch: {
    name: "main",
    oid: "a".repeat(40),
    isDetached: false,
    upstream: null,
    ahead: null,
    behind: null,
  },
  staged: [],
  unstaged: [],
  conflicts: [],
  stashCount: 0,
};

test("selected diff follows staging and unstaging, preserves partial comparison, and clears removed paths", async () => {
  const selectedFile = { change, kind: "unstaged" };
  const props = {
    path: "/repo",
    commit: null,
    disabled: false,
    onDiscard: () => {},
    selectedFile,
  };
  const view = render(
    <InspectionPanel
      {...props}
      status={{ ...emptyStatus, unstaged: [change] }}
    />,
  );
  const diffs = () =>
    calls.filter(({ command }) => command === "get_text_diff");
  await waitFor(() => expect(diffs().at(-1)?.args.kind).toBe("unstaged"));
  view.rerender(
    <InspectionPanel
      {...props}
      status={{ ...emptyStatus, staged: [change] }}
    />,
  );
  await waitFor(() => expect(diffs().at(-1)?.args.kind).toBe("staged"));
  view.rerender(
    <InspectionPanel
      {...props}
      status={{ ...emptyStatus, staged: [change], unstaged: [change] }}
    />,
  );
  await waitFor(() => expect(diffs().at(-1)?.args.kind).toBe("unstaged"));
  view.rerender(
    <InspectionPanel
      {...props}
      selectedFile={{ change, kind: "staged" }}
      status={{ ...emptyStatus, staged: [change], unstaged: [change] }}
    />,
  );
  await waitFor(() => expect(diffs().at(-1)?.args.kind).toBe("staged"));
  view.rerender(
    <InspectionPanel
      {...props}
      selectedFile={{ change, kind: "staged" }}
      status={{ ...emptyStatus, unstaged: [change] }}
    />,
  );
  await waitFor(() => expect(diffs().at(-1)?.args.kind).toBe("unstaged"));
  const count = diffs().length;
  view.rerender(<InspectionPanel {...props} status={emptyStatus} />);
  expect(diffs()).toHaveLength(count);
  expect(view.queryByRole("region", { name: "File diff" })).toBeNull();
});

test("conflict selection uses the supported unstaged comparison and refreshes from conflict status", async () => {
  const conflict = { ...change, status: "conflicted" as const };
  const status = { ...emptyStatus, conflicts: [conflict] };
  let selection: { change: typeof change; kind: string } | null = null;
  const view = render(
    <ChangesPanel
      state={{
        state: "ready",
        status,
        isRefreshing: false,
        refreshError: null,
      }}
      stashesState={{
        state: "ready",
        stashes: [],
        isRefreshing: false,
        refreshError: null,
      }}
      controlsDisabled={false}
      onRefresh={() => {}}
      operation={{ state: "idle" }}
      operationError={null}
      stashOperationError={null}
      onSelectFile={(change, kind) => {
        selection = { change: change as typeof conflict, kind };
      }}
      onStage={() => {}}
      onUnstage={() => {}}
      onCommit={async () => true}
      onCreateStash={async () => true}
      onApplyStash={async () => true}
      onPopStash={async () => true}
      onDropStash={async () => true}
    />,
  );
  const user = userEvent.setup({ document });
  await user.click(view.getByRole("button", { name: change.path }));
  expect(selection?.kind).toBe("unstaged");
  view.unmount();
  render(
    <InspectionPanel
      path="/repo"
      commit={null}
      disabled={false}
      onDiscard={() => {}}
      selectedFile={selection}
      status={status}
    />,
  );
  await waitFor(() =>
    expect(
      calls.filter(({ command }) => command === "get_text_diff").at(-1)?.args
        .kind,
    ).toBe("unstaged"),
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test.each([true, false])(
  "repository stores ignore old refreshes (late failure: %s) and retain the last good snapshot on failure",
  async (lateFailure) => {
    const store = createRepositoryStore(
      { name: "one", path: "/one" },
      () => {},
    );
    const old = deferred<unknown>();
    let statusReads = 0;
    intercept = (command) =>
      command === "get_repository_status" && statusReads++ === 0
        ? old.promise
        : undefined;
    const first = store.getState().onRefresh();
    await store.getState().onRefresh();
    const latest = store.getState().statusState;
    expect(latest.state).toBe("ready");
    if (lateFailure)
      old.reject({ code: "commandFailed", message: "Late failure" });
    else old.resolve(await fixture("get_repository_status", { path: "/one" }));
    await first;
    expect(store.getState().statusState).toBe(latest);
    intercept = (command) =>
      command === "get_repository_status"
        ? Promise.reject({ code: "commandFailed", message: "Refresh failed" })
        : undefined;
    await store.getState().onRefresh();
    const failed = store.getState().statusState;
    expect(failed.state).toBe("ready");
    if (failed.state === "ready" && latest.state === "ready") {
      expect(failed.status).toBe(latest.status);
      expect(failed.refreshError?.message).toBe("Refresh failed");
      expect(failed.isRefreshing).toBe(false);
    }
  },
);

test("mutations stay guarded through refresh while another repository can progress", async () => {
  const workspace = createWorkspaceStore();
  const one = { name: "one", path: "/one" };
  workspace.getState().addRepository(one);
  const store = createRepositoryStore(one, () => {});
  const other = createRepositoryStore({ name: "two", path: "/two" }, () => {});
  const unsubscribe = store.subscribe((state) =>
    workspace
      .getState()
      .feedback(one.path, state.operation.state !== "idle", false, false),
  );
  const mutation = deferred<unknown>();
  const refresh = deferred<unknown>();
  intercept = (command, args) =>
    args.path === "/one"
      ? command === "compose_commit"
        ? mutation.promise
        : command === "get_repository_status"
          ? refresh.promise
          : undefined
      : undefined;
  const options = {
    summary: "Once",
    body: "",
    pushAfterCommit: false,
    skipHooks: false,
  };
  const pending = store.getState().onCommit(options);
  workspace.getState().close(workspace.getState().tabs[0]);
  expect(workspace.getState().tabs).toHaveLength(1);
  expect(await store.getState().onCommit(options)).toBe(false);
  expect(await other.getState().onCommit(options)).toBe(true);
  mutation.resolve({
    output: { stdout: "ok", stderr: "", exitCode: 0 },
    pushError: null,
  });
  await waitFor(() =>
    expect(store.getState().statusState.state).toBe("loading"),
  );
  expect(store.getState().operation.state).toBe("committing");
  expect(await store.getState().onCommit(options)).toBe(false);
  refresh.resolve(await fixture("get_repository_status", { path: "/one" }));
  expect(await pending).toBe(true);
  expect(store.getState().operation.state).toBe("idle");
  expect(
    calls.filter(
      (call) => call.command === "compose_commit" && call.args.path === "/one",
    ),
  ).toHaveLength(1);
  workspace.getState().close(workspace.getState().tabs[0]);
  expect(workspace.getState().tabs).toHaveLength(0);
  unsubscribe();
});

test("history reset captures the reviewed HEAD and requires an explicit destructive action", async () => {
  const { HistoryControls } =
    await import("../src/features/history/HistoryControls");
  const { commits } = await import("./fixtures/backend");
  const user = userEvent.setup({ document });
  const actions: DeliveryAction[] = [];
  const props = {
    commit: commits[0],
    head: commits[0].hash,
    branch: "main",
    disabled: false,
    run: async (action: DeliveryAction) => {
      actions.push(action);
      return true;
    },
  };
  const view = render(<HistoryControls {...props} />);
  await user.click(
    view.getByRole("button", { name: "Reset branch", exact: true }),
  );
  await user.click(view.getByRole("radio", { name: "hard", exact: true }));
  expect(view.getByText(/Untracked paths obstructing/)).toBeTruthy();
  view.rerender(<HistoryControls {...props} head={commits[1].hash} />);
  await user.click(
    view.getByRole("button", { name: "Discard changes and reset" }),
  );
  expect(actions).toEqual([
    {
      kind: "history",
      expectedHead: commits[0].hash,
      expectedBranch: "main",
      action: { kind: "reset", revision: commits[0].hash, mode: "hard" },
    },
  ]);
});

test("reword requires a full message and preserves the dialog on failure", async () => {
  const { HistoryControls } =
    await import("../src/features/history/HistoryControls");
  const { commits } = await import("./fixtures/backend");
  const user = userEvent.setup({ document });
  const view = render(
    <HistoryControls
      commit={commits[1]}
      head={commits[0].hash}
      branch="main"
      disabled={false}
      run={async () => false}
    />,
  );
  expect(
    (
      view.getByRole("button", {
        name: "Amend latest commit",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(
    view.getByRole("button", { name: "Reword commit", exact: true }),
  );
  const confirm = view
    .getAllByRole("button", { name: "Reword commit", exact: true })
    .at(-1) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  await user.type(
    view.getByLabelText("New full commit message"),
    "New summary\n\nBody",
  );
  await user.click(confirm);
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain(
      "Git could not complete",
    ),
  );
  expect(
    (view.getByLabelText("New full commit message") as HTMLTextAreaElement)
      .value,
  ).toContain("Body");
});

test("history actions use the repository store guard and refresh conflicts before matching abort", async () => {
  const store = createRepositoryStore(
    { name: "history", path: "/history" },
    () => {},
  );
  await store.getState().onRefresh();
  const mutation = deferred<unknown>();
  let stopped = false;
  intercept = (command) => {
    if (command === "execute_history_action") return mutation.promise;
    if (command === "get_repository_status")
      return fixture<import("../src/types/status").RepositoryStatus>(
        command,
      ).then((status) => ({
        ...status,
        operation: stopped ? "cherryPick" : "none",
      }));
    if (command === "abort_history_operation") {
      stopped = false;
      return Promise.resolve({ stdout: "aborted", stderr: "", exitCode: 0 });
    }
    return undefined;
  };
  const action: DeliveryAction = {
    kind: "history",
    expectedHead: "a".repeat(40),
    expectedBranch: "main",
    action: { kind: "cherryPick", revision: "b".repeat(40) },
  };
  const pending = store.getState().onDelivery(action);
  expect(store.getState().operation.state).toBe("editingHistory");
  expect(await store.getState().onDelivery(action)).toBe(false);
  expect(
    calls.find((call) => call.command === "execute_history_action")?.args,
  ).toEqual({
    path: "/history",
    expectedHead: action.expectedHead,
    expectedBranch: "main",
    action: action.action,
  });
  stopped = true;
  mutation.reject({ code: "commandFailed", message: "Cherry-pick conflicted" });
  expect(await pending).toBe(false);
  expect(store.getState().operation.state).toBe("idle");
  expect(store.getState().conflictOperationError?.message).toBe(
    "Cherry-pick conflicted",
  );
  const status = store.getState().statusState;
  expect(status.state === "ready" && status.status.operation).toBe(
    "cherryPick",
  );
  for (const command of [
    "get_repository_status",
    "get_branches",
    "get_stashes",
    "get_history",
  ])
    expect(calls.filter((call) => call.command === command)).toHaveLength(2);
  store.getState().onAbortOperation("revert");
  expect(calls.some((call) => call.command === "abort_history_operation")).toBe(
    false,
  );
  store.getState().onAbortOperation("cherryPick");
  await waitFor(() => expect(store.getState().operation.state).toBe("idle"));
  expect(
    calls.find((call) => call.command === "abort_history_operation")?.args,
  ).toEqual({ path: "/history", kind: "cherryPick" });
  const recovered = store.getState().statusState;
  expect(recovered.state === "ready" && recovered.status.operation).toBe(
    "none",
  );
  expect(store.getState().conflictOperationError).toBe(null);
});

test.each([
  ["merge", "Merge", "abortingMerge"],
  ["rebase", "Rebase", "abortingRebase"],
  ["cherryPick", "Cherry-pick", "abortingHistory"],
  ["revert", "Revert", "abortingHistory"],
] as const)(
  "abort controls display %s labels consistently",
  async (kind, label, state) => {
    const { ConflictBanner } = await import("../src/workspace/ConflictBanner");
    const status = await fixture<
      import("../src/types/status").RepositoryStatus
    >("get_repository_status");
    const props = {
      status: { ...status, operation: kind },
      operation: {
        state: "idle",
      } as import("../src/workspace/types").AppOperation,
      operationError: null,
      isRefreshing: false,
      controlsDisabled: false,
      onRefresh: () => {},
      onAbort: () => {},
      onRecoverRebase: async () => false,
    };
    const view = render(<ConflictBanner {...props} />);
    expect(
      view.getByRole("button", { name: `Abort ${label}`, exact: true }),
    ).toBeTruthy();
    view.rerender(<ConflictBanner {...props} operation={{ state }} />);
    expect(
      (
        view.getByRole("button", {
          name: `Aborting ${label}…`,
          exact: true,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  },
);

test("abort errors and notices never expose the cherryPick identifier", async () => {
  const store = createRepositoryStore(
    { name: "labels", path: "/labels" },
    () => {},
  );
  await store.getState().onRefresh();
  store.getState().onAbortOperation("cherryPick");
  expect(store.getState().conflictOperationError?.message).toContain(
    "active Cherry-pick to abort",
  );
  intercept = (command) => {
    if (command === "get_repository_status")
      return fixture<import("../src/types/status").RepositoryStatus>(
        command,
      ).then((status) => ({ ...status, operation: "cherryPick" }));
    if (command === "abort_history_operation")
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    return undefined;
  };
  await store.getState().onRefresh();
  store.getState().onAbortOperation("cherryPick");
  await waitFor(() => expect(store.getState().operation.state).toBe("idle"));
  expect(store.getState().operationNotice).toBe(
    "Cherry-pick aborted successfully.",
  );
});

test("diagnostics labels the PATH scan as a candidate", async () => {
  const { DiagnosticsPanel } = await import("../src/features/DiagnosticsPanel");
  const user = userEvent.setup({ document });
  const view = render(<DiagnosticsPanel path="/diagnostics" />);
  await user.click(view.getByRole("button", { name: "Diagnostics" }));
  await waitFor(() =>
    expect(view.getByText(/Git on PATH \(candidate\)/)).toBeTruthy(),
  );
  expect(view.getByText("/fixture/bin/git")).toBeTruthy();
  expect(
    view.getByText(/operating system may select a different executable/),
  ).toBeTruthy();
});

test("rebase recovery serializes mutations and refreshes a failed step into new conflict state", async () => {
  const store = createRepositoryStore({ name: "recovery", path: "/recovery" }, () => {});
  let conflicted = false;
  const pendingStep = deferred<unknown>();
  intercept = (command) => {
    if (command === "get_repository_status") return fixture<import("../src/types/status").RepositoryStatus>(command).then(status => ({
      ...status, operation: "rebase", conflicts: conflicted ? [{path: "next.txt", originalPath: null, status: "conflicted"}] : [],
    }));
    if (command === "recover_rebase") return pendingStep.promise;
    return undefined;
  };
  await store.getState().onRefresh();
  const pending = store.getState().onRecoverRebase("continue");
  expect(store.getState().operation.state).toBe("recoveringRebase");
  expect(await store.getState().onRecoverRebase("skip")).toBe(false);
  expect(calls.filter(c => c.command === "recover_rebase")).toHaveLength(1);
  expect(calls.find(c => c.command === "recover_rebase")?.args).toEqual({path: "/recovery", action: "continue"});
  conflicted = true;
  pendingStep.reject({code: "commandFailed", message: "Next commit conflicts"});
  expect(await pending).toBe(false);
  const state = store.getState();
  expect(state.operation.state).toBe("idle");
  expect(state.conflictOperationError?.message).toBe("Next commit conflicts");
  expect(state.statusState.state === "ready" && state.statusState.status.conflicts[0].path).toBe("next.txt");
  expect(await state.onRecoverRebase("continue")).toBe(false);
});

test("rebase skip requires explicit confirmation and continue is unavailable with unresolved files", async () => {
  const { ConflictBanner } = await import("../src/workspace/ConflictBanner");
  const status = await fixture<import("../src/types/status").RepositoryStatus>("get_repository_status");
  const actions: string[] = [];
  const user = userEvent.setup({ document });
  const view = render(<ConflictBanner status={{...status, operation: "rebase", conflicts: [{path: "conflict.txt", originalPath: null, status: "conflicted"}]}}
    operation={{state: "idle"}} operationError={null} isRefreshing={false} controlsDisabled={false}
    onRefresh={() => {}} onAbort={() => {}} onRecoverRebase={async action => {actions.push(action);return true;}} />);
  expect((view.getByRole("button", {name: "Continue rebase"}) as HTMLButtonElement).disabled).toBe(true);
  await user.click(view.getByRole("button", {name: "Skip rebase commit…"}));
  expect(actions).toEqual([]);
  expect(view.getByRole("dialog").textContent).toContain("discard its changes");
  await user.click(view.getByRole("button", {name: "Cancel", exact: true}));
  expect(actions).toEqual([]);
  await user.click(view.getByRole("button", {name: "Skip rebase commit…"}));
  await user.click(view.getByRole("button", {name: "Skip current commit", exact: true}));
  expect(actions).toEqual(["skip"]);
});

test("interactive rebase submits an explicitly reviewed ordered plan and blocks stale HEAD", async () => {
  const { InteractiveRebaseControls } = await import("../src/features/history/InteractiveRebaseControls");
  const alpha = "a".repeat(40), beta = "b".repeat(40);
  intercept = command => command === "get_rebase_plan" ? Promise.resolve([{hash: alpha, subject: "Alpha"}, {hash: beta, subject: "Beta"}]) : undefined;
  const submitted: DeliveryAction[] = [];
  const props = {path: "/rebase", revision: alpha, head: beta, branch: "main", disabled: false, run: async (action: DeliveryAction) => {submitted.push(action);return true;}};
  const view = render(<InteractiveRebaseControls {...props} />);
  const user = userEvent.setup({document});
  await user.click(view.getByRole("button", {name: "Interactive rebase…"}));
  await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
  await user.click(view.getByRole("button", {name: `Move ${beta.slice(0,12)} earlier`}));
  const selects = view.getAllByRole("combobox");
  await user.selectOptions(selects[0], "squash");
  expect((view.getByRole("button", {name: "Rewrite branch with this plan"}) as HTMLButtonElement).disabled).toBe(true);
  await user.selectOptions(selects[0], "reword");
  await user.type(view.getByRole("textbox"), "New beta message");
  view.rerender(<InteractiveRebaseControls {...props} head={"c".repeat(40)} />);
  expect((view.getByRole("button", {name: "Rewrite branch with this plan"}) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<InteractiveRebaseControls {...props} />);
  expect(submitted).toEqual([]);
  await user.click(view.getByRole("button", {name: "Rewrite branch with this plan"}));
  expect(submitted).toEqual([{kind: "history", expectedHead: beta, expectedBranch: "main", action: {kind: "interactiveRebase", revision: alpha, steps: [{hash: beta, action: "reword", message: "New beta message"}, {hash: alpha, action: "pick", message: ""}]}}]);
});

test("conflict resolver retains edits on failed saves and requires a deliberate reload", async () => {
  const { default: ConflictResolver } = await import("../src/features/inspection/ConflictResolver");
  const snapshot = {filePath: "conflict.ts", operation: "rebase", base: "base\n", current: "current\n", incoming: "incoming\n", output: "draft\n", token: "reviewed-token"};
  intercept = command => command === "get_conflict_file" ? Promise.resolve(snapshot) : undefined;
  const saved: {output: string; markResolved: boolean}[] = [];
  const view = render(<ConflictResolver path="/resolution" filePath="conflict.ts" disabled={false} onSave={async (reviewed, output, markResolved) => {
    expect(reviewed.token).toBe("reviewed-token"); saved.push({output, markResolved});return false;
  }} />);
  const user = userEvent.setup({document});
  await waitFor(() => expect(view.getByLabelText("Resolution output")).toBeTruthy());
  expect(view.getByRole("region", {name: "Current · rebase result so far (ours)"})).toBeTruthy();
  expect(view.getByRole("region", {name: "Incoming · commit being replayed (theirs)"})).toBeTruthy();
  const output = view.getByLabelText("Resolution output") as HTMLTextAreaElement;
  await user.clear(output); await user.type(output, "chosen resolution");
  await user.click(view.getByRole("button", {name: "Save draft", exact: true}));
  expect(saved).toEqual([{output: "chosen resolution", markResolved: false}]);
  expect(output.value).toBe("chosen resolution");
  expect(view.getByRole("alert").textContent).toContain("draft is retained");
  await user.click(view.getByRole("button", {name: "Reload conflict versions"}));
  expect(view.getByRole("dialog").textContent).toContain("replaces your draft");
  await user.click(view.getByRole("button", {name: "Cancel", exact: true}));
  expect(output.value).toBe("chosen resolution");
  await user.click(view.getByRole("button", {name: "Save and mark resolved", exact: true}));
  expect(saved.at(-1)).toEqual({output: "chosen resolution", markResolved: true});
});

test("conflict saves use the store mutation guard and refresh after a partial save failure", async () => {
  const store = createRepositoryStore({name: "resolution", path: "/resolution"}, () => {});
  const snapshot = {filePath: "conflict.ts", operation: "merge", base: "base", current: "current", incoming: "incoming", output: "draft", token: "token"};
  const failure = deferred<unknown>();
  intercept = command => {
    if (command === "get_repository_status") return fixture<import("../src/types/status").RepositoryStatus>(command).then(status => ({...status, operation: "merge", conflicts: [{path: snapshot.filePath, originalPath: null, status: "conflicted"}]}));
    if (command === "save_conflict_file") return failure.promise;
    return undefined;
  };
  await store.getState().onRefresh();
  const initialReads = calls.filter(call => call.command === "get_repository_status").length;
  const pending = store.getState().onSaveConflict(snapshot, "resolved", true);
  expect(store.getState().operation.state).toBe("resolvingConflict");
  expect(await store.getState().onSaveConflict(snapshot, "another", true)).toBe(false);
  failure.reject({code: "commandFailed", message: "Saved file but stage failed"});
  expect(await pending).toBe(false);
  expect(calls.filter(call => call.command === "get_repository_status").length).toBeGreaterThan(initialReads);
  expect(store.getState().operation.state).toBe("idle");
  expect(store.getState().conflictOperationError?.message).toContain("stage failed");
});

test("local tag deletion retains the reviewed object ID across an external refresh", async () => {
  const { TagsPanel } = await import("../src/features/history/TagsPanel");
  const original = "a".repeat(40), moved = "b".repeat(40);
  let current = original;
  intercept = command => {
    if (command === "get_local_tags") return Promise.resolve([{name: "v1", objectId: current}]);
    if (command === "inspect_local_tag") return Promise.resolve({name: "v1", objectId: current, targetId: current, targetType: "commit", annotated: true, metadata: "Release notes", metadataTruncated: false});
    return undefined;
  };
  const submitted: DeliveryAction[] = [];
  const props = {path: "/repo with spaces", revision: original, disabled: false, refreshKey: 0, run: async (action: DeliveryAction) => {submitted.push(action);return false;}, onInspectCommit: () => {}};
  const view = render(<TagsPanel {...props} />);
  const user = userEvent.setup({document});
  await waitFor(() => expect(view.getByRole("button", {name: "v1", exact: true})).toBeTruthy());
  await user.click(view.getByRole("button", {name: "v1", exact: true}));
  await waitFor(() => expect(view.getByText("Release notes")).toBeTruthy());
  await user.click(view.getByRole("button", {name: "Delete local tag…", exact: true}));
  expect(submitted).toEqual([]);
  current = moved;view.rerender(<TagsPanel {...props} refreshKey={1} />);
  await user.click(view.getByRole("button", {name: "Delete reviewed local tag", exact: true}));
  expect(submitted).toEqual([{kind: "deleteTag", name: "v1", expectedOid: original}]);
});

test("local tag creation freezes the selected commit and does not invoke Git until confirmed", async () => {
  const { TagsPanel } = await import("../src/features/history/TagsPanel");
  intercept = command => command === "get_local_tags" ? Promise.resolve([]) : undefined;
  const submitted: DeliveryAction[] = [];
  const props = {path: "/tags", revision: "a".repeat(40), disabled: false, refreshKey: 0, run: async (action: DeliveryAction) => {submitted.push(action);return true;}, onInspectCommit: () => {}};
  const view = render(<TagsPanel {...props} />);
  const user = userEvent.setup({document});
  await user.click(view.getByRole("button", {name: "Create tag at selected commit…"}));
  await user.type(view.getByLabelText("Tag name"), "release/v2");
  view.rerender(<TagsPanel {...props} revision={"b".repeat(40)} />);
  expect(submitted).toEqual([]);
  await user.click(view.getByRole("button", {name: "Create local tag", exact: true}));
  expect(submitted).toEqual([{kind: "createTag", name: "release/v2", revision: "a".repeat(40), annotation: null}]);
});

test("commit search discards responses from a previous repository and opens the current result", async () => {
  const { CommitSearch } = await import("../src/features/history/CommitSearch");
  const first = deferred<unknown>(), second = deferred<unknown>();
  intercept = (command, args) => command === "search_history" ? (args.path === "/first" ? first.promise : second.promise) : undefined;
  const inspected: string[] = [];
  const props = {refreshKey: 0, onSelect: (hash: string) => inspected.push(hash)};
  const view = render(<CommitSearch {...props} path="/first" />);
  const user = userEvent.setup({document});
  await user.type(view.getByLabelText("Search commits"), "needle");
  await waitFor(() => expect(calls.some(call => call.command === "search_history" && call.args.path === "/first")).toBe(true));
  view.rerender(<CommitSearch {...props} path="/second" />);
  await waitFor(() => expect(calls.some(call => call.command === "search_history" && call.args.path === "/second")).toBe(true));
  const commits = await fixture<import("../src/types/history").Commit[]>("get_history");
  first.resolve({commits: [{...commits[0], subject: "Stale result"}], limit: 200, hasMore: false});
  second.resolve({commits: [{...commits[1], subject: "Current result"}], limit: 200, hasMore: false});
  await waitFor(() => expect(view.getByText("Current result")).toBeTruthy());
  expect(view.queryByText("Stale result")).toBeNull();
  await user.click(view.getByRole("button", {name: `Inspect ${commits[1].hash} Current result`}));
  expect(inspected).toEqual([commits[1].hash]);
  await user.click(view.getByRole("button", {name: "Clear search", exact: true}));
  await waitFor(() => expect(Boolean(view.queryByText("Current result"))).toBe(false));
});

test("commit search communicates limits, empty matches and hash lookup errors", async () => {
  const { CommitSearch } = await import("../src/features/history/CommitSearch");
  intercept = (command, args) => command === "search_history" ? args.mode === "hash" ? Promise.reject({code: "invalidOperationInput", message: "Enter an unambiguous commit hash"}) : Promise.resolve({commits: [], limit: 200, hasMore: false}) : undefined;
  const view = render(<CommitSearch path="/search" refreshKey={0} onSelect={() => {}} />);
  const user = userEvent.setup({document});
  expect(view.getByText(/Up to 200 matching commits/)).toBeTruthy();
  await user.type(view.getByLabelText("Search commits"), "missing");
  await waitFor(() => expect(view.getByText(/No matching commits/)).toBeTruthy());
  await user.selectOptions(view.getByLabelText("Search by"), "hash");
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("unambiguous"));
  expect(view.queryByText(/No matching commits/)).toBeNull();
});

test("external tools capture file context, use structured local settings and offer explicit refresh", async () => {
  const { ExternalTools } = await import("../src/features/ExternalTools");
  const { saveToolPreferences, toolStorageKey } = await import("../src/lib/external-tools");
  const config = {executable: "/editor with spaces", args: ["--wait", "{target}", "$(literal)"]};
  saveToolPreferences({editor: config, terminal: {executable: "", args: ["{repository}"]}});
  const requests: import("../src/types/external-tools").ToolRequest[] = [];
  let refreshed = 0;
  const view = render(<ExternalTools path="/repo with spaces" file="file [x].txt" kind="staged" conflicted={false} disabled={false}
    launch={async request => {requests.push(request);return {jobId: null, message: "Started"};}} refresh={async () => {refreshed++;}} />);
  try {
    const user = userEvent.setup({document});
    await user.click(view.getByRole("button", {name: "External tools…"}));
    expect((view.getByRole("button", {name: "Open Git merge tool", exact: true}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(view.getByRole("button", {name: "Open editor", exact: true}));
    expect(requests[0]).toEqual({tool: "editor", filePath: "file [x].txt", staged: true, config});
    await user.click(view.getByRole("button", {name: "Open terminal", exact: true}));
    expect(requests[1]).toEqual({tool: "terminal", filePath: null, staged: true, config: null});
    await user.click(view.getByRole("button", {name: "Refresh after external changes"}));
    expect(refreshed).toBe(1);
  } finally {window.localStorage.removeItem(toolStorageKey);}
});

test("external tool settings reject shell-like argument strings instead of persisting them as arrays", async () => {
  const { ExternalTools } = await import("../src/features/ExternalTools");
  const { toolStorageKey } = await import("../src/lib/external-tools");
  window.localStorage.removeItem(toolStorageKey);
  const view = render(<ExternalTools path="/repo" file={null} kind={null} conflicted={false} disabled={false} launch={async () => null} refresh={async () => {}} />);
  const user = userEvent.setup({document});
  await user.click(view.getByRole("button", {name: "External tools…"}));
  await user.click(view.getByRole("button", {name: "Configure editor and terminal…"}));
  const args = view.getByLabelText("Editor arguments");
  await user.clear(args);await user.type(args, "--wait; unsafe()");
  await user.click(view.getByRole("button", {name: "Save tool settings", exact: true}));
  expect(view.getByRole("alert")).toBeTruthy();
  expect(window.localStorage.getItem(toolStorageKey)).toBeNull();
});

test("external tool failures refresh repository state and release the mutation guard", async () => {
  const store = createRepositoryStore({name: "tools", path: "/tool-repo"}, () => {});
  await store.getState().onRefresh();
  const pending = deferred<unknown>();
  intercept = command => command === "launch_external_tool" ? pending.promise : undefined;
  const before = calls.filter(call => call.command === "get_repository_status").length;
  const request = {tool: "merge" as const, filePath: "conflict.txt", staged: false, config: null};
  const launched = store.getState().onLaunchExternalTool(request);
  expect(store.getState().operation.state).toBe("launchingTool");
  expect(await store.getState().onLaunchExternalTool(request)).toBeNull();
  pending.reject({code: "commandFailed", message: "Merge tool failed after writing output"});
  expect(await launched).toBeNull();
  expect(calls.filter(call => call.command === "get_repository_status").length).toBeGreaterThan(before);
  expect(store.getState().operation.state).toBe("idle");
  expect(store.getState().conflictOperationError?.message).toContain("Merge tool failed");
});

const { LfsPanel } = await import("../src/features/LfsPanel");
const lfsState = {
  available: true, version: "git-lfs/3.8.1", filterConfigured: true,
  hookInstalled: true, hookPath: "/repo/.git/hooks/pre-push", storagePath: "/repo/.git/lfs/objects",
  pruneAllowed: true, pruneReason: "Default storage", patterns: [{pattern:"*.bin",source:".gitattributes",tracked:true,lockable:false}],
  files: [{name:"file [x].bin",oid:"a".repeat(64),size:20,checkout:false,downloaded:true}], head:"a".repeat(40),
};
test("LFS reviews captured remote and HEAD, displays pointer state, and refreshes after failure", async () => {
  const user = userEvent.setup({document});
  intercept = command => command === "get_lfs_state" ? Promise.resolve(lfsState) : undefined;
  const actions: DeliveryAction[] = [];
  const view = render(<LfsPanel path="/repo" disabled={false} run={async action => {actions.push(action); return false;}} />);
  await user.click(view.getByRole("button",{name:"LFS"}));
  await waitFor(() => expect(view.getByText(/pointer; cached; 20 bytes/)).toBeTruthy());
  await user.click(view.getByRole("button",{name:"Push objects…"}));
  expect(view.getByText(/Remote: origin/).textContent).toContain(lfsState.head);
  expect(actions).toHaveLength(0);
  expect(document.activeElement?.textContent).toBe("Cancel");
  await user.click(view.getByRole("button",{name:"Confirm push"}));
  await waitFor(() => expect(actions).toEqual([{kind:"lfs",action:{kind:"push",remote:"origin",expectedHead:lfsState.head}}]));
  await waitFor(() => expect(calls.filter(call => call.command === "get_lfs_state")).toHaveLength(2));
  expect(view.getByRole("button",{name:"Confirm push"})).toBeTruthy();
  expect(view.getByRole("status").textContent).toContain("stopped");
});
test("LFS missing tooling explains setup and cannot initialize or transfer", async () => {
  const user = userEvent.setup({document});
  intercept = command => command === "get_lfs_state" ? Promise.resolve({...lfsState,available:false,version:"Git LFS is unavailable"}) : undefined;
  const view = render(<LfsPanel path="/repo" disabled={false} run={async () => {throw Error("must not run");}} />);
  await user.click(view.getByRole("button",{name:"LFS"}));
  await waitFor(() => expect(view.getByRole("link",{name:"the official setup guide"})).toBeTruthy());
  expect(view.queryByRole("button",{name:"Initialize for this repository…"})).toBeNull();
});
test("LFS pruning requires preview confirmation and repository mutations share the store guard", async () => {
  const user = userEvent.setup({document});
  intercept = command => command === "get_lfs_state" ? Promise.resolve(lfsState)
    : command === "review_lfs_prune" ? Promise.resolve({report:"1 eligible object: oid123",token:"reviewed-token"})
    : command === "execute_lfs_action" ? Promise.reject({code:"commandFailed",message:"Remote missing object"}) : undefined;
  const repository = {name:"Repo",path:"/repo"};
  const store = createRepositoryStore(repository);
  const view = render(<LfsPanel path="/repo" disabled={false} run={store.getState().onDelivery} />);
  await user.click(view.getByRole("button",{name:"LFS"}));
  await user.click(await view.findByRole("button",{name:"Preview prune…"}));
  await waitFor(() => expect(view.getByText(/1 eligible object: oid123/)).toBeTruthy());
  expect(calls.some(call => call.command === "execute_lfs_action")).toBe(false);
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
  await user.click(view.getByRole("button",{name:"Confirm prune"}));
  await waitFor(() => expect(store.getState().operation.state).toBe("idle"));
  expect(store.getState().conflictOperationError?.message).toBe("Remote missing object");
  expect(calls.find(call => call.command === "execute_lfs_action")?.args).toEqual({path:"/repo",action:{kind:"prune",token:"reviewed-token"}});
  expect(calls.some(call => call.command === "get_repository_status")).toBe(true);
});

const { SubmodulesPanel } = await import("../src/features/SubmodulesPanel");
const { subscribeRelatedRepositoryRefresh } = await import("../src/stores/repository-refresh");
const childModule = {
  name:"vendor [x]/child space",path:"vendor [x]/child space",url:"ssh://git@example.invalid/team/repo.git",branch:null,
  expectedOid:"a".repeat(40),currentOid:"b".repeat(40),initialized:true,dirty:true,error:null,commonDirectory:"/repo/.git/modules/child",
};
const submoduleReview = {action:{kind:"reset" as const,path:childModule.path},path:childModule.path,token:"reviewed-child",parentHead:"c".repeat(40),expectedOid:childModule.expectedOid,currentOid:childModule.currentOid,effects:"Discard tracked child edits; retain unrelated untracked files."};
test("submodule reset shows reviewed revisions, starts on Cancel, and only executes after confirmation", async()=>{
  const user=userEvent.setup({document});
  intercept=(command,args)=>command==="get_submodules"?Promise.resolve([childModule])
    :command==="review_submodule_action"?Promise.resolve({...submoduleReview,action:args.action}):undefined;
  const actions:DeliveryAction[]=[];
  const view=render(<SubmodulesPanel path="/repo" disabled={false} error={null} run={async action=>{actions.push(action);return true;}} onOpened={()=>{}} />);
  await user.click(view.getByRole("button",{name:"Submodules"}));
  await user.click(await view.findByRole("button",{name:"Reset submodule…"}));
  await waitFor(()=>expect(view.getByRole("button",{name:"Confirm reset"})).toBeTruthy());
  expect(view.getByText(childModule.expectedOid)).toBeTruthy();expect(view.getByText(childModule.currentOid)).toBeTruthy();
  expect(actions).toHaveLength(0);expect(document.activeElement?.textContent).toBe("Cancel");
  await user.click(view.getByRole("button",{name:"Confirm reset"}));
  await waitFor(()=>expect(actions).toEqual([{kind:"submodule",review:submoduleReview}]));
  await waitFor(()=>expect(calls.filter(call=>call.command==="get_submodules")).toHaveLength(2));
  await waitFor(()=>expect(document.activeElement?.textContent).toBe("Cancel"));
});
test("submodule open revalidates its path through Rust and opens the returned repository context",async()=>{
  const user=userEvent.setup({document});
  const opened:{path:string;name:string}[]=[];
  intercept=command=>command==="get_submodules"?Promise.resolve([{...childModule,dirty:false}])
    :command==="open_submodule"?Promise.resolve({path:"/repo/vendor [x]/child space",name:"child space"}):undefined;
  const view=render(<SubmodulesPanel path="/repo" disabled={false} error={null} run={async()=>false} onOpened={repository=>opened.push(repository)} />);
  await user.click(view.getByRole("button",{name:"Submodules"}));
  await user.click(await view.findByRole("button",{name:"Open repository"}));
  await waitFor(()=>expect(opened).toEqual([{path:"/repo/vendor [x]/child space",name:"child space"}]));
  expect(calls.find(call=>call.command==="open_submodule")?.args).toEqual({path:"/repo",submodulePath:childModule.path});
});
test("submodule add previews source HEAD and reports remote failures before a mutation",async()=>{
  const user=userEvent.setup({document});
  intercept=command=>command==="get_submodules"?Promise.resolve([])
    :command==="review_submodule_action"?Promise.reject({code:"commandFailed",message:"Source is unavailable",output:{stdout:"",stderr:"Remote could not be read",exitCode:128}}):undefined;
  const view=render(<SubmodulesPanel path="/repo" disabled={false} error={null} run={async()=>{throw Error("must not execute");}} onOpened={()=>{}} />);
  await user.click(view.getByRole("button",{name:"Submodules"}));
  await user.click(await view.findByRole("button",{name:"Add submodule…"}));
  await user.type(view.getByLabelText("New submodule path (relative)"),"vendor/child");
  await user.type(view.getByLabelText("Source URL or absolute local path"),"ssh://git@example.invalid/repo");
  await user.click(view.getByRole("button",{name:"Review add"}));
  await waitFor(()=>expect(view.getByText("Remote could not be read")).toBeTruthy());
  expect(view.getByRole("button",{name:"Review add"})).toBeTruthy();
  expect(calls.some(call=>call.command==="execute_submodule_action")).toBe(false);
});
test("failed submodule mutations refresh parent and mounted child views without clearing child feedback",async()=>{
  intercept=command=>command==="execute_submodule_action"?Promise.reject({code:"commandFailed",message:"Changed submodule state"}):undefined;
  const parent=createRepositoryStore({path:"/repo",name:"Parent"},()=>{});
  const child=createRepositoryStore({path:"/repo/vendor [x]/child space",name:"Child"},()=>{});
  child.setState({branchOperationNotice:"Keep child feedback"});
  const unsubscribe=subscribeRelatedRepositoryRefresh(child.getState().repository.path,()=>void child.getState().onRelatedRefresh());
  try {
    expect(await parent.getState().onDelivery({kind:"submodule",review:submoduleReview})).toBe(false);
    await waitFor(()=>expect(calls.filter(call=>call.command==="get_repository_status").map(call=>call.args.path)).toContain(child.getState().repository.path));
    expect(calls.some(call=>call.command==="get_repository_status"&&call.args.path==="/repo")).toBe(true);
    expect(child.getState().branchOperationNotice).toBe("Keep child feedback");
    expect(parent.getState().conflictOperationError?.message).toBe("Changed submodule state");
    expect(parent.getState().operation.state).toBe("idle");
  } finally {unsubscribe();}
});


test("successful LFS checkout restores focus to the manager's Cancel button", async () => {
  const user=userEvent.setup({document});
  intercept=command=>command==="get_lfs_state"?Promise.resolve(lfsState):undefined;
  const view=render(<LfsPanel path="/repo" disabled={false} run={async()=>true} />);
  await user.click(view.getByRole("button",{name:"LFS"}));
  await user.click(await view.findByRole("button",{name:"Checkout cached content…"}));
  await user.click(await view.findByRole("button",{name:"Confirm checkout"}));
  await waitFor(()=>expect(view.queryByRole("button",{name:"Confirm checkout"})).toBeNull());
  await waitFor(()=>expect(document.activeElement?.textContent).toBe("Cancel"));
});

test("commit inspection exposes changed paths outside advanced controls and reloads the same commit after file selection or refresh", async () => {
  const user=userEvent.setup({document});
  const revision="c".repeat(40), base="b".repeat(40);
  intercept=(command,args)=>command==="compare_revisions"?Promise.resolve({base,target:args.target,files:[change]}):undefined;
  const props={path:"/repo",commit:revision,status:emptyStatus,selectedFile:null,disabled:false,onDiscard:()=>{}};
  const view=render(<InspectionPanel {...props} />);
  await waitFor(()=>expect(view.getByRole("region",{name:"Revision comparison"})).toBeTruthy());
  const region=view.getByRole("region",{name:"Revision comparison"});
  expect(region.closest("details")).toBeNull();
  expect(region.textContent).toContain(revision);
  await user.click(view.getByRole("button",{name:`modified ${change.path}`}));
  await waitFor(()=>expect(calls.filter(call=>call.command==="get_text_diff").at(-1)?.args).toMatchObject({path:"/repo",kind:"revisions",filePath:change.path,base,target:revision}));
  const status={...emptyStatus,unstaged:[change]};
  view.rerender(<InspectionPanel {...props} status={status} selectedFile={{change,kind:"unstaged"}} />);
  await waitFor(()=>expect(calls.filter(call=>call.command==="get_text_diff").at(-1)?.args.kind).toBe("unstaged"));
  const comparisons=()=>calls.filter(call=>call.command==="compare_revisions");
  const before=comparisons().length;
  view.rerender(<InspectionPanel {...props} status={status} />);
  await waitFor(()=>expect(comparisons().length).toBe(before+1));
  await waitFor(()=>expect(view.getByRole("region",{name:"Revision comparison"}).textContent).toContain(revision));
  view.rerender(<InspectionPanel {...props} status={{...emptyStatus}} />);
  await waitFor(()=>expect(comparisons().length).toBe(before+2));
  await waitFor(()=>expect(view.getByRole("region",{name:"Revision comparison"}).textContent).toContain(revision));
});


test("external tool configuration keeps technical input literal and persists JSON argument arrays", async () => {
  const { ExternalTools } = await import("../src/features/ExternalTools");
  const { readToolPreferences, toolStorageKey } = await import("../src/lib/external-tools");
  window.localStorage.removeItem(toolStorageKey);
  const user=userEvent.setup({document});
  const view=render(<ExternalTools path="/repo" file="notes [x].txt" kind="unstaged" conflicted={false} disabled={false} launch={async()=>null} refresh={async()=>{}} />);
  try {
    await user.click(view.getByRole("button",{name:"External tools…"}));
    await user.click(view.getByRole("button",{name:"Configure editor and terminal…"}));
    for (const name of ["Editor executable","Editor arguments","Terminal executable","Terminal arguments"]) {
      const input=view.getByLabelText(name);
      expect(input.getAttribute("autocorrect")).toBe("off");
      expect(input.getAttribute("spellcheck")).toBe("false");
    }
    await user.type(view.getByLabelText("Editor executable"),"/usr/bin/open");
    const args=view.getByLabelText("Editor arguments");
    await user.clear(args);
    await user.type(args,JSON.stringify(["-a","TextEdit","{target}"]).replace(/\[/g,"[[").replace(/\{/g,"{{"));
    await user.click(view.getByRole("button",{name:"Save tool settings",exact:true}));
    expect(readToolPreferences().editor).toEqual({executable:"/usr/bin/open",args:["-a","TextEdit","{target}"]});
  } finally {window.localStorage.removeItem(toolStorageKey);}
});
