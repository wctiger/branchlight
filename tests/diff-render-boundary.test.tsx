import "./setup-dom";
import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { lazy, Suspense } from "react";
import { DiffRenderBoundary } from "../src/features/inspection/DiffRenderBoundary";

afterEach(cleanup);

test("a rejected viewer import preserves the original patch and surrounding UI", async () => {
  let rejectImport!: (error: Error) => void;
  const Viewer = lazy(
    () =>
      new Promise<{ default: () => null }>((_resolve, reject) => {
        rejectImport = reject;
      }),
  );
  const patch = "@@ -1 +1 @@\n-before\n+<script>after()</script>\n";
  const view = render(
    <>
      <button>Repository actions</button>
      <DiffRenderBoundary text={patch}>
        <Suspense fallback={<p role="status">Loading diff viewer…</p>}>
          <Viewer />
        </Suspense>
      </DiffRenderBoundary>
    </>,
    { onCaughtError: () => {} },
  );
  expect(view.getByRole("status").textContent).toBe("Loading diff viewer…");
  rejectImport(new Error("Failed to fetch viewer chunk"));
  await waitFor(() =>
    expect(view.container.querySelector("pre")?.textContent).toBe(patch),
  );
  expect(view.getByRole("status").textContent).toContain("original output");
  expect(view.getByRole("button", { name: "Repository actions" })).toBeTruthy();
  expect(view.container.querySelector("script")).toBeNull();
});

test("a renderer failure falls back to raw text and a new patch can render again", async () => {
  function BrokenRenderer(): never {
    throw new Error("Renderer failed");
  }
  const view = render(
    <DiffRenderBoundary text="first patch">
      <BrokenRenderer />
    </DiffRenderBoundary>,
    { onCaughtError: () => {} },
  );
  expect(view.container.querySelector("pre")?.textContent).toBe("first patch");
  view.rerender(
    <DiffRenderBoundary text="second patch">
      <p>Working viewer</p>
    </DiffRenderBoundary>,
  );
  await waitFor(() => expect(view.getByText("Working viewer")).toBeTruthy());
  expect(view.container.querySelector("pre")).toBeNull();
});
