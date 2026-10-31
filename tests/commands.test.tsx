import "./setup-dom";
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { CommandPalette } from "../src/features/CommandPalette";
import { OperationDialog } from "../src/components/operation-dialog";
import { Button } from "../src/components/ui/button";
import {
  activeRepository,
  appCommands,
  defaultKeybindings,
  invokeCommand,
  keybindingStorageKey,
  normalizeShortcut,
  paletteCommand,
  readKeybindings,
  shortcutFromEvent,
  validateKeybindings,
} from "../src/lib/commands";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(keybindingStorageKey);
});
test("Option shortcuts handle macOS composed characters without overriding layout letters or IME input", () => {
  function optionEvent(key: string, code: string, isComposing = false, altGraph = false) {
    const event = new KeyboardEvent("keydown", { key, code, altKey: true, isComposing });
    // Happy DOM treats every Alt press as AltGraph; real browsers distinguish them.
    event.getModifierState = (modifier) => modifier === "AltGraph" && altGraph;
    return event;
  }
  expect(shortcutFromEvent(optionEvent("˙", "KeyH"))).toBe("Alt+H");
  expect(shortcutFromEvent(optionEvent("∂", "KeyD"))).toBe("Alt+D");
  expect(shortcutFromEvent(optionEvent("a", "KeyQ"))).toBe("Alt+A");
  expect(shortcutFromEvent(optionEvent("˙", "KeyH", true))).toBe("");
  expect(shortcutFromEvent(optionEvent("˙", "KeyH", false, true))).toBe("");
});
test("shifted digit shortcuts match their configured canonical binding", () => {
  for (const [key, code, binding, modifiers] of [
    ["!", "Digit1", "Ctrl+Shift+1", { ctrlKey: true }],
    ["@", "Digit2", "Meta+Shift+2", { metaKey: true }],
  ] as const) {
    const event = new KeyboardEvent("keydown", { key, code, shiftKey: true, ...modifiers });
    expect(shortcutFromEvent(event)).toBe(normalizeShortcut(binding));
  }
});
test("shortcut validation normalizes platform modifiers, catches conflicts and restores defaults", () => {
  expect(normalizeShortcut("mod+shift+r", true)).toBe("Meta+Shift+R");
  expect(normalizeShortcut("mod+shift+r", false)).toBe("Ctrl+Shift+R");
  expect(() => normalizeShortcut("R")).toThrow();
  expect(() => normalizeShortcut("Ctrl+Enter")).toThrow();
  const defaults = defaultKeybindings();
  expect(() =>
    validateKeybindings({
      ...defaults,
      "rebase.skip": defaults["repository.refresh"],
    }),
  ).toThrow("already assigned");
  window.localStorage.setItem(keybindingStorageKey, "invalid JSON");
  expect(readKeybindings()).toEqual(defaults);
  window.localStorage.setItem(
    keybindingStorageKey,
    JSON.stringify({ ...defaults, "repository.refresh": "" }),
  );
  expect(readKeybindings()["repository.refresh"]).toBe("");
});

test("commands only target the active repository and refuse a context that changed", () => {
  let first = 0,
    second = 0;
  const view = render(
    <>
      <main data-repository-context="first">
        <button data-command="repository.refresh" onClick={() => first++}>
          Refresh first
        </button>
      </main>
      <div hidden>
        <main data-repository-context="second">
          <button data-command="repository.refresh" onClick={() => second++}>
            Refresh second
          </button>
        </main>
      </div>
    </>,
  );
  const command = appCommands.find(
    (command) => command.id === "repository.refresh",
  )!;
  const original = activeRepository();
  expect(invokeCommand(command, original)).toBe(true);
  expect(first).toBe(1);
  expect(second).toBe(0);
  view.rerender(
    <>
      <div hidden>
        <main data-repository-context="first">
          <button data-command="repository.refresh" onClick={() => first++}>
            Refresh first
          </button>
        </main>
      </div>
      <main data-repository-context="second">
        <button data-command="repository.refresh" onClick={() => second++}>
          Refresh second
        </button>
      </main>
    </>,
  );
  expect(invokeCommand(command, original)).toBe(false);
  expect(invokeCommand(command, activeRepository())).toBe(true);
  expect(second).toBe(1);
});

test("palette invokes the primary reset confirmation without bypassing it", async () => {
  let mutations = 0;
  function Harness() {
    const [confirmation, setConfirmation] = useState(false);
    return (
      <div id="root">
        <main data-repository-context="/repo">
          <Button
            data-command="history.reset"
            onClick={() => setConfirmation(true)}
          >
            Primary reset
          </Button>
        </main>
        <CommandPalette />
        {confirmation && (
          <OperationDialog
            title="Confirm reset"
            description="Discard changes only after confirmation."
            onClose={() => setConfirmation(false)}
          >
            <Button variant="outline" onClick={() => setConfirmation(false)}>
              Cancel
            </Button>
            <Button onClick={() => mutations++}>
              Confirm destructive reset
            </Button>
          </OperationDialog>
        )}
      </div>
    );
  }
  const view = render(<Harness />);
  const user = userEvent.setup({ document });
  await user.click(view.getByRole("button", { name: "Commands", exact: true }));
  await user.type(view.getByLabelText("Search commands"), "Reset branch");
  await user.click(
    view.getByRole("button", { name: "Reset branch…", exact: true }),
  );
  await waitFor(() =>
    expect(view.getByRole("dialog", { name: "Confirm reset" })).toBeTruthy(),
  );
  expect(mutations).toBe(0);
  expect(document.activeElement?.textContent).toBe("Cancel");
  await user.click(view.getByRole("button", { name: "Cancel", exact: true }));
  expect(mutations).toBe(0);
});

test("shortcuts ignore text input and modal contexts, and use current action availability", async () => {
  let refreshed = 0;
  function Harness() {
    const [disabled, setDisabled] = useState(false);
    return (
      <div id="root">
        <main data-repository-context="/repo">
          <button
            data-command="repository.refresh"
            disabled={disabled}
            onClick={() => refreshed++}
          >
            Primary refresh
          </button>
          <input aria-label="Commit text" />
          <button onClick={() => setDisabled(true)}>Make busy</button>
        </main>
        <CommandPalette />
      </div>
    );
  }
  const view = render(<Harness />);
  const binding = defaultKeybindings()["repository.refresh"];
  const modifiers = {
    key: "r",
    ctrlKey: binding.includes("Ctrl"),
    metaKey: binding.includes("Meta"),
  };
  fireEvent.keyDown(view.getByLabelText("Commit text"), modifiers);
  expect(refreshed).toBe(0);
  fireEvent.keyDown(document.body, modifiers);
  expect(refreshed).toBe(1);
  fireEvent.click(view.getByRole("button", { name: "Commands", exact: true }));
  fireEvent.keyDown(document.body, modifiers);
  expect(refreshed).toBe(1);
  fireEvent.click(view.getByRole("button", { name: "Close", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Make busy" }));
  fireEvent.keyDown(document.body, modifiers);
  expect(refreshed).toBe(1);
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("Unavailable"),
  );
});

test("shortcut settings detect conflicts, persist edits, and restore defaults", async () => {
  const view = render(<CommandPalette />);
  const user = userEvent.setup({ document });
  await user.click(view.getByRole("button", { name: "Commands", exact: true }));
  await user.click(view.getByRole("button", { name: "Configure shortcuts…" }));
  const input = view.getByLabelText("Shortcut for Refresh repository");
  await user.clear(input);
  await user.type(input, defaultKeybindings()[paletteCommand]);
  await user.click(
    view.getByRole("button", { name: "Save bindings", exact: true }),
  );
  expect(view.getByRole("alert").textContent).toContain("already assigned");
  await user.click(
    view.getByRole("button", { name: "Restore defaults", exact: true }),
  );
  await user.click(
    view.getByRole("button", { name: "Save bindings", exact: true }),
  );
  expect(readKeybindings()[paletteCommand]).toBe(
    defaultKeybindings()[paletteCommand],
  );
  expect(window.localStorage.getItem(keybindingStorageKey)).not.toBeNull();
  await user.click(view.getByRole("button", { name: "Configure shortcuts…" }));
  const custom = view.getByLabelText("Shortcut for Refresh repository");
  await user.clear(custom);
  await user.type(custom, "Alt+Shift+J");
  await user.click(
    view.getByRole("button", { name: "Save bindings", exact: true }),
  );
  expect(readKeybindings()["repository.refresh"]).toBe("Alt+Shift+J");
});

test("file commands use the selected literal path and keep collapsed destructive controls unavailable", () => {
  let first = 0,
    second = 0,
    discarded = 0;
  const file = "file [x] with 'quotes'.txt";
  const view = render(
    <main data-repository-context="/repo" data-selected-file={file}>
      <button
        data-command="file.stage"
        data-command-file="other.txt"
        onClick={() => first++}
      >
        Other file
      </button>
      <button
        data-command="file.stage"
        data-command-file={file}
        onClick={() => second++}
      >
        Selected file
      </button>
      <details>
        <summary>Inspection tools</summary>
        <button
          data-command="file.discard"
          data-command-file={file}
          onClick={() => discarded++}
        >
          Primary discard
        </button>
      </details>
    </main>,
  );
  const stage = appCommands.find((command) => command.id === "file.stage")!;
  const discard = appCommands.find((command) => command.id === "file.discard")!;
  expect(invokeCommand(stage, activeRepository())).toBe(true);
  expect(first).toBe(0);
  expect(second).toBe(1);
  expect(invokeCommand(discard, activeRepository())).toBe(false);
  expect(discarded).toBe(0);
  view.container.querySelector("details")!.open = true;
  expect(invokeCommand(discard, activeRepository())).toBe(true);
  expect(discarded).toBe(1);
});
