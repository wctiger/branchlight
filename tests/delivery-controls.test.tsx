import inspectionStyles from "@/features/inspection/InspectionPanel.module.css";
import "./setup-dom";
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke as fixture } from "./fixtures/backend";
import type { CommitOptions, DeliveryAction } from "../src/types/delivery";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let commitFailure = false;
let pushFailure = false;
let reviewOid = "b".repeat(40);
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
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
const { RepositoryApp } = await import("../src/App");

afterEach(() => {
  cleanup();
  calls.length = 0;
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
    <RepositoryApp
      initialRepository={{ name: "test", path: "/fixtures/test" }}
      onOpen={() => {}}
      onFeedback={() => {}}
    />,
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
  expect(
    view.container.querySelector(`.${inspectionStyles["text-diff"]}`),
  ).toBeNull();
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
