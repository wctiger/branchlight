import mainStyles from "@/workspace/RepositoryMainContent.module.css";
import "./setup-dom";
import { afterEach, expect, test } from "bun:test";
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { RepositoryMainContent } from "@/workspace/RepositoryMainContent";
import { ChangesInspector } from "@/workspace/ChangesInspector";
import { RepositorySidebar } from "@/workspace/RepositorySidebar";
import { PaneDivider } from "@/workspace/PaneDivider";
import { usePanelWidth } from "@/workspace/usePanelWidth";
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
  const width = view.getByRole("separator", { name: "Repository sidebar width" });
  expect(width.getAttribute("aria-valuenow")).toBe("420");
  fireEvent.click(
    view.getByRole("button", { name: "Collapse repository sidebar" }),
  );
  expect(
    JSON.parse(window.localStorage.getItem("branchlight.repositorySidebar")!),
  ).toEqual({ compact: true, width: 420 });
});


test("panel widths clamp stored values and restore changes across remounts", () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: window.localStorage });
  window.localStorage.setItem("branchlight.branchWidth", "999");
  function Harness() {
    const [width, setWidth] = usePanelWidth("branchlight.branchWidth", 230, 220, 360);
    return <><output aria-label="Branch width">{width}</output><button onClick={() => setWidth(280)}>Resize</button></>;
  }
  const first = render(<Harness />);
  expect(first.getByLabelText("Branch width").textContent).toBe("360");
  fireEvent.click(first.getByRole("button", { name: "Resize" }));
  first.unmount();
  const second = render(<Harness />);
  expect(second.getByLabelText("Branch width").textContent).toBe("280");
});

for (const edge of ["left", "right"] as const) {
  test(`${edge} divider follows pointer movement, clamps widths, and releases drag state`, () => {
    function Harness() {
      const [width, setWidth] = useState(310);
      return <PaneDivider label="Pane width" width={width} min={300} max={420} edge={edge} onWidthChange={setWidth} />;
    }
    const view = render(<Harness />);
    const divider = view.getByRole("separator");
    const captured: number[] = [];
    divider.setPointerCapture = (id) => { captured.push(id); };
    divider.releasePointerCapture = () => {};
    const sign = edge === "right" ? 1 : -1;
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 500 });
    expect(captured).toEqual([1]);
    expect(document.body.style.userSelect).toBe("none");
    fireEvent.pointerMove(divider, { pointerId: 2, clientX: 550 });
    expect(divider.getAttribute("aria-valuenow")).toBe("310");
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 500 + 50 * sign });
    expect(divider.getAttribute("aria-valuenow")).toBe("360");
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 500 + 500 * sign });
    expect(divider.getAttribute("aria-valuenow")).toBe("420");
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 500 - 500 * sign });
    expect(divider.getAttribute("aria-valuenow")).toBe("300");
    fireEvent.pointerUp(divider, { pointerId: 1 });
    expect(document.body.style.userSelect).toBe("");
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 550 });
    expect(divider.getAttribute("aria-valuenow")).toBe("300");
    fireEvent.keyDown(divider, { key: edge === "right" ? "ArrowRight" : "ArrowLeft" });
    expect(divider.getAttribute("aria-valuenow")).toBe("310");
    fireEvent.keyDown(divider, { key: "End" });
    expect(divider.getAttribute("aria-valuenow")).toBe("420");
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider.getAttribute("aria-valuenow")).toBe("300");
    fireEvent.pointerDown(divider, { button: 0, pointerId: 3, clientX: 500 });
    fireEvent.pointerCancel(divider, { pointerId: 3 });
    expect(document.body.style.cursor).toBe("");
    fireEvent.pointerDown(divider, { button: 0, pointerId: 4, clientX: 500 });
    view.unmount();
    expect(document.body.style.userSelect).toBe("");
  });
}
