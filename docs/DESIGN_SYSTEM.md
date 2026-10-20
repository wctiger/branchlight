# Dense Orange design system

Issue #68 applies the reviewed Orange tokens to the existing app. The token
source remains `docs/design-system/themes.json`; the research gallery is not
part of the application or this change.

## Integration decision

Use shadcn/ui's **Base UI** components, owned locally in `src/components/ui`,
with Tailwind 4's Vite plugin and CSS-variable theming. `components.json` uses
`base-nova`, so the CLI resolves future additions to Base UI. Official components
were generated with `bunx --bun shadcn@latest add @shadcn/<component>` in an
isolated project, then merged with Branchlight's semantic colors, dense geometry,
and local `cn()` helper. No Radix dependency remains. This keeps React 19 and the
current Vite/Tauri pipeline; no router, provider accounts, or Rust Git changes
are needed.

Before adopting the components, the integration assessment identified:

- Tailwind was absent. Its reset replaces implicit native margins/type styles,
  so app typography, form controls, headings, and feature layouts are explicit.
- Default shadcn spacing and opacity-based primary colors do not meet the dense
  Orange contract. Shared CSS overrides use explicit reviewed hover/pressed
  colors, dark labels, 28px controls, and consistent focus outlines.
- Native form submission semantics must remain intact. Base UI buttons default to `type="button"`;
  every submit action declares `type="submit"` explicitly. Operation handlers
  and guards remain owned by the existing feature components.
- Base UI portals supply keyboard navigation and focus containment. Shared
  operation dialogs initially focus Cancel, prevent outside dismissal, retain
  operation-time guards, and restore the triggering element on close.
- The existing history graph needs identical row coordinates to the list.
  Fixed 32px token geometry and a virtual range with overscan keep both aligned.
  CSS `content-visibility` alone would not bound the retained repository DOM.

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

| Foundation | Before | Dense token |
|---|---|---|
| History row | 104px | `size.historyRow`: 32px |
| Shared controls | mixed, typically 36–40px | `size.control`: 28px |
| Branch row / repository tab | mixed, wrapping tabs | 32px |
| UI body / labels / compact metadata | mixed | 13px / 12px / 11px |
| Panel / control inline padding | mixed, often 20–28px | 12px / 8px |
| Tab selection width | natural text + per-tab select | 120–180px, with options/close controls |

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

## Migration coverage and exceptions

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

## Verification fixture and limits

`bun run dev:fixture` starts the real UI on port 1438 with a **serve-only** mock
Tauri boundary. Open repository twelve times for 12 long/similar repository
names, 30 contributors, 300 commits, multiple refs, and changed paths. Mutations
are explicitly rejected. Normal dev/build always resolves the real Tauri API;
the fixture is not a shipped demo or a replacement for native Git verification.
Production history remains limited to 200 commits from the Rust backend.

The before/after captures use 1440×1000:

- [Before](screenshots/design-system/before-light.png): 185px wrapping tab strip,
  104px history rows, roughly five visible commits.
- [After, light](screenshots/design-system/after-light.png) and
  [after, dark](screenshots/design-system/after-dark.png): 38px single-line tab
  strip, 32px rows, roughly 20–21 visible commits. The whole page has no horizontal
  overflow at this size; history retains its own horizontal overflow at smaller sizes.

A local Chrome run scrolling the fixture over 85 sampled frames (after five
warmup frames) measured a 13.4ms median, 24.3ms p95, 27.3ms maximum frame interval,
and 31 mounted rows. This is a local observation, not a cross-platform benchmark.
End reached commit 300 with matching focus/selection. Refresh and switching away
and back retained the selected hash and scroll offset (8926px in the recorded
switch check). Token tests validate actual declared color pairs; they are not a
complete accessibility certification. See the Delivery 1 verification addendum
for native evidence and any remaining platform acceptance gaps.


## Base UI migration verification

The shadcn CLI recognizes `base: "base"`, `style: "base-nova"`, Vite, Tailwind 4,
and all seven installed UI components. Buttons and badges use Base UI composition;
menus/tooltips use Base UI positioners and portals. Triggers use `render`, menu
selection uses `onClick`, and menu labels/items are inside groups. Input and Alert
remain the existing native HTML components; they have no Radix dependency.

Operation dialogs use `disablePointerDismissal`, cancel busy close requests,
choose Cancel with `initialFocus`, and restore the captured target with
`finalFocus`. Stash action buttons remain mounted while the confirmation is open,
so cancelling can restore the original Drop button. Tooltip delay remains 350ms.

Current Base UI captures: [light](screenshots/design-system/base-ui-light.png) and
[dark](screenshots/design-system/base-ui-dark.png). The earlier density comparison
and scrolling sample above are retained as historical measurements.

The migration passes 14 Bun tests and the production TypeScript/Vite build.
Browser fixture checks cover group creation by clicking Submit, group assignment,
all 12 repository menu items, keyboard menu selection, Cancel-first stash dialogs,
Escape focus restoration, both themes, and unchanged 28px controls/32px rows.
The prior native smoke evidence above predates Base UI; native macOS/Windows
acceptance must be repeated before claiming the migration has desktop runtime
coverage. CI build/test evidence is separate from native runtime acceptance.
