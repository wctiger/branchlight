# Branchlight

Branchlight is a small, local-first Git desktop client for macOS. It uses the
installed `git` executable through a typed Rust/Tauri backend and keeps the UI
focused on one small personal repository at a time.

## V1 capabilities

- Open and validate a local Git repository.
- Inspect branch, upstream, staged, unstaged, conflict, and stash state.
- Stage or unstage whole files and create commits.
- Create, switch, rename, safely delete, merge, and rebase local branches.
- Display remote branches and fetch, pull, or push with the user's Git setup.
- Create, list, apply, pop, and drop stashes.
- Detect active merges/rebases, list conflicts, refresh after external
  resolution, and safely abort the matching operation.
- Browse a bounded 200-commit history with a read-only SVG DAG.

All Git mutations are serialized in the UI and followed by a complete refresh,
including failed commands that may have partially changed repository state.
Branchlight does not store credentials; system Git continues to use the user's
SSH configuration and credential helpers.

## Development

Prerequisites are macOS, system Git, Bun, Rust, and the Tauri 2 system
dependencies.

```bash
bun install
bun run tauri dev
```

Run the complete project checks with:

```bash
bun test
bun run build
bun run tauri build --bundles app
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

## Architecture

- `src/features/` owns branch, stash, and history presentation behavior.
- `src/lib/tauri.ts` is the typed React-to-Tauri API boundary; frontend code
  never constructs Git commands.
- `src-tauri/src/commands/` contains thin Tauri command adapters.
- `src-tauri/src/git/` owns system Git invocation, validation, parsing, and
  domain operations.
- `src-tauri/src/models/` contains serialized success and error models.

Git is always the source of truth. React keeps the last successful snapshot
during a refresh and never applies optimistic repository mutations.

## Known V1 limitations

Branchlight is intentionally macOS-only, single-repository, and designed for
small personal repositories. It does not include a diff or conflict editor,
hunk/line staging, interactive rebase, rebase continue/skip, cherry-pick,
reset, revert, amend, tags, worktrees, submodules, Git LFS-specific controls,
hosting-provider APIs, credential storage, repository tabs, search, settings,
themes, configurable keymaps, or large-monorepo optimization.

Merge and rebase target only the currently checked-out branch. Conflicts must
be resolved with an external editor and system Git before refreshing
Branchlight, unless the operation is aborted. History is capped at 200 commits;
the simple lane layout targets ordinary linear, divergent, and two-parent merge
histories rather than perfect graph compaction. The optional recent-repository
memory is not implemented in V1.

See [the V1 verification matrix](docs/V1_VERIFICATION.md) for capability-level
evidence and [PLAN.md](PLAN.md) for the complete scope and non-goals.
