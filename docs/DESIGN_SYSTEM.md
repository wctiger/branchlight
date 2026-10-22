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
`#ff7518`. Git/status/graph colors are unchanged from the reviewed palettes.

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

## Dense geometry

| Foundation | Token |
|---|---|
| History row | `size.historyRow`: 32px |
| Shared controls | `size.control`: 28px |
| Branch row / repository tab | 32px |
| UI body / labels / compact metadata | 13px / 12px / 11px |
| Panel / control inline padding | 12px / 8px |
| Tab selection width | 120–180px, with options/close controls |

The spacing unit remains 4px; icons are 14px. Dense geometry removes repeated
padding and stacked commit metadata rather than reducing the body font below
13px. Tabs scroll horizontally, reveal the active repository, and offer an
all-repositories menu with full names/paths and state. Left/Right/Home/End switch
the tab selection; every close/options control remains available without hover.
Group assignment moves into each tab's options menu, with group management in a
shared dialog. Dirty markers reflect authoritative Git status.

History keeps a stable hash selection and uses Up/Down/Home/End to navigate.
Only visible rows plus eight rows of overscan on each side are mounted. Parent
edges intersecting that range and matching graph nodes use the same coordinates.
Full truncated values are available in accessible labels, titles, and selection
details. A focusable scroll region retains keyboard access when a focused row is
scrolled out of the virtual range. Refreshes and repository switching retain
selection and scroll position when the selected hash still exists.

The default desktop window becomes 1200×800, with an 800×600 minimum. Smaller
windows stack history below branches/changes, and all inspection controls remain
reachable through page scrolling. Coarse-pointer controls have larger targets.

## Shared components and native controls

Landing, repository toolbar, tab/group controls, branches, stashes, changes,
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
