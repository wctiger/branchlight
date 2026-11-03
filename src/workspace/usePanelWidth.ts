import { useEffect, useState } from "react";

export function usePanelWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      const value = stored === null ? initial : Number(stored);
      return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, String(width)); } catch { /* Storage can be unavailable. */ }
  }, [key, width]);
  return [width, setWidth] as const;
}
