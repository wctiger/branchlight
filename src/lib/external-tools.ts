import type { ToolPreferences } from "@/types/external-tools";
export const toolStorageKey = "branchlight.externalTools";
export function readToolPreferences(): ToolPreferences {
  const defaults = {
    editor: { executable: "", args: ["{target}"] },
    terminal: { executable: "", args: ["{repository}"] },
  };
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(toolStorageKey) ?? "null",
    );
    if (!saved || typeof saved !== "object") return defaults;
    for (const key of ["editor", "terminal"] as const) {
      const config = (saved as Partial<ToolPreferences>)[key];
      if (
        config &&
        typeof config.executable === "string" &&
        Array.isArray(config.args) &&
        config.args.length <= 64 &&
        config.args.every((arg) => typeof arg === "string")
      )
        defaults[key] = config;
    }
  } catch {
    /* Restricted storage and malformed preferences retain usable defaults. */
  }
  return defaults;
}
export function saveToolPreferences(preferences: ToolPreferences) {
  window.localStorage.setItem(toolStorageKey, JSON.stringify(preferences));
}
