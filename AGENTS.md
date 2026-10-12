# Repository Guidelines

## Project Structure & Module Organization

Branchlight is a local-first macOS Git client built with React 19, TypeScript, Vite, and Tauri 2/Rust.

- `src/features/` contains branch, stash, and history UI; `src/types/` defines frontend models.
- `src/lib/tauri.ts` provides the typed frontend/backend boundary.
- `src-tauri/src/commands/` contains thin Tauri adapters; `git/` owns Git execution and domain operations; `models/` defines serialized responses and errors.
- `tests/` contains Bun tests; Rust tests live alongside implementation modules.
- `src-tauri/icons/` holds application icons. `docs/` contains verification, distribution, and feature-planning guides; consult `PLAN.md` for scope.

## Build, Test, and Development Commands

Install macOS, system Git, Bun, Rust, and Tauri 2 prerequisites before development.

- `bun install --frozen-lockfile`: install locked frontend dependencies.
- `bun run tauri dev`: launch the desktop application with development reloads.
- `bun run dev`: run the Vite frontend server.
- `bun run build`: type-check TypeScript and build frontend assets.
- `bun test`: run frontend tests.
- `bun run tauri build --bundles app`: build the macOS application.
- `bun run scripts/check-version.ts`: check version consistency.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: run Rust tests.
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml`: verify Rust formatting.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: enforce Rust lint checks.

## Coding Style & Naming Conventions

Match existing TypeScript style: two-space indentation, double quotes, semicolons, PascalCase components/types, and camelCase functions. Keep strict TypeScript checks passing. Use snake_case Rust modules/functions and standard rustfmt formatting. No standalone frontend formatter or linter is configured.

## Testing Guidelines

Use `bun:test` with descriptive behavior names in `tests/*.test.ts`. Add Rust `#[test]` cases in module-local test blocks; exercise Git operations using disposable repositories and local remotes. Cover error paths and repository-state transitions. No numeric coverage threshold is configured. Run the checks above before submitting; update `docs/V1_VERIFICATION.md` when capability evidence changes.

## Commit & Pull Request Guidelines

Follow history's prefixes: `feat:`, `fix:`, `docs:`, `ci:`, and `chore:` with concise imperative subjects. Describe behavior changes, link relevant issues, record validation, and include screenshots for UI changes. Ensure macOS CI passes.

## Architecture & Safety

Construct Git commands only in Rust. Serialize UI mutations and refresh repository state after success or failure; avoid optimistic updates. Keep credentials in system Git's SSH configuration and credential helpers.
