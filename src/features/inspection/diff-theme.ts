// Static, application-owned CSS crosses the library's Shadow DOM boundary.
// Repository text is never inserted into CSS or raw HTML.
export const tokenStyles = `
:host {
  --diffs-font-family: var(--font-mono);
  --diffs-font-size: var(--type-body);
  --diffs-line-height: 20px;
  --diffs-light-bg: var(--surface-panel);
  --diffs-dark-bg: var(--surface-panel);
  --diffs-fg-number-override: var(--text-secondary);
  --diffs-bg-addition-override: var(--git-add-background);
  --diffs-bg-deletion-override: var(--git-delete-background);
  --diffs-bg-addition-number-override: var(--git-add-background);
  --diffs-bg-deletion-number-override: var(--git-delete-background);
  --diffs-bg-context-override: var(--surface-panel);
  --diffs-bg-context-gutter-override: var(--surface-panel);
  --diffs-bg-separator-override: var(--surface-subtle);
  --diffs-bg-buffer-override: var(--surface-subtle);
  --diffs-addition-color-override: var(--git-add-text);
  --diffs-deletion-color-override: var(--git-delete-text);
  --diffs-modified-color-override: var(--text-accent);
  --diffs-tab-size: 4;
}`;
export const themes = { light: "pierre-light", dark: "pierre-dark" } as const;
export function themeSnapshot(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
export function subscribeTheme(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}
