export interface AppCommand {
  id: string;
  title: string;
  scope: "workspace" | "repository";
  focus?: boolean;
  reveal?: string;
}
export const appCommands: AppCommand[] = [
  { id: "repository.submodules", title: "Manage submodules…", scope: "repository" },
  { id: "repository.lfs", title: "Manage Git LFS…", scope: "repository" },
  { id: "file.stage", title: "Stage selected file", scope: "repository" },
  { id: "file.unstage", title: "Unstage selected file", scope: "repository" },
  { id: "file.discard", title: "Discard selected file…", scope: "repository" },
  { id: "conflict.draft", title: "Save resolution draft", scope: "repository" },
  {
    id: "conflict.resolve",
    title: "Save and mark selected conflict resolved",
    scope: "repository",
  },
  {
    id: "conflict.reload",
    title: "Reload selected conflict versions…",
    scope: "repository",
  },
  { id: "workspace.open", title: "Open repository", scope: "workspace" },
  {
    id: "workspace.groups",
    title: "Manage repository groups",
    scope: "workspace",
  },
  {
    id: "repository.refresh",
    title: "Refresh repository",
    scope: "repository",
  },
  { id: "view.history", title: "Show history", scope: "repository" },
  { id: "view.diff", title: "Show diff", scope: "repository" },
  {
    id: "view.changes",
    title: "Toggle changes inspector",
    scope: "repository",
  },
  {
    id: "history.search",
    title: "Search commits",
    scope: "repository",
    focus: true,
    reveal: "view.history",
  },
  {
    id: "history.inspect",
    title: "Inspect selected commit",
    scope: "repository",
  },
  { id: "history.amend", title: "Amend latest commit…", scope: "repository" },
  {
    id: "history.reword",
    title: "Reword selected commit…",
    scope: "repository",
  },
  {
    id: "history.cherryPick",
    title: "Cherry-pick selected commit…",
    scope: "repository",
  },
  {
    id: "history.revert",
    title: "Revert selected commit…",
    scope: "repository",
  },
  { id: "history.reset", title: "Reset branch…", scope: "repository" },
  {
    id: "history.interactiveRebase",
    title: "Interactive rebase…",
    scope: "repository",
  },
  { id: "rebase.continue", title: "Continue rebase", scope: "repository" },
  {
    id: "rebase.skip",
    title: "Skip current rebase commit…",
    scope: "repository",
  },
  {
    id: "operation.abort",
    title: "Abort active Git operation",
    scope: "repository",
  },
  { id: "branch.create", title: "Create local branch…", scope: "repository" },
  {
    id: "branch.switch",
    title: "Switch to selected branch",
    scope: "repository",
  },
  {
    id: "branch.rename",
    title: "Rename selected branch…",
    scope: "repository",
  },
  {
    id: "branch.integrate",
    title: "Merge or rebase selected branch…",
    scope: "repository",
  },
  {
    id: "branch.delete",
    title: "Delete selected branch…",
    scope: "repository",
  },
  {
    id: "remote.fetch",
    title: "Fetch configured remote…",
    scope: "repository",
  },
  {
    id: "remote.pull",
    title: "Pull with selected strategy…",
    scope: "repository",
  },
  { id: "remote.push", title: "Push to upstream", scope: "repository" },
  {
    id: "remote.force",
    title: "Review force-with-lease push…",
    scope: "repository",
  },
  { id: "stash.create", title: "Prepare a stash", scope: "repository" },
  { id: "tag.create", title: "Create local tag…", scope: "repository" },
  {
    id: "tag.delete",
    title: "Delete inspected local tag…",
    scope: "repository",
  },
  {
    id: "repository.diagnostics",
    title: "Inspect Git diagnostics",
    scope: "repository",
  },
  {
    id: "repository.tools",
    title: "Open external tools…",
    scope: "repository",
  },
];
export const keybindingStorageKey = "branchlight.keybindings";
export const paletteCommand = "commands.open";
export type Keybindings = Record<string, string>;
export function macPlatform() {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
export function defaultKeybindings(mac = macPlatform()): Keybindings {
  const mod = mac ? "Meta" : "Ctrl";
  return {
    [paletteCommand]: `${mod}+K`,
    "workspace.open": `${mod}+O`,
    "repository.refresh": `${mod}+R`,
    "history.search": `${mod}+F`,
    "view.history": "Alt+H",
    "view.diff": "Alt+D",
  };
}
export function normalizeShortcut(value: string, mac = macPlatform()): string {
  if (!value.trim()) return "";
  const parts = value.split("+").map((part) => part.trim());
  const key = parts.pop()?.toUpperCase() ?? "";
  const modifiers = new Set(
    parts.map(
      (part) =>
        ({
          MOD: mac ? "Meta" : "Ctrl",
          CMD: "Meta",
          COMMAND: "Meta",
          META: "Meta",
          CTRL: "Ctrl",
          CONTROL: "Ctrl",
          ALT: "Alt",
          OPTION: "Alt",
          SHIFT: "Shift",
        })[part.toUpperCase()],
    ),
  );
  if (
    modifiers.has(undefined) ||
    modifiers.size !== parts.length ||
    !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(key) ||
    (!modifiers.has("Ctrl") &&
      !modifiers.has("Meta") &&
      !modifiers.has("Alt") &&
      !/^F\d+$/.test(key))
  )
    throw new Error(
      "Use Ctrl, Meta, Alt or Mod with a letter/digit, or F1–F12. Add Shift if needed. Navigation and text-editing keys are reserved.",
    );
  return ["Ctrl", "Meta", "Alt", "Shift"]
    .filter((modifier) => modifiers.has(modifier))
    .concat(key)
    .join("+");
}
export function validateKeybindings(bindings: Keybindings): Keybindings {
  const valid = new Set([
    paletteCommand,
    ...appCommands.map((command) => command.id),
  ]);
  const seen = new Map<string, string>(),
    result: Keybindings = {};
  for (const [id, value] of Object.entries(bindings)) {
    if (!valid.has(id)) continue;
    const shortcut = normalizeShortcut(value);
    if (shortcut && seen.has(shortcut))
      throw new Error(
        `Shortcut ${shortcut} is already assigned to ${seen.get(shortcut)}.`,
      );
    if (shortcut)
      seen.set(
        shortcut,
        id === paletteCommand
          ? "Open commands"
          : appCommands.find((command) => command.id === id)!.title,
      );
    result[id] = shortcut;
  }
  return result;
}
export function readKeybindings(): Keybindings {
  const defaults = defaultKeybindings();
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(keybindingStorageKey) ?? "null",
    );
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return defaults;
    const strings = Object.fromEntries(
      Object.entries(saved).filter(([, value]) => typeof value === "string"),
    ) as Keybindings;
    return validateKeybindings({ ...defaults, ...strings });
  } catch {
    return defaults;
  }
}
export function shortcutFromEvent(event: KeyboardEvent): string {
  if (event.isComposing || event.repeat || event.getModifierState("AltGraph"))
    return "";
  return [
    event.ctrlKey ? "Ctrl" : "",
    event.metaKey ? "Meta" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join("+");
}
export function activeRepository() {
  return (
    [
      ...document.querySelectorAll<HTMLElement>("[data-repository-context]"),
    ].find((element) => !element.closest("[hidden]")) ?? null
  );
}
/** Dedicated command markers adapt primary UI actions; their existing guards and dialogs remain authoritative. */
function structurallyHidden(element: HTMLElement): boolean {
  if (element.closest("[hidden]")) return true;
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent.localName === "details" && !parent.hasAttribute("open")) {
      const summary = [...parent.children].find(
        (child) => child.localName === "summary",
      );
      if (!summary?.contains(element)) return true;
    }
  }
  return false;
}
export function commandTarget(command: AppCommand) {
  const root = command.scope === "repository" ? activeRepository() : document;
  if (!root) return { element: null, reason: "Open a repository first." };
  const element =
    [...root.querySelectorAll<HTMLElement>("[data-command]")].find(
      (element) =>
        element.dataset.command === command.id &&
        (!command.id.startsWith("file.") ||
          (root instanceof HTMLElement &&
            !!root.dataset.selectedFile &&
            element.dataset.commandFile === root.dataset.selectedFile)) &&
        !element.closest('[role="dialog"]'),
    ) ?? null;
  if (!element)
    return {
      element: null,
      reason: "Select the relevant item or operation in the repository first.",
    };
  if (
    (element as HTMLButtonElement).disabled ||
    element.getAttribute("aria-disabled") === "true"
  )
    return {
      element: null,
      reason: element.title || "Unavailable in the current repository state.",
    };
  if (structurallyHidden(element) && !command.reveal)
    return {
      element: null,
      reason: "Open the relevant view or inspector first.",
    };
  return { element, reason: "" };
}
export function invokeCommand(
  command: AppCommand,
  expectedRepository: HTMLElement | null,
): boolean {
  if (document.querySelector('[role="dialog"]')) return false;
  if (
    command.scope === "repository" &&
    activeRepository() !== expectedRepository
  )
    return false;
  const target = commandTarget(command).element;
  if (!target) return false;
  if (command.reveal && target.closest("[hidden]")) {
    const reveal = appCommands.find((item) => item.id === command.reveal)!;
    const trigger = commandTarget(reveal).element;
    if (!trigger) return false;
    trigger.click();
    requestAnimationFrame(() => {
      if (
        activeRepository() === expectedRepository &&
        !target.closest("[hidden]")
      )
        target.focus();
    });
  } else if (command.focus) target.focus();
  else {
    target.focus({ preventScroll: true });
    target.click();
  }
  return true;
}
