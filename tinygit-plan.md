# TinyGit Toy Project Plan

## 1. Goal

Build a minimal macOS Git GUI as a toy project to learn **Tauri** and **Rust** while producing a tool that is useful for daily Git operations on small personal repositories.

This is intentionally **not** the architecture or feature scope for the eventual larger Git GUI product. The longer-term idea is closer to GitKraken without AI/cloud features, optimized for a better multi-repository development experience and lower resource usage. This toy project should stay small and focused.

---

## 2. Target V1

### Platform

- macOS only

### Stack

- Tauri 2
- Rust
- React
- TypeScript
- Vite

### Git integration

- Use the user's installed `git` executable
- Run Git commands from Rust
- Do not embed libgit2 or another Git implementation in V1
- Reuse the user's existing Git, SSH, and credential-helper configuration
- Do not build PAT, OAuth, GitHub, or GitLab authentication UI

### Repository scope

- One repository open at a time
- Small personal repositories only
- No performance work for enterprise monorepos in this project

### Screens

Only two application states are needed:

1. Minimal landing screen
2. Main repository screen

No settings screen, repo manager, account screen, or other navigation.

---

## 3. UI

## 3.1 Landing screen

Minimal folder-opening experience:

```text
┌──────────────────────────────────────┐
│                                      │
│               TinyGit                │
│                                      │
│          [ Open Repository ]         │
│                                      │
└──────────────────────────────────────┘
```

The user selects a folder through the native macOS folder picker.

Rust validates the selected folder as a Git repository.

Potential small follow-up:

- Remember and display the most recently opened repository

Do not add repository initialization or repository management UI in V1.

---

## 3.2 Main screen

Single-screen layout:

```text
┌──────────────────────────────────────────────────────────────────┐
│ my-project   main ▼   Fetch   Pull   Push   Stash   Refresh     │
├──────────────────┬──────────────────────┬────────────────────────┤
│ BRANCHES         │ CHANGES              │ HISTORY                │
│              +   │                      │                        │
│ Local            │ Unstaged (2)         │ ● Fix bug             │
│ ● main           │ + M foo.ts           │ │                      │
│   feature-a      │ + ? new.ts           │ ● Merge feature       │
│   feature-b      │                      │ │\                     │
│                  │ Staged (1)           │ │ ● feature work      │
│ Remote           │ - M Cargo.toml       │ │/                     │
│   origin/main    │                      │ ● previous            │
│                  │ Commit message...    │                        │
│                  │          [ Commit ]  │                        │
└──────────────────┴──────────────────────┴────────────────────────┘
```

The layout can initially be roughly:

- 20% branches
- 30% changes
- 50% history

Exact sizing is not important for V1.

---

## 4. Interaction model

### Top bar

Initial actions:

- Current branch
- Fetch
- Pull
- Push
- Stash
- Refresh

Do not place every branch-specific action in the top bar.

### Branch tree

Local branches:

- Select
- Switch
- Create
- Rename
- Delete
- Drag onto the currently checked-out branch

Remote branches:

- Display only initially

Suggested interactions:

```text
click          → select
double-click   → switch

right-click
  Rename
  Delete
```

Use a `+` button near the branch section for branch creation.

### Changes

Only whole-file staging is required.

No diff viewer.

Suggested interaction:

```text
+ M src/foo.ts
```

Click `+` to stage.

```text
- M src/foo.ts
```

Click `-` to unstage.

No checkbox/multi-select workflow is required initially.

### History

Read-only.

Show:

- Commit graph
- Commit subject
- Author
- Timestamp
- Branch/ref labels where useful

No operations directly from the graph in V1.

---

## 5. Merge and rebase interaction

Use GitKraken-style drag and drop in the **branch tree**, not the history graph.

The currently checked-out branch is the only valid drop target.

Example:

```text
● main            ← current branch / drop target

  feature/foo     ← draggable
```

Dragging `feature/foo` onto `main` opens:

```text
feature/foo → main

Merge feature/foo into main

Rebase main onto feature/foo

Cancel
```

Semantics:

- Dragged branch = source
- Current branch = destination

Commands:

```bash
git merge feature/foo
```

or:

```bash
git rebase feature/foo
```

Do not support arbitrary branch-to-branch drag/drop when neither branch is currently checked out.

Explicit wording is important because rebase direction is easy to misread.

---

## 6. Conflict handling

Do not build a merge-conflict editor.

Detect repository conflict state and show an alert/banner.

Example:

```text
⚠ Merge conflicts

3 files need resolution.

Resolve them in your editor and return here.

[Refresh]                       [Abort Merge]
```

For rebase:

```text
[Abort Rebase]
```

Support:

```bash
git merge --abort
git rebase --abort
```

Model operation state explicitly in Rust:

```rust
enum RepositoryOperation {
    None,
    Merge,
    Rebase,
}
```

---

## 7. Architecture

Keep the frontend unaware of literal Git command construction.

Preferred layering:

```text
React
   │
   │ typed Tauri commands
   ▼
commands/
   │
   ▼
git domain modules
   │
   ▼
runner.rs
   │
   ▼
system git
```

React should call domain operations such as:

```text
getRepositoryStatus()
getBranches()
stageFiles()
unstageFiles()
commit()
mergeBranch()
rebaseOnto()
```

Do not expose a frontend API like:

```text
executeGit(["merge", "foo"])
```

Git semantics belong in Rust.

Git remains the source of truth. After a mutating operation, refresh repository state instead of trying to maintain optimistic Git state in React.

---

## 8. Suggested project structure

```text
src/
├── App.tsx
├── components/
├── features/
│   ├── branches/
│   ├── changes/
│   └── history/
├── lib/
│   └── tauri.ts
└── types/

src-tauri/src/
├── git/
│   ├── mod.rs
│   ├── runner.rs
│   ├── status.rs
│   ├── branches.rs
│   ├── history.rs
│   ├── remote.rs
│   └── stash.rs
├── commands/
│   ├── repository.rs
│   ├── branches.rs
│   └── operations.rs
├── models/
│   ├── status.rs
│   ├── branch.rs
│   ├── commit.rs
│   └── error.rs
└── lib.rs
```

This is enough structure to practice Rust module design without over-engineering the toy.

---

## 9. Core Rust runner

Centralize process execution.

Conceptually:

```rust
fn run_git(
    repo: &Path,
    args: &[&str],
) -> Result<GitOutput, GitError>
```

Example output model:

```rust
struct GitOutput {
    stdout: String,
    stderr: String,
    exit_code: i32,
}
```

This runner should stay internal to the Rust Git layer.

---

## 10. Git operations

### Repository validation

```bash
git -C <path> rev-parse --show-toplevel
```

### Status

Prefer machine-readable output:

```bash
git status --porcelain=v2 --branch --show-stash -z
```

Parse status into Rust models.

Example:

```rust
struct RepoStatus {
    branch: BranchStatus,
    staged: Vec<FileChange>,
    unstaged: Vec<FileChange>,
    conflicts: Vec<FileChange>,
    stash_count: u32,
}
```

```rust
struct FileChange {
    path: PathBuf,
    kind: ChangeType,
}
```

```rust
enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}
```

```rust
struct BranchStatus {
    name: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
}
```

Handle detached HEAD explicitly.

### Stage

```bash
git add -- <path>
```

### Unstage

```bash
git restore --staged -- <path>
```

### Commit

```bash
git commit -m <message>
```

### Branches

Use machine-oriented ref output rather than parsing pretty `git branch` text.

Possible backend model:

```rust
struct Branches {
    local: Vec<Branch>,
    remote: Vec<Branch>,
}
```

```rust
struct Branch {
    name: String,
    full_name: String,
    commit: String,
    is_current: bool,
    upstream: Option<String>,
}
```

### Switch

```bash
git switch <branch>
```

### Create

```bash
git switch -c <branch>
```

### Rename

```bash
git branch -m <old> <new>
```

### Delete

```bash
git branch -d <branch>
```

Do not expose force-delete initially.

### Fetch

```bash
git fetch
```

### Pull

```bash
git pull
```

Respect the user's Git configuration for merge-vs-rebase pull behavior.

### Push

```bash
git push
```

Potential convenience later:

```bash
git push -u origin <branch>
```

when no upstream exists.

### Merge

```bash
git merge <source-branch>
```

### Rebase

```bash
git rebase <source-branch>
```

### Stash

```bash
git stash push
git stash push -m <message>
git stash list
git stash apply stash@{n}
git stash pop stash@{n}
git stash drop stash@{n}
```

No stash diff viewer.

---

## 11. History

Retrieve a bounded history first, for example the latest 200 commits:

```bash
git log --all --topo-order -n 200 --format=...
```

Rust returns topology and metadata:

```rust
struct Commit {
    hash: String,
    parents: Vec<String>,
    refs: Vec<String>,
    subject: String,
    author: String,
    timestamp: i64,
}
```

Start by displaying a flat history list.

Only add graph layout after retrieval, parsing, scrolling, and selection work correctly.

---

## 12. Basic DAG renderer

Graph rendering is a frontend responsibility.

Rust supplies:

```text
commit
parents[]
refs[]
```

React computes:

```text
row
lane
edges
```

Use SVG for V1.

Required primitives:

```text
● commit node
│ vertical edge
╲ diagonal connection
```

Support:

- Normal commits
- Branch divergence
- Two-parent merges
- Ref/branch labels

Do not optimize for:

- Perfect lane reuse
- Huge histories
- Octopus merges
- Collapsed history
- Graph virtualization
- GitKraken-quality layout
- Graph interactions

The graph is read-only in this project.

---

## 13. Milestones

Implement in this order.

### Milestone 1 — Application skeleton

1. Create Tauri/React/TypeScript/Vite project
2. Add Rust Git runner
3. Expose a test Tauri command
4. Run `git --version`
5. Display the result in React

**Done when:** React → Tauri → Rust → system Git works end-to-end.

### Milestone 2 — Open repository

6. Native folder picker
7. Validate selected repository
8. Switch from landing screen to main screen

**Done when:** a valid repository can be opened and its path/name shown.

### Milestone 3 — Repository status

9. Implement porcelain-v2 status parser
10. Model branch state
11. Model staged/unstaged/conflicted files
12. Render changes on the main screen

**Done when:** external file changes are accurately reflected after Refresh.

### Milestone 4 — Basic daily commit workflow

13. Stage entire file
14. Unstage entire file
15. Commit with message
16. Refresh state after each mutation

**Done when:** the GUI can perform a complete edit → stage → commit workflow.

### Milestone 5 — Branch management

17. List local branches
18. List remote branches
19. Switch local branch
20. Create branch
21. Rename branch
22. Delete branch

**Done when:** basic local branch management no longer requires the terminal.

### Milestone 6 — Remote operations

23. Fetch
24. Pull
25. Push
26. Surface useful Git errors
27. Optionally add Push & Set Upstream

**Done when:** normal authenticated fetch/pull/push works using the user's existing Git setup.

### Milestone 7 — Stash

28. Create stash
29. List stashes
30. Apply stash
31. Pop stash
32. Drop stash

**Done when:** common stash workflows work without a terminal.

### Milestone 8 — Drag/drop merge and rebase

33. Make local non-current branches draggable
34. Make current branch a drop target
35. Show explicit merge/rebase menu on drop
36. Execute merge
37. Execute rebase
38. Refresh repository state

**Done when:** GitKraken-style branch drag/drop works for the current branch.

### Milestone 9 — Conflict state

39. Detect merge/rebase state
40. Detect conflicted files
41. Display conflict banner
42. Abort merge
43. Abort rebase

**Done when:** conflicts are clearly surfaced and operations can be aborted safely.

### Milestone 10 — History

44. Retrieve bounded commit history
45. Parse parents and refs
46. Display flat commit list
47. Add scrolling/selection as needed

**Done when:** recent repository history is useful without a graph.

### Milestone 11 — Commit graph

48. Implement lane assignment
49. Compute parent edges
50. Render graph with SVG
51. Handle normal divergence
52. Handle normal two-parent merges
53. Display branch/ref labels

**Done when:** common personal-repo histories produce a readable DAG.

### Milestone 12 — Cleanup

54. Improve Git error presentation
55. Improve loading/disabled states
56. Remember last repository if useful
57. Remove debugging UI
58. Review module boundaries
59. Use the app for normal Git work on a personal repository

---

## 14. Explicit non-goals

Do not add these unless the toy project is otherwise complete:

- Diff viewer
- Hunk staging
- Line staging
- Interactive rebase
- Conflict editor
- Cherry-pick
- Reset
- Revert
- Amend
- Tags
- GitHub API integration
- GitLab API integration
- PAT UI
- OAuth UI
- Built-in credential storage
- Multiple repositories
- Repository tabs
- Worktrees
- Submodules
- Git LFS-specific UI
- Sparse checkout
- Repository search
- Command palette
- Settings screen
- Themes
- Configurable keymaps
- Auto-update
- Windows support
- Linux support
- Arbitrary branch-to-branch merge/rebase
- Drag/drop inside the history graph
- Interactive commit graph operations
- Large-monorepo optimization
- Enterprise-repository performance engineering

Those belong to a future product, not this learning project.

---

## 15. Definition of done

The toy project is complete when it can:

1. Open one local Git repository
2. Show current branch and repository status
3. Show staged and unstaged files
4. Stage/unstage entire files
5. Commit changes
6. List/manage local branches
7. Display remote branches
8. Fetch
9. Pull
10. Push
11. Create/list/apply/pop/drop stashes
12. Merge using branch drag/drop
13. Rebase using branch drag/drop
14. Detect and report merge/rebase conflicts
15. Abort merge/rebase operations
16. Display recent commit history
17. Render a basic read-only commit DAG

The project does **not** need to approximate GitKraken feature-for-feature.

Its purpose is to produce a small, usable Git GUI while gaining practical experience with:

- Rust
- Tauri
- Rust process execution
- Rust error modeling
- Parsing Git's machine-readable output
- Serde
- React ↔ Rust IPC
- Native desktop dialogs
- Drag/drop interaction
- Simple DAG visualization
