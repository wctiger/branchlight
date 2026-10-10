# Branchlight feature selection

Selected by the project owner on **2026-10-10**, using the
[GitKraken feature analysis](GITKRAKEN_FEATURE_ANALYSIS.md) as the inventory.
This document records product scope and relative priorities for future work.
It takes precedence over the analysis report's proposed implementation sequence
when deciding what to build. It does not expand the original [V1 plan](../PLAN.md)
or claim that selected features are already implemented.

## Product direction

- Use the user's installed **Git executable**. There is no plan to bundle Git.
- Reuse local Git configuration, Git identity, SSH configuration, and credential
  helpers. Do not introduce provider accounts, OAuth flows, or credential storage.
- Focus branch actions on **local branches**. Check out a remote-tracking branch
  into a local branch before modifying it. Setting its upstream and fetching,
  pulling, or pushing are supported requirements; automatic remote branch
  rename/deletion or synchronization is not required.
- Support worktrees as a local Git feature, independently of agents or terminals.
- Provide an interface for debug information and logs.

## Priority definitions

| Priority | Meaning |
|---|---|
| P0 — Core | Required for the first implementation of the selected scope. Preserve existing working capabilities and fill their selected gaps. |
| P1 — Later | Required or useful, but explicitly below core operations in priority. |
| P2 — Optional | Nice to have; no committed implementation order. |
| Excluded | Outside the selected scope. |
| Unconfirmed | No selection was captured; do not infer approval from the analysis report. |

Priorities apply to the listed subfeatures, not automatically to every capability
in a GitKraken feature group. Existing capability notes below are inherited from
the analysis snapshot, not a new implementation audit.

## P0 — Core requirements, by category

### Commits and history operations

| Feature | Inventory | Selected scope | Existing baseline / additions |
|---|---|---|---|
| Commit composition | GK-15 | Separate summary and body inputs. Offer push after commit and an explicit skip-hooks control. Commit templates are excluded. | Basic commit/message exists; add the composition UI and controls. |
| Amend and reword | GK-16 | Amend the previous commit and reword commit messages. | New capability. The transcript's “reward” is interpreted as “reword”; stash-message editing was not separately selected. |
| Cherry-pick and revert | GK-17 | Cherry-pick selected commits and revert commits. | New capability. A separate interactive cherry-pick editor was not selected. |
| Reset | GK-18 | Reset a local branch to a selected commit; expose soft, mixed, and hard modes with their effects clearly described. | New capability. Mode coverage comes from the selected inventory group. |
| Ordinary rebase and abort | GK-19, GK-20, GK-23 | Support ordinary rebase first. Detect active operations and provide abort for merge and rebase. | Ordinary rebase, operation detection, and abort exist; retain them as core. |

**Recovery dependency:** rebase continue/resume and skip are P1 by the owner's
selection. Until they exist in the UI, show the active operation and make clear
that finishing a stopped rebase requires external Git. Abort must remain
available. Rewording an older commit may require a rebase internally; its
implementation must account for stopped operations even while a general
interactive-rebase editor remains deferred.

### Local branches and upstreams

| Feature | Inventory | Selected scope | Existing baseline / additions |
|---|---|---|---|
| Branch lifecycle | GK-22 | Create, switch, rename, and delete local branches; create a branch at a selected commit. | Basic local lifecycle exists; add branch-at-commit. |
| Remote branch checkout and tracking | GK-22, GK-26 | Check out a remote-tracking branch as a local branch; choose and set the local branch's upstream using configured remotes. | Upstream selection/editing needs UI support. |
| Merge and rebase | GK-23 | Merge and rebase local branches, including fast-forward behavior where applicable. | Basic operations exist. Squash merge was not separately selected. |

### Fetch, pull, and push

| Feature | Inventory | Selected scope | Existing baseline / additions |
|---|---|---|---|
| Fetch and prune | GK-27 | Fetch configured remotes and prune stale remote-tracking references. | Basic fetch exists; expose the selected variants. |
| Pull strategies | GK-27 | Pull using merge, rebase, or fast-forward-only behavior. | Basic pull exists; expose explicit strategies. |
| Push | GK-27 | Push the local branch using its selected tracking destination; support force push. | Basic push exists; add an explicit force workflow. Prefer force-with-lease as the default force option, with the effect explained. |

Remote configuration remains external. A remote editor, push-all-remotes action,
and a separate destination picker beyond upstream selection are not required.
Configurable automatic fetching was not explicitly selected.

### Stashes

| Feature | Inventory | Selected scope | Existing baseline / additions |
|---|---|---|---|
| Stash lifecycle and selective changes | GK-28 | Create, list, apply, pop, and delete stashes; stash selected files and restore a file from a stash. | Basic lifecycle exists; add selective file operations. |

### Worktrees

| Feature | Inventory | Selected scope | Existing baseline / additions |
|---|---|---|---|
| Worktree lifecycle | GK-31 | Create, open, lock, unlock, prune, and remove worktrees; optionally delete the associated branch when removing a worktree. | New capability. Branch deletion must be a separate explicit choice. |

### Local configuration and diagnostics

| Feature | Inventory | Selected scope | Existing baseline / additions |
|---|---|---|---|
| Hooks | GK-36, GK-15 | Honor hooks and the locally configured hooks directory. Surface hook failures and provide the selected explicit skip-hooks action for commits. | System Git already reads configuration; add useful UI feedback and commit controls. A hooks editor and signing-settings UI were not separately selected. |
| Git identity | GK-57 | Use the identity provided by local Git configuration. | Existing architecture; no account or profile system required. |
| Diagnostics and logs | GK-59, partial | Provide a UI to inspect debug information and operation logs, including the Git executable/version and useful command errors. | Selected exception to excluding the broader product/account group. Avoid displaying credentials or secrets in logs. |

## P1 — Later requirements, by category

| Category | Feature / inventory | Selected scope |
|---|---|---|
| History editing | Interactive rebase — GK-19 | Required eventually: a UI for pick, drop, reorder, squash, and reword. Ordinary rebase comes first. |
| Operation recovery | Resume/continue and skip — GK-20 | Add controls to finish or skip stopped rebase steps; derive valid actions from operation state. Abort stays P0. |
| Branches | Tags — GK-24 | Add tag lifecycle support after core branching. Start with local creation, inspection, and deletion; remote tag administration is not implied by this selection. |
| Conflicts | Three-way merge resolution — GK-29 | A basic visual resolver showing base, current, incoming, and output; save the resolution and mark files resolved. Helpful, below core priority. |
| Advanced Git | Submodules — GK-32 | Required later: manage and open submodules, show expected/current revisions, and support their lifecycle. |
| Advanced Git | Git LFS — GK-33 | Lower priority: dedicated LFS controls, using the user's installed Git/LFS environment. Do not assume LFS is bundled. |
| Tools | External tools — GK-55 | Lower priority: open editors, terminals, file managers, or external diff/merge tools. |
| Navigation | Command palette and keybindings — GK-56 | Lower priority: command discovery and configurable shortcuts. |
| Preferences | Appearance — GK-58 | Support simple preferences, at least theme selection. Broader editor/panel settings are not a parity requirement. |

## P2 — Optional

| Category | Feature / inventory | Decision |
|---|---|---|
| History recovery | Undo/redo — GK-21 | Nice to have; defer. If implemented, describe which operations can actually be undone. |

## Excluded scope

| Category | Inventory | Excluded capabilities |
|---|---|---|
| Commit composition | GK-15, partial | Commit templates. |
| Branch workflows | GK-25 | Gitflow configuration and start/finish flows. |
| Remote administration | GK-26, partial | Add/edit/remove remote UI, push-all-remotes, and a separate push-destination workflow beyond selected upstream tracking. |
| Conflicts | GK-30 | Proactive conflict detection and team conflict warnings. |
| Advanced Git | GK-34, GK-35 | Sparse checkout management and local patch import/export workflows. |
| Provider integrations | GK-37–GK-41 | Hosting-provider account connections, PR creation/review/stacks/CI dashboards, and issue trackers. Git transport still uses existing local credentials. |
| Collaboration | GK-42–GK-45 | Cloud Patches, Code Suggestions, local/cloud workspaces, and Launchpad dashboards. |
| AI | GK-46–GK-50 | Message generation, explanations, conflict assistance, commit composition, and AI provider settings. |
| Agents | GK-51–GK-53 | Agent sessions, dashboards, plugins, and permission interfaces. |
| Tools | GK-54 | Embedded terminal. |
| Profiles/accounts | GK-57, partial | Profiles, remote accounts, identity synchronization, and account-backed preferences. Local Git identity remains in use. |
| Product administration | GK-59, partial | Reproducing GitKraken's onboarding, account, organization, team, license, trial, support, and update-management surfaces. Diagnostics/logs are the explicit exception. Existing macOS release distribution is a separate concern. |

## Unconfirmed selections

The available selection transcript starts at **GK-15** and refers to an earlier
portion that was not captured here. The following groups have **no recorded
decision** in this document. Existing Branchlight functionality remains the
baseline; new capabilities in these groups are not approved merely because the
analysis recommended them.

| Category | Inventory | Awaiting selection |
|---|---|---|
| Repositories | GK-01–GK-04 | Initialize/clone, advanced clone, recent/favorite repositories, tabs/groups. |
| Graph | GK-05–GK-07 | Graph improvements, visibility controls, commit search, author filters. |
| Diffs | GK-08–GK-12 | Text/image diffs, file editing, history/blame, revision comparisons and restore. |
| Staging | GK-13–GK-14 | Hunk/line staging, discard, ignore controls. |

Features within selected groups that were not separately discussed—such as
signing configuration, automatic fetching, remote tag operations, squash merge,
or stash-message rewording—also remain unconfirmed rather than automatically
included.

## Suggested delivery order within the selected scope

1. Commit summary/body and controls; branch-at-commit and upstream selection;
   fetch/prune, pull strategies, and force-with-lease push.
2. Amend/reword, cherry-pick/revert, and reset, with operation-state reporting,
   reliable abort, and diagnostic logs available alongside these changes.
3. Selective stash actions and the worktree lifecycle.
4. P1 capabilities, scheduling recovery controls before a general interactive
   rebase editor. Visual resolution, tags, submodules, LFS, tools, and themes
   follow based on need.
5. Optional undo/redo only after its supported recovery limits are clear.

This order is an implementation suggestion within the owner's priorities.
Read-only commit inspection and diff primitives may be dependencies of selected
actions; that does not approve all currently unconfirmed graph/diff features.
