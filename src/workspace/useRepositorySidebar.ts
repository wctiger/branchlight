import { useEffect, useState } from "react";

function readSidebarPreference() {
  try {
    return JSON.parse(
      localStorage.getItem("branchlight.repositorySidebar") ?? "null",
    );
  } catch {
    return null;
  }
}
export function useRepositorySidebar() {
  const [compact, setCompact] = useState(
    () => readSidebarPreference()?.compact === true,
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const width = readSidebarPreference()?.width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.min(420, Math.max(300, width))
      : 310;
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "branchlight.repositorySidebar",
        JSON.stringify({ compact, width: sidebarWidth }),
      );
    } catch {
      /* Storage may be unavailable. */
    }
  }, [compact, sidebarWidth]);
  return { compact, setCompact, sidebarWidth, setSidebarWidth };
}
