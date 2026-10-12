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

These are product goals. Repository workers, tabs, and worktrees are planned;
current implementation status is below. Worker/thread scheduling must keep
resource use bounded and the UI responsive as repositories are added.

## Current implementation

The initial macOS implementation provides the basic Git workflow in a single
repository view:

- Open and validate a local Git repository.
- Inspect branch, upstream, staged, unstaged, conflict, and stash state.
- Stage or unstage whole files and create commits.
- Create, switch, rename, safely delete, merge, and rebase local branches.
- Display remote branches and fetch, pull, or push with the user's Git setup.
- Create, list, apply, pop, and drop stashes.
- Detect active merges/rebases, list conflicts, refresh after external
  resolution, and safely abort the matching operation.
- Browse a bounded 200-commit history with a read-only SVG DAG.

The app currently serializes mutations in its single repository UI and refreshes
state after success or failure. Multiple repository workers and scoped scheduling
will extend this foundation.

Text diffs, history/blame, repository tabs, worktrees, and advanced commit actions
are not implemented yet. Merge and rebase target the checked-out branch;
conflict resolution and rebase continuation currently require external tools/Git.
History is limited to 200 commits, and large-repository performance has not been
established. See [implementation verification](docs/V1_VERIFICATION.md) for the
existing capability evidence.

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
The [V1 verification matrix](docs/V1_VERIFICATION.md) records evidence for the
initial implementation; current product scope follows the feature selection.

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
