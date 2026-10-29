import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@/stores/workspace-store";

test("workspace deduplicates repositories, closes stale tab objects and selects a surviving tab", () => {
  const store = createWorkspaceStore();
  const first = { name: "one", path: "/one" };
  const second = { name: "two", path: "/two" };
  store.getState().addRepository(first);
  const stale = store.getState().tabs[0];
  store.getState().addRepository(second);
  store.getState().addRepository(first);
  expect(store.getState().tabs).toHaveLength(2);
  store.getState().feedback(first.path, false, true, true, "feature");
  store.getState().close(stale);
  expect(store.getState().tabs.map((tab) => tab.repository.path)).toEqual([
    second.path,
  ]);
  expect(store.getState().active).toBe(second.path);
});

test("group creation, rename and removal update repository membership atomically", () => {
  const store = createWorkspaceStore();
  store.getState().addRepository({ name: "one", path: "/one" });
  store.getState().setGroupName(" Work ");
  store.getState().createGroup();
  store.getState().assignGroup("/one", "Work");
  store.getState().setGroupName("Personal");
  store.getState().createGroup();
  store.getState().renameGroup("Work", "Personal");
  expect(store.getState().tabs[0].group).toBe("Work");
  expect(store.getState().error).toContain("already exists");
  store.getState().renameGroup("Work", "Projects");
  expect(store.getState().groups).toEqual(["Projects", "Personal"]);
  expect(store.getState().tabs[0].group).toBe("Projects");
  store.getState().removeGroup("Projects");
  expect(store.getState().tabs[0].group).toBe("");
});
