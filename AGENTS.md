# Repository Guidelines

## Project Structure & Module Organization

Branchlight is a local-first Git desktop client targeting macOS and Windows, built with React 19, TypeScript, Vite, and Tauri 2/Rust. Delivery 1 introduces independent repository views, tabs/groups, and background scheduling scoped by the canonical common Git directory. Worktree lifecycle remains planned. Build success alone does not establish runtime verification.

- `src/features/` contains branch, stash, and history UI; `src/types/` defines frontend models.
- `src/lib/tauri.ts` provides the typed frontend/backend boundary.
- `src-tauri/src/commands/` contains thin Tauri adapters; `git/` owns Git execution and domain operations; `models/` defines serialized responses and errors.
- `tests/` contains Bun tests; Rust tests live alongside implementation modules.
- `src-tauri/icons/` holds application icons. `docs/` contains design-system, distribution, and feature-planning guides.
- `README.md` describes product direction and current implementation. `docs/FEATURE_SELECTION.md` defines selected scope, priorities, exclusions, and delivery order; GitHub milestones track that sequence.
- Keep curated feature decisions in the repository; verification reports, screenshots, and generated REA evidence are transient. Keep application tokens under `src/`; application code must not import from `docs/`.

## Build, Test, and Development Commands

Install system Git, Bun, Rust, and Tauri 2 prerequisites for the target platform. macOS uses Xcode Command Line Tools; Windows uses the MSVC Rust toolchain, Microsoft C++ build tools, and WebView2.

- `bun install --frozen-lockfile`: install locked frontend dependencies.
- `bun run tauri dev`: launch the desktop application with development reloads.
- `bun run dev`: run the Vite frontend server.
- `bun run build`: type-check TypeScript and build frontend assets.
- `bun test`: run frontend tests.
- `bun run tauri build --bundles app`: build the macOS application.
- `bun run tauri build --ci --target x86_64-pc-windows-msvc --no-bundle -- --locked`: build the Windows x64 executable on Windows with that Rust target installed.
- `bun run scripts/check-version.ts`: check version consistency.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: run Rust tests.
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml`: verify Rust formatting.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: enforce Rust lint checks.

## Coding Style & Naming Conventions

Match existing TypeScript style: two-space indentation, double quotes, semicolons, PascalCase components/types, and camelCase functions. Keep strict TypeScript checks passing. Use snake_case Rust modules/functions and standard rustfmt formatting. No standalone frontend formatter or linter is configured.

## Testing Guidelines

Use `bun:test` with descriptive behavior names in `tests/*.test.ts`. Add Rust `#[test]` cases in module-local test blocks; exercise Git operations using disposable repositories and local remotes. Cover error paths and repository-state transitions. No numeric coverage threshold is configured. Run the checks above before submitting and record validation in the PR.

## Commit & Pull Request Guidelines

Follow history's prefixes: `feat:`, `fix:`, `docs:`, `ci:`, and `chore:` with concise imperative subjects. Describe behavior changes, link relevant issues, record validation, and attach screenshots to the PR for UI changes instead of committing them. Ensure macOS and Windows CI pass. Build/artifact success does not establish downloaded-app runtime compatibility; consult `docs/DISTRIBUTION.md` and `docs/WINDOWS_DISTRIBUTION.md` for platform verification.

## Architecture & Safety

Construct Git commands only in Rust and use the user's installed Git; do not bundle Git or add provider-account/credential storage. Keep identity, SSH configuration, hooks, and credential helpers in local Git configuration.

Serialize conflicting mutations and refresh repository state after success or failure; avoid optimistic updates and stale cross-repository responses. Planned repository workers must allow unrelated repositories to progress independently with bounded resource use, while coordinating common Git metadata shared by linked worktrees. Preserve reliable merge/rebase abort and show external recovery guidance until continuation controls are implemented.
