# GitKraken feature analysis for Branchlight

Analyzed **2026-10-09** from **`/Applications/GitKraken.app`**, version **12.6.0** (`com.axosoft.gitkraken`). This is an installed-artifact feature inventory prepared before implementing similar capabilities in Branchlight.

The analysis identifies **59 feature groups** spanning the Git client, visual review tools, repository organization, provider integrations, collaboration, AI, and worktree-based agent sessions. Branchlight already implements the basic local Git lifecycle. The most useful next increments are a diff viewer, granular staging, complete merge/rebase recovery, commit inspection, and search. Worktrees provide the foundation for a later agent-oriented workflow.

## Scope and evidence

This report uses REA's static JavaScript application analyzer and direct inspection of shipped resources and bundled syntax. GitKraken is an Electron application: its product behavior is largely packaged in `Contents/Resources/app.asar`. A native analysis provider was unnecessary for this inventory. Native addons and bundled Git internals were not decompiled.

**Observed** means an artifact contains a resource key, code reference, configuration declaration, or handler syntax. **Inferred** means a product workflow or implementation suggestion follows from those observations. **Unknown** means runtime availability, reachability, behavior, provider support, or enforcement was not established. Every inventory row describes an observed packaged surface; the existence of a code reference does not prove the action works or is enabled for a particular account.

Evidence files:

- [Feature evidence](evidence/gitkraken-12.6.0/feature-evidence.json): exact resource JSON pointers and zero-based UTF-8 code byte offsets for each `GK-xx` row; 663 saved code references. Descriptions are analyst paraphrases.
- [Artifact manifest](evidence/gitkraken-12.6.0/artifact-manifest.json): original ASAR identity, extracted-file hashes, extraction scope, and the integrity exception.
- [REA summary](evidence/gitkraken-12.6.0/rea-summary.json): portable summary Evidence, including limits and unknowns.
- [REA graph metadata](evidence/gitkraken-12.6.0/rea-graph-metadata.json): explicitly labeled analyst projection of graph counts and coverage.
- [Workflow anchors](evidence/gitkraken-12.6.0/workflow-anchors.json): selected handler syntax locations and interpretations, distinct from automated REA traces.
- [REA agent trace](evidence/gitkraken-12.6.0/rea-agent-trace.json): a bounded unsuccessful trace retained to document graph limitations.
- [Evidence verifier](evidence/gitkraken-12.6.0/verify_evidence.py): read-only verification against the original installed archive.

### Artifact identity and integrity exception

Original `app.asar`: **299,065,318 bytes**, **46,652 members**, SHA-256:

```text
4daf5e68790b4a8f0a32ea25eb6ecf0ba4f4470cd10f0f5392111dc044cd9702
```

The first REA analysis of the original ASAR stopped with `artifact_integrity_mismatch` on the **unpacked** member `git/bin/git`. The ASAR-declared SHA-256 was `8c9b665ffc15770280dd6e5eb3065fff1dd666cb3c797f81757a30b181204b23`; the installed member's calculated SHA-256 was `c06dcb569f6dfc8e94dee17f2cadc9205e5612746fe55c6fd91c47ad0a288562`. The reason for the difference is unknown. This finding does not establish tampering, and whole-application integrity was not verified.

To continue, packed application JS/JSON/HTML and `package.json` were extracted into a separate temporary directory. Each selected member's SHA-256 was checked against its ASAR integrity entry. The selection excludes **all unpacked members**, `node_modules`, Monaco assets, and license templates. It includes 58 files and 23,371,101 bytes, including main/renderer/request-handler/worker bundles, keybindings, localization resources, and entrypoint HTML. This selected directory is a derived analysis input, not a fresh copy or repaired version of the original application. See the manifest for every file and hash.

### REA results and their limits

REA analyzed the selected directory once:

- Parent Evidence: `ev_9fd797cc0f60018cff4fc5f9d9e301958a47451129c72396e463ca9a1b13a8a9`.
- Summary Evidence: `ev_a1240325d70bc571fa34d9f7a5eb921959b149af4555b1778107c44281503077`.
- Derived directory digest: `c64df8fea6ee428064735d31ebc376157440985b1ab9618ee42371660cd8163a`.
- 45 JavaScript files parsed, 5,136,378 AST nodes visited, 912 findings, and zero parse failures.
- Static Electron observations: four BrowserWindow constructions, three context-bridge APIs, 78 IPC operations, 19 literal channels, and 49 dynamic-channel operations. Eight renderer transmissions have inferred pairings. These are syntax counts, not a count of active windows or guaranteed runtime communication.
- Application graph coverage is **partial**. The semantic graph is **partial and truncated** at a 100,000-node ceiling, with **36,606 semantic unknowns**. The `statistics.modules` field reports zero; separately the application graph contains 312 `javascript-module` nodes and 45 `javascript-asset` nodes. These distinct counters must not be treated as complete original source-module recovery.
- The full response exceeded MCP's approximately 10 MiB transport budget. Analysis was retained, then inspected using `inspect_analysis_view` and exported locally. Transport overflow did not itself truncate analysis; the semantic node limit did.

The full export is approximately 301 MB and remains at `/private/tmp/gitkraken-rea-20261009/rea-evidence-bundle.json`; its hash is recorded in the manifest. That temporary path may disappear. The checked-in summary, selected evidence, and source hashes are the durable review artifacts; bundled source and the large export are not included in Git.

A focused `trace_application_feature` for the literal `AgentWorkflow-StartAgentSession` returned **no matching graph entity** against the partial graph (Evidence `ev_281312ba87136148812524df945d0a8d0398d7ec413b5dc3f12062cb2b31e96d`). Direct resource/code inspection does find that key. The trace result therefore cannot establish absence or an end-to-end agent call path. No native session was opened, and no app code was executed.

## Feature inventory and Branchlight gaps

The IDs below resolve to exact resource and code references in [feature-evidence.json](evidence/gitkraken-12.6.0/feature-evidence.json). The final column lists representative keys from `src/strings/en-us.json`; `menuStrings.*` denotes its menu resource section. Other keys belong to its `strings` section. Each group has at least one code-correlated key, but not every individual sub-capability has a fully traced handler.

Branchlight's status comes from its current [README](../README.md), [typed UI/backend API](../src/lib/tauri.ts), [registered Tauri commands](../src-tauri/src/lib.rs), [Git backend](../src-tauri/src/git/), and [existing V1 verification matrix](V1_VERIFICATION.md). Existing verification results were read as historical evidence; the application test suites were not rerun for this documentation change. “Absent” means no corresponding user-facing capability is exposed in the current command/UI inventory; it does not mean system Git is incapable of it.

### Repositories

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-01 — Open, initialize, and clone repositories | Open existing repositories; initialize repositories; clone remotes | Open exists; initialize and clone absent | `OpenRepo`, `InitRepo` |
| GK-02 — Advanced clone options | Depth/date-limited shallow clone; named branch; custom flags; blobless and sparse checkout | Absent | `ShallowCloneForm-Depth`, `ShallowCloneForm-SinceDate` |
| GK-03 — Repository management | Favorites and recent repositories; aliases; fetch/pull across repositories | Single repository only | `RepoManagement-addRepoToFavorites`, `RepoManagement-fetchAll` |
| GK-04 — Repository tabs and groups | New/reopened/renamed tabs; close other tabs; automatic grouping of worktrees | Absent | `NewTab`, `ReopenClosedTab` |

### Graph

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-05 — Interactive history graph | Commit graph with configurable columns and count; WIP rows; jump to a commit | Read-only SVG DAG, 200-commit cap | `Graph-AdjustCommitCount`, `Graph-WorkInProgress` |
| GK-06 — Graph visibility controls | Hide/show/solo branches and tags; smart visibility; pin a branch | Absent | `ContextMenu-SoloNLocalBranches`, `ContextMenu-HideAllTags` |
| GK-07 — Commit search and author filters | Search by message, SHA, author; filter by author or team | Absent | `FuzzyFinder-SearchCommitsPlaceholder`, `CommitFilter-Authors` |

### Diffs

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-08 — Text diff viewer | Inline, split, and hunk views; change navigation; whitespace and wrapping controls | Absent | `FileViewPanel-InlineView`, `FileViewPanel-SplitView` |
| GK-09 — File viewer and editing | View code/preview, edit working files, save changes, choose encoding | Absent | `FileViewPanel-FileViewCode`, `FileViewPanel-FileViewPreview` |
| GK-10 — Image and binary handling | Old/new image comparison and overlay; binary and unchanged-file indicators | Absent | `DiffImage-ShowDiffOverlay`, `DiffImage-OldImage` |
| GK-11 — File history and blame | Per-file history, blame details, graph navigation, deeper history lookup | Absent | `FileViewPanel-Blame`, `FileHistory-ShowBlame` |
| GK-12 — Revision comparisons and restore | Compare commit with working directory; restore selected files from commit | Absent | `ContextMenu-CompareAgainstWorkingCopy`, `ContextMenu-RestoreFileFromCommit` |

### Staging

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-13 — File, hunk, and line staging | Stage/unstage files, hunks, individual or selected lines and file-mode changes | Whole-file staging exists; granular staging absent | `StageThisFile`, `StageThisHunk` |
| GK-14 — Discard and ignore changes | Discard line/hunk/file changes; ignore paths, extensions, or folders | Absent | `DiscardThisHunk`, `DiscardThisLine` |

### Commits

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-15 — Commit composition | Commit summary/body, templates, push-after-commit and skip-hooks controls | Basic message and commit exist; extra controls absent | `CommitPreferences-CommitTemplate`, `CommitButtonLabelCheckboxPushAfterCommitting` |
| GK-16 — Amend and reword | Amend previous commit; edit existing commit or stash message | Absent | `AmendPreviousCommitButtonLabel`, `ContextMenu-AmendOrRewordCommitMessage` |
| GK-17 — Cherry-pick and revert | Cherry-pick one/multiple commits; revert commit; interactive cherry-pick | Absent | `ContextMenu-CherrypickCommit`, `ContextMenu-CherrypickCommits` |
| GK-18 — Reset modes | Move branch to commit with soft, mixed, or hard reset | Absent | `ContextMenu-ResetBranchToThisCommit`, `ContextMenu-ResetSoftWithHint` |
| GK-19 — Interactive rebase | Pick, drop, reorder, squash and reword commits before starting rebase | Ordinary rebase exists; interactive editor absent | `PendingInteractiveRebasePanel-InteractiveRebase`, `ContextMenu-PickCommit` |
| GK-20 — Continue, skip, and abort operations | Resume/skip rebase steps and abort rebase/merge | Abort exists; continue and skip absent | `ContinueRebaseButtonLabel`, `SkipCommitButtonLabel` |
| GK-21 — Undo and redo Git actions | Undo/redo actions with invalidated-history and missing-information states | Absent | `UndoValidButtonTooltip`, `RedoValidButtonTooltip` |

### Branches

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-22 — Branch and upstream management | Create/switch/rename/delete branches; branch at commit; set upstream | Basic local lifecycle exists; branch-at-commit and upstream editing absent | `ContextMenu-CreateBranchHere`, `ContextMenu-CheckoutBranch` |
| GK-23 — Merge and rebase actions | Merge/rebase source and target references; fast-forward; squash merge | Basic local merge/rebase exists; additional variants absent | `ContextMenu-MergeBranchIntoBranch`, `ContextMenu-RebaseBranchOntoBranch` |
| GK-24 — Tag lifecycle | Create lightweight/annotated tags; annotate existing tag; push/delete remotely | Absent | `ContextMenu-CreateTagHere`, `ContextMenu-CreateAnnotatedTag` |
| GK-25 — Gitflow workflow | Initialize/configure feature, release, hotfix branches and start/finish flows | Absent | `GitFlow-Init`, `GitFlow-Prefixes` |

### Remotes

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-26 — Remote management | Add/edit/remove remotes; select push destination; push all remotes | Configured remote operations exist; remote editor absent | `AddRemote-UnshallowWarning`, `ContextMenu-EditRemote` |
| GK-27 — Fetch/pull/push variants | Fetch all, configurable auto-fetch/prune, pull merge/rebase/fast-forward-only, force-with-lease | Basic fetch/pull/push exist; explicit variants absent | `PullOptions-FetchAll`, `PullOptions-FastForwardOnly` |

### Stashes

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-28 — Stash lifecycle and selective changes | Create/apply/pop/delete stash; stash selected files; restore file from stash | Basic lifecycle exists; selective file operations absent | `ContextMenu-StashApply`, `ContextMenu-StashPop` |

### Conflicts

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-29 — Visual merge resolution | Choose current/incoming lines or files; inspect ancestor; save output and mark resolved | Conflict reporting/abort exist; resolution editor absent | `Merge-TakeLine`, `Merge-TakeAll` |
| GK-30 — Proactive conflict detection | Target-branch conflict checks; overlapping files/lines; team conflict warnings | Absent | `ConflictDetection-Popover-Title`, `ConflictDetection-Popover-ShowOverlappedFiles` |

### Advanced Git

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-31 — Worktree lifecycle | Create/open worktree; lock/unlock/prune/remove; optional branch deletion | Absent | `Worktree-Create`, `Worktree-FormLock` |
| GK-32 — Submodules | Add/edit/open/init/update/reset/remove submodules; expected/current revision display | Absent | `Submodule-Create`, `Submodule-Edit` |
| GK-33 — Git LFS | Initialize LFS; manage tracking patterns; fetch/pull/push/checkout/prune objects | No dedicated UI; system Git may already use installed LFS hooks | `Lfs-InitializeLfs`, `Lfs-AddTrackingPattern` |
| GK-34 — Sparse checkout management | Enable/update/reapply/disable checkout path rules | Absent | `SparseCheckout-Enable`, `SparseCheckout-Update` |
| GK-35 — Local patch workflows | Import/apply patch; export working-file/commit/multi-commit patches | Absent | `Patch-OpenPatchFile`, `Patch-Apply` |
| GK-36 — Hooks and signing configuration | Configure hooks directory and signing keys; OpenPGP/SSH signing and verification settings | Uses system Git configuration; no dedicated UI | `GitHooks-Path`, `GPGPreferences-GpgFormat-Opengpg` |

### Integrations

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-37 — Hosting provider connections | GitHub/Enterprise, GitLab/self-managed, Bitbucket/Data Center, Azure DevOps configuration | System Git remote access only; provider API connections absent | `Services-GitHubEnterpriseServerUpgrade`, `Services-GitLabSelfHostedUpgrade` |
| GK-38 — Create and manage pull requests | Source/target branches, assignees, reviewers, labels, drafts and templates vary by provider | Absent | `PullRequestPanel-AddAssignee`, `PullRequestPanel-AddReviewer` |
| GK-39 — Stacked pull requests | Start/add to stack; display stack position and downstack blocking | Absent | `PullRequestPanel-StartPullRequestStack`, `PullRequestPanel-AddToPullRequestStack` |
| GK-40 — Pull request review and CI | Comments, pending reviews, approve/request changes, checks and mergeability | Absent | `PullRequestView-Approve`, `PullRequestView-FinishReview` |
| GK-41 — Issue tracker workflows | Issue search/filter/create, metadata and branch creation from issue; providers vary | Absent | `IssueTrackerCreateForm-CreateNewIssue`, `IssueTrackerCreateForm-AssigneesPlaceholder` |

### Collaboration

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-42 — Cloud Patches | Share working/staged/commit changes by link with visibility and collaborators | Absent | `CloudPatch-CreateFromAllFiles`, `CloudPatch-CreateFromStagedFiles` |
| GK-43 — Code Suggestions | Send uncommitted proposed changes for PR author to review/apply/reject | Absent | `CodeSuggest-InfoTooltip-1`, `CodeSuggest-ApplyTo` |
| GK-44 — Local and cloud workspaces | Group repositories; batch clone/fetch/pull and repository summaries | Absent | `LocalWorkspaces`, `CloudWorkspaces` |
| GK-45 — Launchpad | Cross-repository PR/issue/WIP dashboard with involvement filters, review status, pin/snooze | Absent | `FocusView-Title`, `FocusView-InvolvementFilterNeedsReviewByMe` |

### AI

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-46 — Generate commit and PR messages | AI commit/stash text; PR title and description; configurable instructions | Absent | `Ai-GeneratePullRequest`, `AiCommitMessageGeneration-NoStagedChanges` |
| GK-47 — Explain changes | Explain commits, ranges, stash, branch and working changes; some marked Preview | Absent | `Ai-ExplainCommit`, `Ai-ExplainCommits` |
| GK-48 — Resolve merge conflicts | AI conflict resolution with summary/confidence and review prompts | Absent | `Ai-ResolveConflict`, `Ai-ResolveConflictConfidence` |
| GK-49 — Compose and recompose commits | Preview workflow groups changes, orders commits and creates/recomposes commits | Absent | `Ai-GenerateRebaseFromWIP`, `Ai-GenerateRebaseFromCommits` |
| GK-50 — Provider and usage settings | Enable AI, own API key/custom endpoint, model/token settings and usage credits | Absent | `GKAIPreferences-UseCustomAiProvider`, `GKAIPreferences-CustomAiProviderEndpoint-Label` |

### Agents

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-51 — Start worktree agent sessions | Choose agent/base branch, create session, run setup commands and agent arguments | Absent | `AgentWorkflow-StartAgentSession`, `AgentWorkflow-BaseBranch` |
| GK-52 — Agent status dashboard | Worktree WIP rows and session badges; sort/filter sessions needing attention | Absent | `AgentsPreferences-ShowWorktreeWipNodes-Label`, `AgentWorkflow-AgentStatusThinking` |
| GK-53 — Agent plugins and permission response | Install/uninstall status plugins; allow/deny permission requests and inspect scopes | Absent | `ToolPreferences-ClaudeCodeHooks`, `ToolPreferences-CodexHooks` |

### Tools

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-54 — Embedded terminal | Multiple terminal tabs; start/close terminals; launch agent in terminal | Absent | `Terminal-NewTab`, `Terminal-CloseTab` |
| GK-55 — External tool integration | Open repository/files in editor, terminal, file manager, external diff/merge tools | No UI controls observed; opener plugin registered | `OpenRepoInExternalEditor`, `OpenTerminal` |
| GK-56 — Command palette and keybindings | Fuzzy command/action/file/repository search; keyboard action maps | Absent | `FuzzyFinder-DefaultPlaceHolder`, `FuzzyFinder-HistoryPlaceholder` |

### Preferences

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-57 — Profiles and identity | Local/synced preferences profiles; author identity; optional global gitconfig sync | System Git identity only; profile UI absent | `Profile-Local`, `Profile-Synced` |
| GK-58 — Appearance and editor preferences | Built-in theme switching, panels/columns, spellcheck, dates, editor encoding | Absent | `UIPreferences-Theme`, `UIPreferences-Spellcheck` |

### Product

| ID / feature | Observed packaged surface | Branchlight today | Representative resource keys |
|---|---|---|---|
| GK-59 — Onboarding, support, updates and account administration | Tutorials/help/logs, update checks, accounts/orgs/teams/license and trial screens | Release distribution exists; corresponding in-app surfaces mostly absent | `CheckForUpdateWithLastCheckedTime`, `ViewSupportDocs` |

## Selected workflow observations

These are manual syntax observations with byte anchors in [workflow-anchors.json](evidence/gitkraken-12.6.0/workflow-anchors.json), supported by the matching feature resource references. They establish UI/action wiring candidates; they do not establish complete backend execution.

| Workflow | What is visible in bundled code | Design implication for Branchlight |
|---|---|---|
| Cherry-pick (`GK-17`) | Context-menu click dispatches `promptToCherrypickOrRevert` with `CHERRYPICK`. The action declares configuration/index/repository-settings locks and checks repository identity. | Add a typed operation and an explicit selected-commit identity; retain serialized mutations and refreshed snapshots. |
| Hunk/line staging (`GK-13`) | Hunk buttons invoke `onHunkAction` with stage/unstage/discard. The editor's selected-line action has a multi-line-selection precondition. One earlier component also has placeholder callbacks, so a label alone is insufficient. | Build a real patch model and context-aware actions; revalidate the patch against current index/worktree content before applying it. |
| AI commit message (`GK-46`) | UI obtains the current repository and dispatches `generateCommitMessage`; its saga declares an index read lock and checks AI availability and repository identity. | Generate from a stable staged diff; discard stale responses after repository or staged-content changes. |
| Worktree creation (`GK-31`) | A branch menu passes the full selected ref to `openWorktreeSlideyPanelFromRef`. | Use full refs and an explicit path/base/branch form rather than ambiguous branch labels. |
| Agent session (`GK-51`) | Agent-session menu is enabled when available agent choices exist. A coding-agent enum declares Claude Code, Codex CLI, Copilot CLI, Cursor CLI, Gemini CLI, and OpenCode. Preferences describe setup commands and arguments. | Establish worktree creation, process/terminal lifecycle, and capability discovery before adding a session launcher. Installation/runtime compatibility of these agents remains unverified. |
| Provider capabilities (`GK-38`–`GK-40`) | GitHub metadata declares PR stacking, drafts, labels, reviewers, and templates. Other provider declarations differ. | Expose capabilities by provider, and avoid promising that every provider supports every PR action. |

## Product boundaries and important exceptions

**Git engine.** `package.json` names `@axosoft/nodegit`, `nodegit-flow`, `@octokit/rest`, `@xterm/xterm`, and `node-pty`. The package includes Electron entrypoints and separately bundled Git/LFS executables. Preferences describe a selectable Git executable path, an alternative NodeGit mode, and mode-specific limitations for sparse/shallow repositories and SSH signing. These are shipped declarations; the currently active engine and actual native exports remain unknown. Branchlight can retain its system-Git Rust/Tauri architecture while implementing the same user tasks.

**Hosting and issue trackers.** The bundles/resources name GitHub, GitHub Enterprise Server, GitLab, GitLab self-managed, Bitbucket, Bitbucket Data Center, Azure DevOps, Jira, and Trello. The inventory identifies issue workflows and provider-specific declarations, not a tested integration matrix. For example, a dependency or a literal containing “Linear” is insufficient to declare a working Linear integration. The `Cli-*` resource family also contains command/help/completion descriptions; its 777 keys are not counted as 777 implemented GUI features.

**AI and agents are different surfaces.** Message generation, explanations, conflict assistance, and commit composition appear under AI actions/preferences. Coding-agent sessions additionally reference worktrees, terminal execution, status plugins, attention filters, and permission responses. A provider/model preference or agent ID is a configuration candidate, not proof that a particular model or executable is installed or supported today.

**Preview and experimental labels.** Working-change/branch explanations and commit composition/recomposition are explicitly labeled Preview in some resources. A Code Review announcement describes a preview with AI suggestions and integrated chat; that announcement alone does not establish a complete chat implementation, so chat is not counted as a verified feature here. Experimental preferences describe Git-engine selection and Cloud Patches, but static resources do not establish the user's current feature-flag values.

**Themes.** Built-in theme switching is observed. `Theme-CustomThemeDeprecationNoticeMessage1` says custom themes were disabled beginning in 11.8.0. Custom-theme authoring is therefore not listed as a current supported capability merely because older theme resources remain packaged.

**Licensing and accounts.** Resources describe paid/private-repository restrictions, self-hosted-provider upgrades, multiple profiles, team visibility, Launchpad snoozing, editable merge output, and AI credits. These are observed prompts, not a verified current commercial plan or proof of enforcement. Licensing, cloud storage access controls, account sync, and organization permissions need live account/provider validation before claiming parity.

## Recommended implementation sequence

This is an analyst proposal for Branchlight based on the observed gaps and the existing architecture. It is not a commitment to reproduce every GitKraken feature, and it does not change [PLAN.md](../PLAN.md) or V1 scope.

| Phase | Scope / feature IDs | Why this order | Completion criteria for a future implementation |
|---|---|---|---|
| 1 — See and select changes | Text diffs and commit details (`GK-05`, `GK-08`, `GK-12`), file history (`GK-11`), hunk/line staging (`GK-13`) | Makes existing stage/commit/history operations inspectable and precise. | Select a working file or commit and read its diff; distinguish staged/unstaged content; apply selected hunks/lines without losing other changes; detect stale selections. |
| 2 — Finish and recover Git operations | Continue/skip merge/rebase (`GK-20`), visual conflict resolution (`GK-29`), amend/cherry-pick/revert (`GK-16`, `GK-17`), tags and upstream controls (`GK-22`, `GK-24`) | Completes operations that currently require an external CLI and adds common history actions. | Track operation type and progress; offer only valid continuation/abort actions; preserve external edits; display conflict and command failures with a refreshed snapshot. |
| 3 — Navigate and organize | Search and graph filters (`GK-06`, `GK-07`), recent/favorite repositories and tabs (`GK-03`, `GK-04`), command palette (`GK-56`), clone/init (`GK-01`) | Reduces navigation cost as usage grows beyond a single repository. | Repository-scoped requests cannot update another tab; persist recent paths; provide keyboard navigation; page history beyond 200 commits without breaking DAG edges. |
| 4 — Parallel local work | Worktree management (`GK-31`), terminal/external tools (`GK-54`, `GK-55`), settings/profiles (`GK-57`, `GK-58`) | Establishes the prerequisites for isolated coding tasks and agent sessions. | Inspect existing worktrees; validate branch/path conflicts; open/create/lock/remove safely; manage terminal shutdown; scope settings and Git operations correctly. |
| 5 — Advanced history and repositories | Interactive rebase/reset/undo (`GK-18`, `GK-19`, `GK-21`), patches (`GK-35`), sparse checkout/submodules/LFS (`GK-32`–`GK-34`), remote variants (`GK-26`, `GK-27`) | Adds more complex and potentially destructive operations after diff/recovery foundations exist. | Preview history transformations; check stale refs and operation state; define undo limits; support missing Git/LFS capabilities and unusual repository layouts. |
| 6 — Connected review and AI | Provider APIs, PRs/issues/stacks (`GK-37`–`GK-41`), workspaces/Launchpad (`GK-44`, `GK-45`), AI assistance and agent sessions (`GK-46`–`GK-53`) | Requires provider auth, remote APIs, process lifecycle, explicit data sharing, and durable state beyond the Git CLI. | Capability-based provider UI; cancellation and rate-limit handling; reviewed AI output; correct session/worktree association; explicit agent status and permission handling. |

Cloud Patches and Code Suggestions (`GK-42`, `GK-43`) require a service and permission model. They can follow a demonstrated need for collaboration. An initial Branchlight version can deliver useful local patches (`GK-35`) independently. Gitflow (`GK-25`) is another optional workflow layer rather than a prerequisite for ordinary branch management.

### Suggested architecture for the next phase

Keep the current React → typed Tauri command → Rust Git-domain boundary. Add structured models for diff files, hunks, lines, commit details, and active operations. Put Git argument construction and path/ref validation in the backend, and send selected identifiers/operations from the UI. Handle binary files, renames, file modes, empty/unborn repositories, and stale diff content explicitly.

For hunk staging, separate the diff read from the patch application and verify the selected context still matches. For operation recovery, add an operation snapshot that can distinguish merge, rebase, cherry-pick, and revert, then derive available actions from that state. For worktrees, distinguish shared repository metadata/ref mutations from each worktree's index and working directory; tabs and agents must not accidentally mutate another worktree.

The existing serialized mutations and full refresh after attempted mutations are useful foundations. A future multi-repository implementation will need locks and async response identities scoped to the actual repository/worktree operation, along with cancellation and stale-result checks. Use GitKraken's observed user tasks as requirements; implement them within Branchlight's own domain model.

## Reproduction and validation

Verify the durable references against the same installed app:

```sh
python3 docs/evidence/gitkraken-12.6.0/verify_evidence.py
```

The verifier reads the original ASAR, checks its whole-file digest and all 58 selected packed members, resolves every saved resource pointer, and checks saved code occurrence counts/byte offsets. An app update changes the archive identity and should fail verification rather than silently mixing versions. This check does not execute GitKraken or validate the mismatching unpacked Git member.

To repeat REA analysis, extract only the manifest-selected packed members into a new directory, preserving their paths and bytes. Call `analyze_javascript_application` with `format: "directory"` and that path. If the tool returns a transport resource constraint, use the returned same-session retained Evidence reference with `inspect_analysis_view` (`view: {kind: "summary"}`), then export the bundle. Evidence IDs, graph hashes and limits may differ with the analyzer version or environment; record the actual values. This run's provider IDs/versions are saved in the Evidence files; a REA npm release number was not returned and is not assumed.

Validation performed for this report: original archive identity; all selected packed-member hashes/integrity entries; all 59 feature-group resource pointers; 663 saved literal code byte references; selected workflow anchors; JSON validity; local Markdown links; and Git whitespace checks. No product behavior tests were run, and neither GitKraken nor Branchlight was launched.

## Coverage checklist and remaining questions

| Investigation question | Result |
|---|---|
| Which installed app/version was inspected? | Answered: GitKraken 12.6.0, original ASAR and derived-input identities recorded. |
| What user-facing feature families are present in shipped resources/code? | Answered within the selected scope: 59 groups with exact references. This is a broad inventory, not proof of all hidden or server-enabled features. |
| Which capabilities overlap with Branchlight V1? | Answered at current API/UI scope: basic repository/status/staging/commit/branch/remote/stash/history/abort workflows already exist; higher-level gaps are listed per group. |
| Which next increments fit Branchlight? | Proposed: six ordered phases with prerequisites and completion criteria. |
| Are features reachable, correct, and enabled for a particular plan/account? | Unresolved: requires live UI/account/provider validation. |
| How do full backend/native implementation paths work? | Partial: selected UI/action syntax inspected; semantic tracing incomplete; native code and excluded dependencies unexamined. |
| Why does the unpacked Git executable differ from the ASAR integrity hash? | Unresolved: original analysis stopped at that discrepancy; no cause was established. |
| Are graph performance, accessibility, permissions, cloud security, and agent process cleanup correct? | Unresolved: requires focused source/native/runtime investigations and behavioral checks. |

Before implementing a selected feature, narrow the next investigation to its concrete inputs, state transitions, error/recovery paths, and expected UX. Validate the corresponding runtime behavior where static evidence cannot answer those questions.
