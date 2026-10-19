export type ThemePreference = "light" | "dark" | "system";
export const themeStorageKey = "branchlight.theme";
export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(themeStorageKey);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* Restricted storage still permits an in-memory preference. */
  }
  return "system";
}
export function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.themePreference = preference;
}
