# V1 verification

Verified on 2026-08-30 against disposable local Git repositories. Rust tests
exercise system Git with real repositories and remotes; frontend tests exercise
deterministic DAG fixtures. The production TypeScript build verifies typed Tauri
wiring and asset bundling.

| # | Capability | Verification evidence | Result |
|---:|---|---|:---:|
| 1 | Open one local repository | Repository path validation and nested-path tests | Pass |
| 2 | Show branch and status | Real-repository porcelain-v2 status test | Pass |
| 3 | Show staged/unstaged files | Ordinary, renamed, untracked, and conflict parser fixtures | Pass |
| 4 | Stage/unstage whole files | Real file and option-like path tests | Pass |
| 5 | Commit changes | Configured-identity commit test | Pass |
| 6 | Manage local branches | Create, switch, rename, and safe-delete lifecycle test | Pass |
| 7 | Display remote branches | Local/remote machine-ref parser test | Pass |
| 8 | Fetch | Disposable bare-remote lifecycle test | Pass |
| 9 | Pull | Disposable bare-remote lifecycle test | Pass |
| 10 | Push | Disposable bare-remote lifecycle test | Pass |
| 11 | Manage stashes | Create/list/apply/pop/drop and stale-selection tests | Pass |
| 12 | Merge by branch chooser/drag | Real merge test plus shared drag/keyboard chooser build | Pass |
| 13 | Rebase by branch chooser/drag | Real divergent rebase test plus shared drag/keyboard chooser build | Pass |
| 14 | Report merge/rebase conflicts | Real merge and rebase conflict-state tests | Pass |
| 15 | Abort merge/rebase | Operation-specific abort and wrong-operation rejection tests | Pass |
| 16 | Display recent history | Empty, malformed, merge-parent, ref, and 200-commit tests | Pass |
| 17 | Render a read-only DAG | Linear, divergent, two-parent merge, and exact-edge tests | Pass |

Additional hardening checks:

- One synchronous mutation guard rejects duplicate commands before React's
  disabled state can render.
- Every attempted mutation refreshes status, branches, stashes, and history on
  both success and failure.
- Refresh failures retain the last successful snapshot and surface contextual
  Git output.
- The tracked `public/vite.svg`, `public/tauri.svg`, and `src/assets/react.svg`
  scaffold assets were deleted, and the source tree contains no references to
  them.
- The full `bun test`, production web build, Tauri macOS application build,
  Rust test, rustfmt, and clippy gates pass together.
