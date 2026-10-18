# Delivery 1 verification

Delivery 1 covers issues #32, #34, #35, #37, #39, #41, and #43 in milestone 5.
Implementation is in progress; do not close the milestone from build results alone.

## Available evidence

Local verification on 2026-10-13:

- `bun test`: passed (3 graph tests).
- `bun run build`: passed (TypeScript and production assets).
- `bun run scripts/check-version.ts`: passed.
- `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml`: passed
  (50 tests), using `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk`.
- Clippy with all targets/features and warnings denied: passed with that SDK.
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml`: passed.
- The previously failing macOS and Windows CI jobs both reported
  `clippy::needless_late_init` in the diff implementation. The declaration is
  corrected. [CI run 38398597602](https://github.com/wctiger/branchlight/actions/runs/38398597602)
  passed the complete macOS job, including application bundling. Windows passed
  48 tests but failed the clone-content assertion because its configured
  `core.autocrlf` produced CRLF. The assertion now accepts Git's configured
  line endings; the corrected test passes locally both normally and with
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=true`.
  [CI run 38399061448](https://github.com/wctiger/branchlight/actions/runs/38399061448)
  then passed both complete platform jobs for `d75afd3`: macOS application
  bundling and Windows tests, Clippy, executable build, checksum collection and
  artifact upload. These results establish build/test compatibility, not
  downloaded-app runtime compatibility or desktop UI acceptance.
- `bun run tauri build --ci --bundles app -- --locked --offline`: passed
  locally with the same SDK, producing `Branchlight.app`.
- Earlier evidence: desktop application compiled and launched through
  `bun run tauri dev` with the macOS 15.4 SDK. Launch is not UI acceptance.
- Desktop access became available on 2026-10-17. The release app was exercised
  against disposable fixtures; the results below are partial runtime acceptance.

### Desktop acceptance observed on 2026-10-17

- Initialized and opened an empty repository; the app showed an unborn branch,
  empty changes and empty history. Retrying the same destination showed the
  existing-directory error without replacing the repository.
- Cloned a local repository through the UI and opened it alongside the empty
  repository. Created a group, assigned the clone tab, renamed the group and
  removed it; the tab returned to Ungrouped.
- Selected a root commit and inspected its empty-tree comparison and an addition
  with a Unicode/pathspec-like filename (`café [one].txt`). Selected a rename
  commit and inspected both rename paths in the text diff.
- File history displayed author, timestamp and summary; blame displayed committed
  line contents, author and commit. Clicking an attributed commit navigated to
  its first-parent changed-path comparison.
- Staged and unstaged `story.txt` previews showed distinct HEAD→index and
  index→worktree contents. A staged binary showed the explicit fallback; discard
  was disabled for that addition.
- The tracked-file discard confirmation named `story.txt` and explained loss of
  both staged and unstaged contents. Cancel left both versions unchanged, checked
  independently against the file and index. Destructive confirmation remains
  unverified in the desktop app.
- Visual inspection found unreadable controls under dark appearance and a clipped
  inspection panel at the default 800×600 window. Explicit themed foregrounds and
  surfaces fix the contrast; allowing the page to scroll exposes the complete
  diff and history/blame controls while retaining bounded repository panels.
- Rebuilt the release app and verified the fixes visually at its default size.
  Captured [unstaged diff](screenshots/delivery-1/unstaged-diff-dark.png) and
  [committed blame](screenshots/delivery-1/blame-dark.png) screenshots. Light
  appearance has explicit colors but has not been visually rechecked.
- Frontend tests (3), production frontend build, version consistency and release
  application bundling passed after these layout changes. The locally installed stable
  Rust toolchain was selected directly because the rustup proxy attempted a
  write outside the workspace while completing an earlier toolchain setup.

### Automated acceptance evidence

- Scheduler tests hold an operation in A, cancel its caller, and verify an
  independent B proceeds while a linked worktree waits. Another test holds eight
  workers, verifies a ninth does not start, then checks all queued work completes.
- Inspection tests use disposable repositories for root and merge first-parent
  comparisons, forward/reverse rename and deletion, identical/missing revisions,
  staged versus unstaged contents, literal pathspec-like and option-like paths,
  exact-path history metadata, committed blame, empty history and absent files.
- Binary fallback, 512 KiB truncation and the 8 MiB capture error are exercised.
- Discard tests check index/worktree restoration, deleted-file restoration,
  preservation of unselected paths, individual untracked removal, unsupported
  additions/directories, traversal rejection and (on Unix) symlink leaf unlink
  without deleting its external target.
- Creation tests check initialization, local-path clone, destination conflict
  preservation and retained failed-clone destinations.
- Existing staging, branch, remote, stash and merge/rebase abort backend tests
  remain green. Their integration through the desktop UI remains pending.

## Acceptance audit and remaining runtime checks

Use disposable repositories and local bare remotes, never a repository containing
valuable uncommitted files, for destructive checks.

| Issue | Implemented path | Required evidence still pending |
|---|---|---|
| #32 scoped scheduling | Async Tauri commands, canonical common-directory locks, queued worker limit of 8; lock/permit ownership survives dropped callers. Stash global lock removed. | Slow checkout/fetch in A while inspecting/mutating independent B; linked-worktree mutations serialize; failures refresh originating views; no cross-tab stale results; previous staging/branch/stash/abort workflows still operate. |
| #34 tabs/groups | Retained mounted repository views; open/select/close, group create/rename/remove and tab assignment; background operation/error markers; busy close blocked. | Switch during loading/mutations and confirm final results remain in source tab; duplicate path aliases; close/reopen; group lifecycle; no deletion of repository data. |
| #35 initialize/clone | Atomically create a new directory, Git init/clone, open successful result; retain partial results and show destination errors. | Empty initialization, local-path clone, configured SSH/helper clone, invalid inputs, existing destinations untouched, interrupted/failed clone retained, unrelated repository remains usable. |
| #37 text diffs | Staged/unstaged and commit/revision text diffs; first parent for merges, empty tree for roots; rename pairs; binary/empty/large fallbacks. | Remaining desktop cases: deletion/empty/large previews and stale file/repo selection. Root, rename, Unicode, staged/unstaged and binary cases observed above. Untracked files currently show a stage-or-external-editor fallback. |
| #39 file history/blame | Exact-path 100-entry history and committed porcelain blame; commit navigation; explicit no rename tracing or uncommitted attribution. | Remaining desktop cases: empty history, removed/renamed path, missing revision, large blame truncation and loading/error/stale-result behavior. Metadata, attribution and blame-to-comparison navigation observed above. |
| #41 comparisons | Base→target with resolved IDs, changed-path list and per-file text diff; reverse, identical pair; first-parent commit shortcut. | Desktop display/navigation for the automated comparison cases above; input changes during requests. |
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

Both platform CI jobs have passed for the implementation. The UI/runtime checks
above and screenshots remain required before recording Delivery 1 as complete.
Windows downloaded-app runtime compatibility remains #28.
