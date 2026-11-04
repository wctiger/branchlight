import "./setup-dom";
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { RefreshCw } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

afterEach(cleanup);

test("icon actions retain button styling, names, refs and disabled behavior", () => {
  let clicks = 0;
  const ref = createRef<HTMLButtonElement>();
  const view = render(<IconButton ref={ref} label="Refresh" icon={RefreshCw} onClick={() => clicks++} />);
  const button = view.getByRole("button", { name: "Refresh" });
  expect(ref.current).toBe(button);
  expect(button.getAttribute("data-slot")).toBe("button");
  expect(button.getAttribute("data-size")).toBe("icon-sm");
  expect(button.textContent).toBe("");
  expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  fireEvent.click(button);
  expect(clicks).toBe(1);
  view.rerender(<IconButton label="Refreshing…" icon={RefreshCw} disabled aria-busy onClick={() => clicks++} />);
  fireEvent.click(view.getByRole("button", { name: "Refreshing…" }));
  expect(clicks).toBe(1);
});

test("an icon action composes with a dialog trigger", async () => {
  const view = render(
    <Dialog>
      <DialogTrigger render={<IconButton label="Groups" icon={RefreshCw} />} />
      <DialogContent><DialogTitle>Repository groups</DialogTitle></DialogContent>
    </Dialog>,
  );
  const trigger = view.getByRole("button", { name: "Groups" });
  expect(trigger.getAttribute("data-slot")).toBe("button");
  fireEvent.click(trigger);
  expect(await view.findByRole("dialog", { name: "Repository groups" })).toBeTruthy();
});
