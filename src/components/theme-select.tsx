import { useEffect, useState } from "react";
import {
  applyTheme,
  readTheme,
  themeStorageKey,
  type ThemePreference,
} from "@/lib/theme";
export function ThemeSelect() {
  const [preference, setPreference] = useState<ThemePreference>(readTheme);
  useEffect(() => {
    applyTheme(preference);
    const query = matchMedia("(prefers-color-scheme: dark)");
    const change = () => applyTheme(preference);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [preference]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === themeStorageKey || event.key === null)
        setPreference(readTheme());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return (
    <label className="theme-select">
      Appearance
      <select
        value={preference}
        onChange={(event) => {
          const value = event.target.value as ThemePreference;
          applyTheme(value);
          setPreference(value);
          try {
            localStorage.setItem(themeStorageKey, value);
          } catch {
            /* Preference remains usable for this session. */
          }
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
