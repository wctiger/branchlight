# Dense Orange design system

The application token source is `src/styles/tokens.json`. It owns the shared
foundations and Orange light/dark values; application code does not depend on
`docs/`.

## Integration decision

Use shadcn/ui's **Base UI** components, owned locally in `src/components/ui`,
with Tailwind 4's Vite plugin and CSS-variable theming. `components.json` uses
`base-nova`, so the CLI resolves future additions to Base UI. Official components
were generated with `bunx --bun shadcn@latest add @shadcn/<component>` in an
isolated project, then merged with Branchlight's semantic colors, dense geometry,
and local `cn()` helper. No Radix dependency remains. This keeps React 19 and the
current Vite/Tauri pipeline; no router, provider accounts, or Rust Git changes
are needed.

Integration rules:

- Shared controls use the reviewed semantic colors, 28px height, and focus outlines.
- Base UI buttons default to `type="button"`; submit actions declare `type="submit"`.
- Dialogs use `render` composition, `initialFocus` for Cancel, `finalFocus` for
  return focus, `disablePointerDismissal`, and busy-close guards. Stash triggers
  stay mounted while confirming so cancellation can restore focus.
- Menus group labels/items and use `onClick` for selection. Tooltips use a 350ms delay.
- History and its graph share fixed 32px row coordinates and a virtual range
  with overscan to bound rendered rows.

References: [Vite integration](https://ui.shadcn.com/docs/installation/vite),
[theming](https://ui.shadcn.com/docs/theming),
[Base UI components](https://ui.shadcn.com/docs/components/base/dialog).
Upstream MIT and both font OFL notices are packaged in `public/licenses/`.

## Token ownership and mapping

`src/lib/design-tokens.ts` resolves the JSON to CSS variables in Vite's HTML
transform. The variables are embedded in the document at dev/build time, before
first paint, with no fetch or generated token file to maintain. `:root` supplies
light values; `.dark` overrides the same names. Both primary fills remain
`#F37021`. Use `action.onPrimary` (`#24150c`) for text/icons on that fill;
white is not the primary foreground. Hover and pressed fills retain their own
semantic tokens. Text accents and focus rings use separate, contrast-checked
values: do not substitute the primary fill for every orange role. Git/status/graph
colors remain independent of the brand accent.

`src/styles/theme.css` maps those roles to shadcn/Tailwind's semantic utilities:

| shadcn role | Branchlight source |
|---|---|
| background, card, popover | `surface.panel` |
| foreground and matching surface foregrounds | `text.primary` |
| primary / primary-foreground | `action.primary` / `action.onPrimary` |
| primary hover / pressed | `action.primary.hover` / `action.primary.active` |
| secondary, muted | `surface.subtle` |
| muted-foreground | `text.secondary` |
| accent / accent-foreground | `selection.background` / `selection.text` |
| destructive action pair | `status.error.background` / `status.error.text` |
| border / input / ring | `border.subtle` / `border.control` / `focus.ring` |
| radius-md / radius-lg | `radius.control` / `radius.panel` |
| UI / monospace font | `font.ui` / `font.mono` |

Typography uses bundled Inter Variable and Cascadia Code at 400/600 weights,
with the reviewed platform fallbacks. `font.ui` adds Inter's actual packaged
family name; `font.mono` retains its existing name. Fontsource assets are bundled
by Vite; opening the packaged app does not require network access or font installation.

## Dense workspace layout

[Issue #72](https://github.com/wctiger/branchlight/issues/72) defines the workspace
layout. Its dimensions are logical CSS-pixel targets, not measurements extracted
from the conceptual mockups. Apply the same geometry in light and dark modes.

The desktop order is **Repositories → Branches → Main content → Changes**.
History and Diff occupy the same main column; never stack or vertically split the
graph and diff. Branches remain visible in both modes.

| Region | Expanded target | Compact / hidden | Current layout default |
|---|---|---|---|
| Repository sidebar | 300–320px, adjustable | 160px fixed | 310px; expanded adjustment 300–420px |
| Branch sidebar | 220–240px | Remains visible | 230px; 220px at narrow desktop widths |
| Main column | Flexible, minimum about 480px | Absorbs inspector width | Minimum 480px |
| Changes inspector | 300–320px, adjustable | 0px, no unused column | 310px; adjustment 300–420px |
| Global / header toolbars | 32–36px high | Same density | 36px baseline |
| Repository / branch / file rows | 28–30px, one line | Same density | 30px |
| Commit rows | 30–32px, one line | Same density | `size.historyRow`: 32px |
| Shared controls | `size.control`: 28px | Larger for coarse pointers | 28px |

The spacing unit is 4px, icons are 14px, and body / label / metadata sizes are
13px / 12px / 11px. Panel / control inline padding uses 12px / 8px foundations.
Density comes from reducing repeated padding and stacked metadata, not shrinking
the body font below 13px. Feature layout lives in `src/App.css`; shared foundations
live in the token source. Legacy tab and 32px branch-row foundations remain for
compatibility; sidebar rules supply the current 30px rows.

### Repository and branch navigation

Expanded repository rows show a generic repository icon, name, path, and current
branch **inline**. Prioritize the name and ellipsize the path first. Compact mode
shows only icon and ellipsized name, with no path, branch, or state marker taking
name width. A repository's identity must not assume its primary language;
customizable icons are an optional enhancement.

Highlight the active repository and reveal full name/path through a tooltip.
Provide a clearly labelled expand/collapse toggle and persist its mode and
expanded width locally under `branchlight.repositorySidebar`. Missing or invalid
preferences fall back to expanded 310px. Keep options/close actions keyboard
reachable, including when normally revealed on hover or focus. The all-repositories
menu provides another route to full names/paths. Up/Down (and Left/Right), Home,
and End switch repository selection; maintain visible focus and reveal the active
row. Switching repositories preserves each mounted repository's context.

Branches use local/remote groups and single-line name, current/checkout state,
and relevant ahead/behind counters. Avoid redundant subtitles and commit SHA
columns. Group management, branch start-point/tracking controls, and other
secondary operations remain accessible without expanding every row. Dirty markers
reflect authoritative Git status.

### Main modes and changes inspector

Keep a visible `History | Diff` switch and a persistent Show/Hide changes action.
Inspector visibility and main mode are independent states; all four combinations
must work:

| Main mode | Inspector open | Inspector hidden |
|---|---|---|
| History | Graph beside changes | Graph fills freed width |
| Diff | File diff beside changes | File diff fills freed width |

Selecting a changed file opens Diff across the entire main column and displays
its path in the main header. Preserve inspector visibility, selected file/commit,
and history selection/scroll across mode switches. Escape returns to History
unless focus is in a text editor/control or a dialog is open.

History keeps graph, abbreviated SHA, subject, refs, author, and relative time in
one row. Truncate long subjects without losing the other metadata columns. The
current renderer retains calendar dates; relative time remains a design target.
History and its graph share fixed 32px coordinates, with eight rows of overscan on
each side. Up/Down/Home/End navigate commits; retain a focusable scroll region
when a focused virtual row scrolls out of view. Refreshes retain hash selection
and scroll position when the selected hash still exists. Full truncated values
are available through accessible labels, titles, and selection details.

The inspector presents staged and unstaged groups with inline path/status,
per-file stage/unstage controls, and a commit composer. File lists scroll while
the composer remains accessible; the larger Delivery 2 composer scrolls internally
within a bounded area. Preserve summary/body, hook options, and push-after-commit
controls. Stashes remain available through a disclosure. Per-file +/- counts are
a design target and are not currently supplied by the status model.

Diff is a full-width scrollable code view. Syntax coloring, line numbers, changed-
hunk navigation, file/hunk stage and unstage actions, and an optional unified /
side-by-side switch are the target capabilities. **Further diff rendering and
styling belong to the separate third-party library integration.** The current
viewer provides a unified comparison, basic line numbers and hunk navigation;
syntax highlighting, hunk mutation controls, and side-by-side rendering remain
pending. This document does not establish their implementation or verification.

### Resize and accessibility

The default desktop window is 1200×800 with an 800×600 minimum. At narrow desktop
widths, keep the main column readable with a roughly 480px minimum and contain
horizontal overflow within the repository workspace. Do not stack History below
sidebars or introduce a graph/diff vertical split. Hiding Changes releases its
entire column; compact repository mode releases additional width.

Use accessible toggle names and expanded/pressed states, visible focus outlines,
and tooltips/titles for truncated content. Coarse-pointer targets may exceed the
dense baseline. Verify expanded and compact repository modes with all four main /
inspector combinations, long names/paths, keyboard navigation, per-repository
context, and scroll restoration. Build success is not runtime acceptance evidence.

## Shared components and native controls

Landing, repository toolbar, repository/group controls, branches, stashes, changes,
commit entry, history, inspection/diff controls, errors, and destructive operation
dialogs use the shared components or token-based feature styling. Diffs retain
literal +/− text and now use the Git background/text pairs; graph lanes remain
independent of the brand accent. Retained repository views use unique form and
heading IDs; the Stash shortcut targets its own repository.

Intentional native controls: appearance select, collapsible initialize/clone
section, and inline create/rename branch forms. The fixed-row history and graph
remain feature components rather than shadcn table/tabs, to retain custom graph
geometry and bounded rendering. Native OS folder pickers follow OS appearance.
Theme persistence is local under `branchlight.theme`; missing/invalid/storage-
restricted preferences fall back to System. System changes and cross-window
storage changes update appearance. Inline initialization resolves the preference
before first paint. This provides the basic preference integration requested by
#58 without adding general preferences or account synchronization.

## Development fixture

`bun run dev:fixture` starts the real UI on port 1438 with a **serve-only** mock
Tauri boundary. Open repository twelve times for 12 long/similar repository
names, 30 contributors, 300 commits, multiple refs, and changed paths. Mutations
are explicitly rejected. Normal dev/build always resolves the real Tauri API;
the fixture is not a shipped demo or a replacement for native Git verification.
Production history remains limited to 200 commits from the Rust backend.
