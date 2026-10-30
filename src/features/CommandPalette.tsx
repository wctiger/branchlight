import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OperationDialog } from "@/components/operation-dialog";
import {
  activeRepository,
  appCommands,
  commandTarget,
  defaultKeybindings,
  invokeCommand,
  keybindingStorageKey,
  paletteCommand,
  readKeybindings,
  shortcutFromEvent,
  validateKeybindings,
  type AppCommand,
} from "@/lib/commands";
import styles from "@/features/CommandPalette.module.css";

export function CommandPalette() {
  const [open, setOpen] = useState(false),
    [settings, setSettings] = useState(false);
  const [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [bindings, setBindings] = useState(readKeybindings),
    [draft, setDraft] = useState(readKeybindings);
  const [, setRevision] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        document.querySelector('[role="dialog"]') ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
          ))
      )
        return;
      const pressed = shortcutFromEvent(event);
      const matched = Object.entries(bindings).find(
        ([, value]) => !!value && value === pressed,
      );
      if (!matched) return;
      event.preventDefault();
      if (matched[0] === paletteCommand) {
        setSettings(false);
        setQuery("");
        setError("");
        setOpen(true);
        return;
      }
      const command = appCommands.find((command) => command.id === matched[0]);
      if (!command) return;
      const target = commandTarget(command);
      if (target.element) invokeCommand(command, activeRepository());
      else {
        setSettings(false);
        setQuery(command.title);
        setError(target.reason);
        setOpen(true);
      }
    }
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [bindings]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === keybindingStorageKey || event.key === null)
        setBindings(readKeybindings());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!open) return;
    const observer = new MutationObserver(() =>
      setRevision((value) => value + 1),
    );
    const root = document.getElementById("root");
    if (root)
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "hidden",
          "disabled",
          "data-command",
          "data-command-file",
          "data-selected-file",
          "open",
          "data-repository-context",
          "aria-disabled",
        ],
      });
    if (!settings) requestAnimationFrame(() => search.current?.focus());
    return () => observer.disconnect();
  }, [open, settings]);
  const filtered = appCommands.filter((command) =>
    `${command.title} ${command.id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  function run(command: AppCommand) {
    const context = activeRepository();
    const target = commandTarget(command);
    if (!target.element) {
      setError(target.reason);
      return;
    }
    setOpen(false);
    requestAnimationFrame(() => {
      if (!invokeCommand(command, context)) {
        setSettings(false);
        setError(
          "Repository context or command availability changed. Review the current command state.",
        );
        setOpen(true);
      }
    });
  }
  return (
    <>
      <Button
        variant="ghost"
        title={
          bindings[paletteCommand]
            ? `Commands (${bindings[paletteCommand]})`
            : "Commands"
        }
        aria-keyshortcuts={bindings[paletteCommand] || undefined}
        onClick={() => {
          setSettings(false);
          setQuery("");
          setError("");
          setOpen(true);
        }}
      >
        Commands
      </Button>
      {open && (
        <OperationDialog
          title={settings ? "Keyboard shortcuts" : "Commands"}
          onClose={() => setOpen(false)}
          description={
            <p>
              {activeRepository()
                ? `Repository: ${activeRepository()!.dataset.repositoryContext}`
                : "Workspace commands. Open a repository for Git actions."}{" "}
              Shortcuts keep the same guards and confirmations as their primary
              actions. Shortcuts are ignored while typing or another dialog is
              open.
            </p>
          }
        >
          {settings ? (
            <>
              <p>
                Mod means Command on macOS and Ctrl on Windows. Use
                Ctrl/Meta/Alt with a letter or digit, or F1–F12. An empty
                binding disables its shortcut.
              </p>
              <div className={styles.bindings}>
                {[
                  { id: paletteCommand, title: "Open commands" },
                  ...appCommands,
                ].map((command) => (
                  <label key={command.id}>
                    {command.title}
                    <Input
                      aria-label={`Shortcut for ${command.title}`}
                      value={draft[command.id] ?? ""}
                      onChange={(event) =>
                        setDraft({ ...draft, [command.id]: event.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(defaultKeybindings());
                  setError("");
                }}
              >
                Restore defaults
              </Button>
              <Button
                onClick={() => {
                  try {
                    const validated = validateKeybindings(draft);
                    window.localStorage.setItem(
                      keybindingStorageKey,
                      JSON.stringify(validated),
                    );
                    setBindings(validated);
                    setError("");
                    setSettings(false);
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Unable to save keyboard shortcuts.",
                    );
                  }
                }}
              >
                Save bindings
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSettings(false);
                  setError("");
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Input
                ref={search}
                aria-label="Search commands"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (
                    event.key !== "ArrowDown" &&
                    event.key !== "ArrowUp" &&
                    event.key !== "Enter"
                  )
                    return;
                  const choices = [
                    ...document.querySelectorAll<HTMLButtonElement>(
                      "[data-command-result]:not(:disabled)",
                    ),
                  ];
                  if (!choices.length) return;
                  event.preventDefault();
                  if (event.key === "Enter") choices[0].click();
                  else
                    choices[
                      event.key === "ArrowDown" ? 0 : choices.length - 1
                    ].focus();
                }}
              />
              {filtered.length === 0 && <p>No commands match this search.</p>}
              <ul
                className={styles.results}
                aria-label="Available commands"
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                    return;
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  ];
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  if (index < 0 || !buttons.length) return;
                  event.preventDefault();
                  buttons[
                    (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                      buttons.length
                  ].focus();
                }}
              >
                {filtered.map((command) => {
                  const available = commandTarget(command);
                  return (
                    <li key={command.id}>
                      <Button
                        data-command-result={command.id}
                        variant="ghost"
                        disabled={!available.element}
                        onClick={() => run(command)}
                      >
                        <span>{command.title}</span>
                        <kbd>{bindings[command.id] ?? ""}</kbd>
                      </Button>
                      {!available.element && <p>{available.reason}</p>}
                    </li>
                  );
                })}
              </ul>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(bindings);
                  setSettings(true);
                  setError("");
                }}
              >
                Configure shortcuts…
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </OperationDialog>
      )}
    </>
  );
}
