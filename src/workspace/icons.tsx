/** Renders the compact Branchlight brand mark used across app screens. */
export function BranchlightMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** Renders the folder glyph used by repository picker actions. */
export function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 6.75A2.25 2.25 0 0 1 5.75 4.5h3.17c.6 0 1.17.24 1.6.66l1.18 1.18c.14.14.33.22.53.22h6.02a2.25 2.25 0 0 1 2.25 2.25v7.94A2.25 2.25 0 0 1 18.25 19H5.75a2.25 2.25 0 0 1-2.25-2.25v-10Z" />
    </svg>
  );
}

/** Renders the refresh glyph used by status reload actions. */
export function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.1 7.4A8 8 0 1 0 20 14h-2.1a6 6 0 1 1-.4-4.9L14 12.5h7V5.4l-1.9 2Z" />
    </svg>
  );
}

/** Distinguishes stage and unstage actions without relying on color. */
export function StageIcon({ direction }: { direction: "stage" | "unstage" }) {
  return (
    <span className="stage-icon" aria-hidden="true">
      {direction === "stage" ? "+" : "−"}
    </span>
  );
}
