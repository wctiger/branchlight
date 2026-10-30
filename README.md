# Branchlight

Branchlight is a local-first Git desktop client for **macOS and Windows**, built
with React, TypeScript, and Tauri/Rust. The goal is a responsive everyday Git
workspace for managing multiple repositories and worktrees concurrently, using
the Git executable and configuration already installed on your machine.

The feature set draws from selected GitKraken workflows. The
[feature selection](docs/FEATURE_SELECTION.md) defines what Branchlight will
support, what is deferred, and what is intentionally excluded.

## Product direction

- **Independent repository workers.** Each repository should have its own
  background worker context and operation queue behind its tab. Cloning,
  fetching, or checking out in one repository should allow work in another to
  continue. Tabs organize repository views; switching tabs should not control
  whether background Git work can progress.
- **Repository and worktree management.** Open, initialize, and clone repositories;
  organize them with tabs/groups; create and maintain Git worktrees.
- **Inspectable Git workflows.** Review text diffs, file history, blame, and
  revision comparisons; stage whole files; compose commits; manage local
  branches, upstreams, stashes, and history operations.
- **Your local Git setup.** Use installed Git, local identity, SSH configuration,
  hooks, and credential helpers. There is no plan to bundle Git or introduce
  provider accounts or credential storage.
- **Clear operation state and recovery.** Show ongoing work, conflicts, useful
  errors, and diagnostics. Serialize conflicting mutations within a repository
  or worktree and coordinate metadata shared by linked worktrees, while allowing
  unrelated repositories to progress independently.

Worktrees and advanced workflows remain product goals. Delivery 1 adds scoped
repository scheduling and tabs. Build checks and desktop runtime acceptance
are separate requirements.

## Current implementation

The application implements the following workflows:

- Open and validate multiple local repositories in independent tabs and groups.
- Initialize or clone into a new directory using system Git; retain partial
  destinations on failure for explicit inspection.
- Inspect staged, unstaged, and commit text diffs; compare two revisions.
- Browse exact-path file history and committed line attribution.
- Confirm whole-file discard of tracked modifications/deletions or individual
  untracked files; additions, renames, conflicts, and directories are unavailable.
- Inspect branch, upstream, staged, unstaged, conflict, and stash state.
- Stage or unstage whole files; compose commit summaries and bodies with explicit
  per-commit hook bypass and optional push after commit. Push failure preserves
  the successful local commit and reports the failure separately.
- Create, switch, rename, safely delete, merge, and rebase local branches.
- Create a branch at a selected history commit, optionally check it out, and
  check out remote-tracking refs as named local branches. Choose local upstreams
  from existing remote-tracking branches.
- Fetch a configured remote with optional tracking-ref pruning; pull with merge,
  rebase, or fast-forward-only strategy; push to the selected upstream.
- Review an explicit force-with-lease push, retaining the expected remote commit
  even if a subsequent fetch advances the remote-tracking ref.
- Create, list, apply, pop, and drop stashes.
- Amend the latest commit (including staged changes), or reword a commit while
  preserving staged content. Older rewording uses rebase; histories spanning
  merge commits require external Git.
- Cherry-pick or revert a selected non-merge commit from a clean working tree;
  reset the checked-out local branch using soft, mixed, or hard mode. History
  confirmations recheck HEAD before executing.
- Inspect system Git version and a labeled PATH candidate and bounded session operation logs. Logs retain
  command names, exit codes, and timings, excluding arguments and output.
- Detect active merges/rebases/cherry-picks/reverts, list conflicts, refresh after external
  resolution, and safely abort the matching operation.
- Continue a stopped rebase after resolving and staging conflicts, or explicitly
  skip its current commit after confirming that its changes will be discarded.
- Review an interactive rebase plan for up to 200 commits on a linear local
  branch range: pick, drop, reorder, squash, or reword. Confirm the branch rewrite
  before applying; conflict stops retain continue, skip, and abort controls.
- Navigate a bounded 200-commit SVG graph with pointer and keyboard selection,
  parent navigation, and selected-commit inspection. Parents outside the loaded
  snapshot are labeled explicitly; selection survives safe refreshes.
- Search full commit messages across local refs using case-insensitive literal
  text (up to 200 matching commits), or inspect an unambiguous local commit hash.
  Search results open the existing commit inspection view.
- Launch an external editor, terminal, file manager, or Git-configured diff/merge
  tool in the current repository/file context. Editor and terminal preferences
  use an executable plus structured arguments; refresh after external changes.
  Git tool completion refreshes repository views even after a failure.
- Discover repository and workspace actions through **Commands** (Command+K on
  macOS, Ctrl+K on Windows by default). Configure local shortcuts, detect
  duplicate bindings, disable bindings, or restore defaults. Commands reuse
  the primary UI's guards and confirmations; shortcuts are ignored while typing
  or another dialog is open.
- Discover configured submodules, expected/current revisions and dirty state;
  open initialized children as independent repository tabs. Review add, URL/branch
  configuration, initialize/update-to-expected, reset and removal operations before
  applying. Reset preserves unrelated untracked/ignored and nested repository work;
  removal refuses dirty or untracked content and retains Git module metadata.
  Parent/child mutations share repository locks and refresh related open views.
  Existing `.gitmodules` edits must be committed or stashed before add/edit/remove.
- Detect system Git LFS, inspect tracked patterns and pointer/content/cache state,
  explicitly initialize local filters and pre-push hooks, and track/untrack patterns
  in root or nested attributes files. Fetch/pull/push use configured remotes and
  local credentials; cached checkout preserves modified files. Pruning requires
  an eligibility preview, confirmation, and remote-adapter verification, and is
  unavailable for custom/shared/symlinked storage. LFS is not bundled; install it
  separately using its official setup guide. History migration is excluded.
- List and inspect local tags, create unsigned lightweight or annotated tags at
  a selected commit, and confirm deletion of the exact reviewed local tag.
  Tag creation never overwrites an existing name; remote tag administration is
  excluded.

Text diffs use `@pierre/diffs` with unified/side-by-side layouts, syntax highlighting,
virtualized rows, and hunk navigation. Highlighting workers and language assets
are bundled locally. Truncated output and unsupported patch formats retain a
labeled plain-text fallback. Ordinary UTF-8 text conflicts expose base, current,
incoming, and editable output. Save a draft without resolving, or explicitly save
and stage the resolution. Binary, deleted-file, missing-stage, symlink, and
over-512-KiB conflicts require external tools.

Repository views retain state while switching tabs. Backend commands queue by
canonical common Git directory, coordinating linked worktrees while allowing
independent repositories to use up to eight background workers. Busy tabs cannot
be closed until their operation and refresh finish. Git output capture is capped
at 8 MiB per stream; text previews at 512 KiB.

Worktree lifecycle remains planned. Merge and rebase
target the checked-out branch; continuation of stopped merges/cherry-picks/reverts
and unsupported conflict resolution require external tools/Git. Repository history is limited to 200 commits; file history to
100 commits without rename tracing. Large-repository performance remains unverified.
Delivery 1 acceptance is recorded in [PR #67](https://github.com/wctiger/branchlight/pull/67).
Delivery 2 platform builds and desktop acceptance are tracked separately from
backend tests.

### Platform and distribution status

| Platform | Current status |
|---|---|
| macOS | CI checks and application builds; a universal DMG workflow supports test builds and signed/notarized draft releases when Apple credentials are configured. |
| Windows x64 | CI checks and unsigned executable builds pass; artifacts include a SHA-256 checksum. Downloaded-app launch, runtime dependencies, and credential behavior still need verification in [issue #28](https://github.com/wctiger/branchlight/issues/28). |

Build success is distinct from installation and runtime verification. See the
[macOS distribution guide](docs/DISTRIBUTION.md) and
[Windows executable guide](docs/WINDOWS_DISTRIBUTION.md) for obtaining artifacts,
prerequisites, and verification steps. Windows executables require an existing
WebView2 runtime and Git accessible through `PATH`.

## Delivery roadmap

The approved order is tracked in GitHub milestones. Later milestones include
lower-priority or optional features; the table is a delivery sequence, not a
release-date commitment.

| Order | Scope | Milestone |
|---|---|---|
| 1 | Repository concurrency, tabs/groups, init/clone, text diffs, history/blame, revision comparison, discard changes; retain whole-file staging. | [Repositories and change inspection](https://github.com/wctiger/branchlight/milestone/5) |
| 2 | Commit summary/body, hooks and push-after-commit controls, branch-at-commit/upstreams, fetch/prune, pull strategies, force-with-lease push. | [Commit and remote controls](https://github.com/wctiger/branchlight/milestone/6) |
| 3 | Amend/reword, cherry-pick/revert, reset, operation-state reporting, abort, and diagnostics/logs. | [History operations and diagnostics](https://github.com/wctiger/branchlight/milestone/3) |
| 4 | Selective stash actions and worktree creation, opening, locking, pruning, and removal. | [Stashes and worktrees](https://github.com/wctiger/branchlight/milestone/4) |
| 5 | Rebase continue/skip before interactive rebase, visual conflict resolution, tags, submodules, LFS, external tools, shortcuts, themes, graph interaction, and commit search. | [Recovery and extended Git workflows](https://github.com/wctiger/branchlight/milestone/1) |
| 6 | Optional read-only file viewer and undo/redo with defined recovery limits. | [Optional convenience features](https://github.com/wctiger/branchlight/milestone/2) |

### Scope boundaries

The selected scope excludes hosting-provider/PR/issue integrations, cloud
collaboration, AI assistance, agent orchestration, embedded terminals, account
profiles, Gitflow, advanced clone options, sparse checkout management, local
patch workflows, image/binary tooling, in-app file editing, ignore-management
UI, and file restoration from commits. Hunk/line staging and branch/tag visibility
controls have no committed delivery priority.

The [feature selection](docs/FEATURE_SELECTION.md) is the detailed scope reference.
Current product scope follows the feature selection.

## Development

Install system Git, Bun, Rust, and the Tauri 2 prerequisites for your platform.
Windows development uses the MSVC Rust toolchain, Microsoft C++ build tools, and
WebView2. macOS development uses Xcode Command Line Tools.

```sh
bun install --frozen-lockfile
bun run tauri dev
```

Project checks:

```sh
bun run scripts/check-version.ts
bun test
bun run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Build the macOS application with `bun run tauri build --bundles app`. For the
Windows x64 executable, use
`bun run tauri build --ci --target x86_64-pc-windows-msvc --no-bundle -- --locked`
on Windows with that Rust target installed. GitHub CI runs both platform checks
on pull requests and pushes to `main`, and supports manual runs.

## Architecture

- `src/features/` owns feature presentation; `src/types/` defines frontend models.
- `src/lib/tauri.ts` provides the typed React-to-Tauri boundary.
- `src-tauri/src/commands/` contains thin command adapters.
- `src-tauri/src/git/` owns Git execution, argument construction, validation,
  parsing, and domain operations.
- `src-tauri/src/models/` defines serialized responses and errors.

Git is the source of truth. The frontend keeps the last successful snapshot
while refreshing and does not apply optimistic repository mutations. Git commands
are constructed in Rust. Planned repository workers must preserve those
properties, keep results tied to their originating repository/worktree, and
coordinate shared Git metadata without imposing a global operation queue.

### Commit and remote controls

Select a commit in History, then expand **Branch start point and upstream** in
Branches to create a local branch there. The same controls let you create a
tracking branch from a remote ref or set an existing local branch's upstream.
Configure new remotes outside Branchlight.

**Fetch…** selects a configured remote and offers pruning of stale tracking refs.
Pruning does not delete local branches or branches on the remote; custom fetch
refspecs that prune outside that remote's tracking namespace are rejected.
**Pull…** chooses merge, rebase, or fast-forward only without changing Git config.
Conflicted pulls retain abort and external completion guidance.

**Force push…** displays the local source commit, upstream destination, and expected
remote commit. Confirming uses that exact lease; fetch cannot silently replace
its expectation. A rejected push never retries with unprotected force. Force
push requires a single matching fetch/push URL. Ordinary push also explicitly
targets the current branch's upstream, regardless of push.default or other
configured push refspecs.

**Skip pre-commit and commit-msg hooks** applies only to the submitted commit.
Prepare-commit-msg and post-commit still run, and push hooks are unaffected.
Failed commits retain the draft. If an optional push fails after committing,
resolve its error and use **Push**; the local commit already exists.
