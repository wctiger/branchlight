import mainStyles from "@/workspace/RepositoryMainContent.module.css";
import "./setup-dom";
import { afterEach, expect, test } from "bun:test";
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { RepositoryMainContent } from "@/workspace/RepositoryMainContent";
import { ChangesInspector } from "@/workspace/ChangesInspector";
import { RepositorySidebar } from "@/workspace/RepositorySidebar";
import { useRepositorySidebar } from "@/workspace/useRepositorySidebar";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

test("main mode and inspector toggles preserve both modes and the commit draft", () => {
  function Harness() {
    const [mode, setMode] = useState<"history" | "diff">("history");
    const [open, setOpen] = useState(true);
    return (
      <>
        <RepositoryMainContent
          mode={mode}
          inspectorOpen={open}
          filePath="src/App.tsx"
          onModeChange={setMode}
          onInspectorToggle={() => setOpen(!open)}
          history={<div data-testid="history">Selected commit</div>}
          diff={<div data-testid="diff">Selected file</div>}
        />
        <ChangesInspector open={open} width={310} onWidthChange={() => {}}>
          <input aria-label="Commit draft" defaultValue="Retain this draft" />
        </ChangesInspector>
      </>
    );
  }
  const view = render(<Harness />);
  const history = view.getByTestId("history");
  const diff = view.getByTestId("diff");
  const draft = view.getByLabelText("Commit draft");
  for (const mode of ["Diff", "History", "Diff", "History"]) {
    fireEvent.click(view.getByRole("button", { name: mode, exact: true }));
    expect(history.closest<HTMLElement>(`.${mainStyles["main-mode"]}`)!.hidden).toBe(
      mode !== "History",
    );
    expect(diff.closest<HTMLElement>(`.${mainStyles["main-mode"]}`)!.hidden).toBe(
      mode !== "Diff",
    );
    fireEvent.click(view.getByRole("button", { name: "Hide changes" }));
    expect(draft.closest<HTMLElement>("aside")!.hidden).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Show changes" }));
    expect(view.getByTestId("history")).toBe(history);
    expect(view.getByTestId("diff")).toBe(diff);
    expect(view.getByLabelText("Commit draft")).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe("Retain this draft");
  }
});

test("repository sidebar restores a bounded width and persists compact mode", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
  });
  window.localStorage.setItem(
    "branchlight.repositorySidebar",
    JSON.stringify({ compact: true, width: 999 }),
  );
  function Harness() {
    const { compact, setCompact, sidebarWidth, setSidebarWidth } =
      useRepositorySidebar();
    return (
      <RepositorySidebar
        compact={compact}
        sidebarWidth={sidebarWidth}
        onCompactChange={setCompact}
        onWidthChange={setSidebarWidth}
      >
        Repositories
      </RepositorySidebar>
    );
  }
  const view = render(<Harness />);
  fireEvent.click(
    view.getByRole("button", { name: "Expand repository sidebar" }),
  );
  const width = view.getByRole("slider", { name: "Repository sidebar width" });
  expect((width as HTMLInputElement).value).toBe("420");
  fireEvent.click(
    view.getByRole("button", { name: "Collapse repository sidebar" }),
  );
  expect(
    JSON.parse(window.localStorage.getItem("branchlight.repositorySidebar")!),
  ).toEqual({ compact: true, width: 420 });
});
