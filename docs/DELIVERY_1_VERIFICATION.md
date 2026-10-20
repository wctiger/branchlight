# Delivery 1 verification

Delivery 1 covers issues #32, #34, #35, #37, #39, #41, and #43 in milestone 5.
Local implementation and runtime acceptance were audited on 2026-10-18 using
both the release application and disposable real-Git fixtures. The evidence is
mapped to the issue acceptance criteria below. PR-head macOS and Windows CI must
also pass before merging; issues and milestone remain open until merge.

## Available evidence

Final local checks on 2026-10-18: locked dependency installation (no changes),
3 Bun tests, production TypeScript/Vite build, version consistency, 52 Rust tests,
rustfmt, Clippy with all targets/features and warnings denied, and macOS release
application bundling passed. The final release app was launched with normal Git
configuration after the isolated transport check; added/modified discard
availability and the recovery layout were verified there.

Earlier verification on 2026-10-13:

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
  against disposable fixtures; the results below record the accumulated runtime acceptance.

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
  independently against the file and index. After action-time approval on 2026-10-18, confirmed the tracked-file discard:
  index and worktree both matched HEAD, and the staged binary addition, deleted
  `main.txt` and untracked file were unchanged. The UI removed both story entries
  and displayed its success notice after refreshing.
- Visual inspection found unreadable controls under dark appearance and a clipped
  inspection panel at the default 800×600 window. Explicit themed foregrounds and
  surfaces fix the contrast; allowing the page to scroll exposes the complete
  diff and history/blame controls while retaining bounded repository panels.
- Rebuilt the release app and verified the fixes visually at its default size.
  Captured [unstaged diff](screenshots/delivery-1/unstaged-diff-dark.png) and
  [committed blame](screenshots/delivery-1/blame-dark.png) screenshots. Light
  appearance was also visually checked on 2026-10-18; controls remained readable.
  [Bounded blame in light appearance](screenshots/delivery-1/blame-truncation-light.png)
  shows the 512 KiB notice and committed-content context.
- Frontend tests (3), production frontend build, version consistency and release
  application bundling passed after these layout changes. The locally installed stable
  Rust toolchain was selected directly because the rustup proxy attempted a
  write outside the workspace while completing an earlier toolchain setup.

### Additional desktop checks on 2026-10-17/18

- Gated a real local fetch in the clone using its configured upload-pack command.
  While its tab showed Working and Close was disabled, switched to the independent
  empty repository, staged `independent.txt`, and opened its staged addition diff.
  Independent Git inspection confirmed the staged path before releasing the gate.
- Created a file in the clone during the gated fetch. On release, its originating
  tab retained the success notice and refreshed to include that new file. The
  other tab retained its selection and diff.
- A deliberately failing configured transport created another fixture file before
  exiting. The source tab showed the transport stderr and an Error marker, and
  its refreshed status included the new path. Switching to the other tab retained
  that tab's prior success notice and diff without transferring the error.
- Gated an inspection read using a disposable repository's fsmonitor hook, changed
  the selected path while Loading was visible, then released the read. The old
  diff did not repopulate the new selection. With a fresh gate, closed the source
  tab while Loading, verified its repository remained on disk, then released the
  read: the remaining tab did not change. Removed the temporary hook configuration
  after the checks.
- Verified identical-revision empty comparison, unavailable-ref error, merge
  first-parent comparison and reverse rename direction in the desktop app.
- Verified an empty exact-path history and the missing-file blame error, with no
  stale prior content remaining visible.

### Recovery, bounds and clone validation on 2026-10-18

- Verified a deleted-file diff and explicit 512 KiB truncation of a large staged
  diff and committed blame preview. File history for a renamed-away path remained
  exact-path history; blame at a revision without that path showed an error.
- In a separate disposable repository, detected a real merge conflict and aborted
  it through the app. Created a stopped rebase externally, refreshed, then aborted
  it through the app. Both restored the committed main contents and removed the
  corresponding operation metadata, checked independently on disk.
- Created and applied a stash through the app; verified that apply restored the
  expected working contents and retained the saved stash.
- The recovery banner previously mentioned only an editor/refresh. It now explains
  that continuing or skipping a stopped rebase requires an external Git tool and
  keeps the matching abort control available. Both merge and rebase have explicit
  external-completion guidance. Retained repository views use unique IDs for
  conflict and discard headings so hidden tabs cannot supply another view's label.
- Fixed clone validation that incorrectly rejected `ssh://user@host/...` login
  names. Embedded passwords and HTTP userinfo remain rejected. A regression test
  performs an actual system-Git clone using isolated local Git configuration and
  a fake SSH transport serving a disposable repository, with no network/account.
- In the rebuilt desktop app, an SSH login URL to localhost port 1 reached system
  Git, displayed the expected connection-refused diagnostic and retained the
  failed destination. A relative initialization destination was rejected before
  directory creation.
- A small-window check exposed changes/history overlap: the changes workspace is
  now stretched within its grid row with a zero minimum height, so its overflow
  scrolls inside its assigned area.

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
  remain green. Desktop staging, stash create/apply and merge/rebase abort checks are recorded above; remaining regression coverage uses the existing real-Git tests.

## Requirement-by-requirement acceptance audit

Use disposable repositories and local bare remotes, never a repository containing
valuable uncommitted files, for destructive checks.

Criteria refer to the acceptance lists in the linked issues. Evidence combines
real-Git backend tests with desktop integration checks; it does not claim that
every automated edge case was repeated through the UI.

| Issue / criteria | Evidence establishing the requirement | Local result |
|---|---|---|
| [#32](https://github.com/wctiger/branchlight/issues/32), 1–5: context ownership, independent clone/checkout, serialization, refresh and retained workflows | Gated desktop fetch and configured SSH clone while staging/inspecting independent repositories; originating result/error and refreshed files retained. Gated read invalidation and close/reopen. Scheduler tests use real linked-worktree identities, hold a cancelled caller's operation, verify independent progress and eight-worker queue draining. All mutation adapters use the scoped scheduler. Desktop staging, branch creation/rename/checkout, stash create/apply and both aborts passed; existing backend lifecycle tests cover the remaining branch/stash transitions. | Pass |
| [#34](https://github.com/wctiger/branchlight/issues/34), 1–5: tabs/groups, feedback and close semantics | Multiple tabs; group create/assign/rename/remove; operation/error markers remain in source tab. Busy close is disabled; read-only close discards its result without deleting the repository. Reopening preserves files, and opening a filesystem alias reuses its existing tab. Repository validation and independent whole-file staging passed. | Pass |
| [#35](https://github.com/wctiger/branchlight/issues/35), 1–5: init/clone, failure preservation, independent work and boundaries | Desktop empty init, local clone and successful SSH-URL clone using isolated configured transport. During the gated clone, another repository staged and inspected a file. Relative destination rejected before creation, existing directory untouched, failed SSH destination retained with actionable transport stderr. Source-validation tests accept SSH usernames and reject embedded passwords/options. Uses installed Git; no provider login, credential store, Git bundle, advanced or batch clone UI. | Pass |
| [#37](https://github.com/wctiger/branchlight/issues/37), 1–5: text diffs, context, edge states, bounds and exclusions | Desktop staged/unstaged contents, root empty-tree and merge first-parent contexts, rename and deletion, Unicode/pathspec-like names, binary/untracked/empty fallback, 512 KiB diff truncation and gated stale-result checks. Backend tests additionally cover option-like/literal paths and the 8 MiB capture error. Whole-file staging retained; views are read-only without editing/image/hunk controls. | Pass |
| [#39](https://github.com/wctiger/branchlight/issues/39), 1–5: bounded file history, blame, navigation and scoped error/loading states | Exact-path history uses Git's 100-entry bound; desktop author/date/summary, committed line attribution and navigation to changes verified. Empty history, missing file/ref, renamed-away path and 512 KiB blame truncation verified. Shared inspection request generations were exercised with a gated read and input/tab changes; previous content clears on a new request. No rename tracing or uncommitted attribution is implied. | Pass |
| [#41](https://github.com/wctiger/branchlight/issues/41), 1–5: resolved directed pair, changed paths, edge cases, stale protection and exclusions | Desktop resolved IDs/direction, per-file text diffs, forward/reverse rename, identical pair, unavailable ref, root and merge contexts. Backend reverse/deletion tests and shared request-generation guard cover the pair's operations. Editing inputs clears old results; no restore/patch/remote-administration/granular staging controls. | Pass |
| [#43](https://github.com/wctiger/branchlight/issues/43), 1–5: exact whole-file discard, confirmation, explicit support, refresh and exclusions | Desktop cancel preserved index/worktree; approved tracked discard reset both to HEAD and left unselected staged, deleted and untracked paths unchanged. The untracked confirmation names its selected path and explicitly warns of permanent deletion; cancel preserves it. Backend real-Git tests cover deleted-file restoration, individual untracked unlink, symlink/traversal safety and unsupported additions/directories. Mixed staged addition/unstaged modification is disabled on both UI rows and rejected by the backend without changing either version. Refresh after success and a state-changing failure verified through shared mutation completion. No ignore/hunk/commit-restore UI. | Pass |

### Final acceptance details

- Confirmed `story.txt` discard after explicit approval. Independently compared
  HEAD, index and working-file bytes; all matched. Staged `binary.dat`, deleted
  `main.txt` and the unrelated untracked file were unchanged.
- In a separately launched release app with only a temporary test Git config, a
  configured SSH command served the disposable local source. Held clone transport,
  staged and inspected `during-clone.txt` in the unrelated repository, then
  released clone and verified its new tab and checked-out files. This uses system
  Git's configuration path, not an app-managed account. The isolated app exited;
  the final normal app launch did not retain its environment.
- Created, renamed and switched local branches through the app. Opened a symlink
  alias of the already-open clone and verified the two existing repository tabs
  remained the only tabs.
- Verified an empty per-file preview after an external file restoration, an
  unavailable file-history revision, and explicit untracked-file loss wording.
  Cancelled the untracked confirmation; individual untracked removal is covered
  by the backend tests, not claimed as a destructive desktop check.
- The final small-window layout uses bounded grid rows with the changes workspace
  stretched inside its row; changes and history no longer overlap. Both light and
  dark inspection controls were visually inspected. The rebuilt recovery banner
  explicitly describes external rebase continuation/skip and retains abort.
- [Rebase recovery screenshot](screenshots/delivery-1/rebase-recovery-light.png)
  records that guidance in the release app at the default 800×600 size.

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

The prior implementation/layout commit `e0a078e` passed both complete jobs in
[CI run 39085887031](https://github.com/wctiger/branchlight/actions/runs/39085887031).
For submission, review [PR #67 checks](https://github.com/wctiger/branchlight/pull/67/checks)
at the current head, including the final SSH/recovery/discard fixes. Passing this
acceptance audit does not close issues or merge the PR by itself. Windows
downloaded-app runtime compatibility remains the separate issue #28.

## Design-system follow-up (#68), 2026-10-19

The frontend now applies the reviewed Orange tokens through shared shadcn/ui
components, dense layout, bundled Inter/Cascadia Code fonts, local appearance
preferences, single-line repository tab overflow, and fixed-row virtual history.
[Design-system integration and evidence](DESIGN_SYSTEM.md) documents the token
mapping, intentional native controls, and before/after captures. The Rust Git
implementation, scheduler, refresh generations, and production history bound are
unchanged.

Verification for this change:

- 11 Bun tests pass, covering graph layout, token contrast/mapping, twelve-tab
  navigation, busy close protection, bounded history rendering, commit 300
  navigation, retained selection/scroll on refresh, confirmation cancellation,
  focus restoration, and saved appearance resolution.
- Production TypeScript/Vite build, version consistency, 52 Rust tests, rustfmt,
  and Clippy with all targets/features and warnings denied pass. Native checks
  use the installed stable toolchain and macOS 15.4 SDK; no SDK setting is added
  to the project. macOS application bundling passes, including local font assets
  and license notices.
- The actual UI served with an isolated development-only backend fixture opens
  12 repository tabs and displays a 300-commit/30-contributor workload in both
  themes. Keyboard End reaches the last commit; refresh and switching away/back
  retain the selected hash and scroll position. A local 85-frame scrolling sample
  recorded 24.3ms p95 and 31 mounted rows. This is browser fixture evidence, not
  a claim that Git now loads more than its existing 200-entry bound.
- A diagnostic native build was relaunched after an initially blank window.
  With real installed Git and a disposable repository, opening, whole-file
  staging, staged diff inspection, and explicit light/dark appearance worked.
  The complete diff remained reachable through page scrolling, with red/green
  lines and readable Cascadia Code text. The discard dialog named the path,
  focused Cancel, and Escape dismissed it. Independent Git checks confirmed
  that index and working file still contained the staged changes after cancel.
  No discard was executed.
- The final normal release (without diagnostic features) was rebuilt and
  relaunched successfully. It restored the saved Dark preference, loaded system
  Git and the disposable repository, and unstaged the file through the UI. Git
  independently confirmed that the index returned to HEAD while the working
  file retained its edit. The earlier blank launch did not recur on this clean
  normal-release relaunch.

Windows native runtime/visual acceptance, and a complete repeat of the earlier
Delivery 1 desktop matrix after migration, remain pending. Platform CI results
establish test/build compatibility only. Keep #68 open until its remaining
acceptance evidence is collected; this addendum does not overwrite or expand the
scope of the prior Delivery 1 runtime audit.


### Base UI follow-up for issue #68 / PR #69

The shadcn component layer now uses Base UI (`base-nova`), replacing Radix.
The CLI recognizes Base UI, the locked install and production frontend build
pass, and all 14 Bun tests pass. Browser checks cover repository menus, group
creation/assignment, tooltip path display, Cancel-first dialogs, Escape focus
return, both themes, and retained dense control/history geometry. Stash drop
keeps its original trigger mounted so cancellation can restore focus.

The native smoke results recorded above predate this primitive migration.
They must not be read as native runtime acceptance of Base UI. Native macOS and
Windows verification remains pending; CI build/test status is separate.
