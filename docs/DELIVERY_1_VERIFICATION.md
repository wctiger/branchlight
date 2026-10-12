# Delivery 1 verification

Delivery 1 covers issues #32, #34, #35, #37, #39, #41, and #43 in milestone 5.
Implementation is in progress; do not close the milestone from build results alone.

## Available evidence

- `bun run build`: passed (TypeScript and production assets).
- `cargo clippy --locked --offline --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: passed with `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk`.
- `cargo fmt`: applied; formatting check remains a submission gate.
- Desktop application compiled and launched through `bun run tauri dev` with that SDK.
- The default local macOS 27 SDK was incompatible with the installed linker;
  the SDK override is local only, not a repository/CI configuration change.
- Computer Use reported permissions unavailable. Visual/runtime acceptance and
  screenshots remain pending. Launching the executable does not establish these.
- No new tests added and no test suites manually executed for this change.

## Acceptance audit and remaining runtime checks

Use disposable repositories and local bare remotes, never a repository containing
valuable uncommitted files, for destructive checks.

| Issue | Implemented path | Required evidence still pending |
|---|---|---|
| #32 scoped scheduling | Async Tauri commands, canonical common-directory locks, queued worker limit of 8; lock/permit ownership survives dropped callers. Stash global lock removed. | Slow checkout/fetch in A while inspecting/mutating independent B; linked-worktree mutations serialize; failures refresh originating views; no cross-tab stale results; previous staging/branch/stash/abort workflows still operate. |
| #34 tabs/groups | Retained mounted repository views; open/select/close, group create/rename/remove and tab assignment; background operation/error markers; busy close blocked. | Switch during loading/mutations and confirm final results remain in source tab; duplicate path aliases; close/reopen; group lifecycle; no deletion of repository data. |
| #35 initialize/clone | Atomically create a new directory, Git init/clone, open successful result; retain partial results and show destination errors. | Empty initialization, local-path clone, configured SSH/helper clone, invalid inputs, existing destinations untouched, interrupted/failed clone retained, unrelated repository remains usable. |
| #37 text diffs | Staged/unstaged and commit/revision text diffs; first parent for merges, empty tree for roots; rename pairs; binary/empty/large fallbacks. | Initial and merge commits, staged vs unstaged changes, deletion/rename, spaces/Unicode/option-like/pathspec-like filenames, binary file, >512 KiB and >8 MiB output, stale file/repo selection. Untracked files currently show a stage-or-external-editor fallback. |
| #39 file history/blame | Exact-path 100-entry history and committed porcelain blame; commit navigation; explicit no rename tracing or uncommitted attribution. | Author/date/summary, line attribution, history/blame navigation, empty history, removed/renamed path and missing revision, large blame truncation, loading/error/stale-result behavior. |
| #41 comparisons | Base→target with resolved IDs, changed-path list and per-file text diff; reverse, identical pair; first-parent commit shortcut. | Reversed and identical pairs, renamed/deleted files, unavailable refs, root/merge context, input changes during requests. |
| #43 discard | Inline confirmation naming path and effects; tracked modified/deleted/type-change reset index+worktree to HEAD; individual untracked unlink with parent containment; explicit unsupported add/rename/copy/conflict/directory states. | Confirm/cancel with staged+unstaged contents, deletion restoration, untracked deletion, symlink containment, unsupported states, partial failure refresh and precise selection. |

## Boundaries

- Uses installed Git and existing Git credentials/configuration. No provider login,
  credential storage, Git bundle, advanced clone, or batch clone.
- Whole-file staging only. No granular staging, editor, image comparison, commit
  file restore, ignore UI, patch import/export, or remote administration.
- Groups and open tabs currently last for the application session; persistence
  was not an acceptance requirement.
- Close is unavailable during a mutation and its authoritative refresh. Switching
  tabs remains available; read requests from a closed view are discarded.
- Diffs are plain read-only unified text; blame is committed content only.
- Each repository view has request generations. Inspection results are cleared
  when the authoritative status changes. Linked worktrees share a conservative
  lock for both reads and writes; independent repositories do not share that lock.

Both platform CI jobs and UI/runtime evidence must be reviewed before recording
Delivery 1 as complete. Windows downloaded-app runtime compatibility remains #28.
