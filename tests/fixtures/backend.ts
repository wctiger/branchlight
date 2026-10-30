// Development-only Vite fixture. Production builds always use the real Tauri API.
import type { Commit } from "@/types/history";
const names = [
  "branchlight",
  "payments-service",
  "payments-service-migrations",
  "web-client",
  "design-system",
  "infrastructure",
  "notifications",
  "shared-libraries",
  "mobile-client",
  "documentation",
  "analytics-pipeline",
  "customer-identity-platform",
];
export const commits: Commit[] = Array.from({ length: 300 }, (_, i) => ({
  hash: (i + 1).toString(16).padStart(8, "0") + "a".repeat(32),
  parents:
    i < 299 ? [(i + 2).toString(16).padStart(8, "0") + "a".repeat(32)] : [],
  refs:
    i % 11 === 0
      ? [
          "feature/transaction-reconciliation-with-long-ref",
          `origin/release-${i}`,
          "tag: v2.8.0",
        ]
      : [],
  subject: [
    "Reconcile pending transactions without blocking independent repositories",
    "Improve retry handling for background operations",
    "Update shared components and keyboard navigation",
    "Keep cached state consistent after a failed mutation",
  ][i % 4],
  author: `Contributor ${String((i % 30) + 1).padStart(2, "0")}${(i % 30) % 9 === 0 ? " · Alexandra Montgomery-Wellington" : ""}`,
  timestamp: 1792400000 - i * 3600,
}));
let chosen = 0;
export async function open() {
  return `/fixtures/${names[chosen++ % names.length]}`;
}
export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const path = String(args.path ?? args.destination ?? "/fixtures/branchlight");
  const branch = {
    name: "main",
    fullRef: "refs/heads/main",
    commit: commits[0].hash,
    isCurrent: true,
    upstream: "origin/main",
  };
  const changed = Array.from({ length: 16 }, (_, i) => ({
    path: `src/features/${i % 2 ? "payments" : "workspace"}/component-${i}.tsx`,
    originalPath: null,
    status: i % 3 ? "modified" : "untracked",
  }));
  let result: unknown;
  switch (command) {
    case "get_diagnostics":
      result = {
        version: "git version 2.50.0 (fixture)",
        pathCandidate: "/fixture/bin/git",
        logs: [
          {
            command: "commit",
            timestamp: 1792400000,
            exitCode: 0,
            durationMs: 42,
          },
        ],
      };
      break;

    case "get_git_version":
      result = {
        stdout: "git version 2.50.1 · UI fixture",
        stderr: "",
        exitCode: 0,
      };
      break;
    case "get_local_tags":
      result = [];
      break;
    case "open_repository":
    case "create_repository":
      result = { path, name: path.split("/").pop() };
      break;
    case "get_repository_status":
      result = {
        operation: "none",
        branch: {
          name: "main",
          oid: commits[0].hash,
          isDetached: false,
          upstream: "origin/main",
          ahead: 3,
          behind: 0,
        },
        staged: changed.slice(0, 3).map((c) => ({ ...c, status: "modified" })),
        unstaged: changed.slice(3),
        conflicts: [],
        stashCount: 2,
      };
      break;
    case "get_branches":
      result = {
        local: [
          branch,
          ...Array.from({ length: 10 }, (_, i) => ({
            ...branch,
            name: `feature/${i ? "update-" + i : "transaction-reconciliation"}`,
            fullRef: `refs/heads/feature/update-${i}`,
            isCurrent: false,
          })),
        ],
        remote: [
          {
            ...branch,
            name: "origin/main",
            fullRef: "refs/remotes/origin/main",
            isCurrent: false,
          },
        ],
      };
      break;
    case "get_lfs_state":
      result = {
        available: true, version: "git-lfs/3.8.1 (browser fixture)", filterConfigured: true,
        hookInstalled: true, hookPath: `${path}/.git/hooks/pre-push`, storagePath: `${path}/.git/lfs/objects`,
        pruneAllowed: true, pruneReason: "Default repository storage; remote verification is required before deletion.",
        patterns: [{pattern:"*.psd",source:".gitattributes",tracked:true,lockable:false}],
        files: [{name:"design/header.psd",oid:"a".repeat(64),size:16384,checkout:false,downloaded:true}],
        head: commits[0].hash,
      };
      break;
    case "review_lfs_prune":
      result = {report:"1 file would be pruned (16 KB)\n * " + "b".repeat(64),token:"fixture-prune"};
      break;
    case "get_lfs_progress":
      result = {active:false,message:"Git LFS operation completed."};
      break;
    case "execute_lfs_action":
      result = {stdout:"LFS fixture operation completed",stderr:"",exitCode:0};
      break;
    case "get_remotes":
      result = ["origin", "backup"];
      break;
    case "review_push":
      result = {
        branch: "main",
        localOid: commits[0].hash,
        remote: "origin",
        remoteRef: "refs/heads/main",
        expectedOid: commits[1].hash,
        destinationId: "fixture",
      };
      break;
    case "get_stashes":
      result = [
        {
          reference: "stash@{0}",
          commit: commits[4].hash,
          message: "WIP: preserve reconciliation work",
        },
        {
          reference: "stash@{1}",
          commit: commits[5].hash,
          message: "Keyboard navigation refinements",
        },
      ];
      break;
    case "get_history":
      result = commits;
      break;
    case "search_history": {
      const query = String(args.query ?? "").toLowerCase();
      const matching = commits.filter(commit => args.mode === "hash" ? commit.hash.startsWith(query) : commit.subject.toLowerCase().includes(query));
      result = {commits: matching.slice(0, args.mode === "hash" ? 1 : 200), limit: 200, hasMore: args.mode !== "hash" && matching.length > 200};
      break;
    }
    case "compare_revisions":
      result = {
        base: args.base,
        target: args.target,
        files: [
          {
            path: "src/features/payments/reconcile.ts",
            originalPath: null,
            status: "modified",
          },
        ],
      };
      break;
    case "get_text_diff":
      result = {
        context: "HEAD → index · reconcile.ts",
        text: inspectionFixturePatch(),
        truncated: false,
        binary: false,
      };
      break;
    case "get_file_history":
      result = commits
        .slice(0, 100)
        .map((c) => ({ ...c, timestamp: String(c.timestamp) }));
      break;
    default:
      throw new Error(
        `Fixture forbids mutations and unhandled commands: ${command}`,
      );
  }
  return structuredClone(result) as T;
}

// Development-only stress case; production builds never import this fixture.
function inspectionFixturePatch() {
  if (
    new URLSearchParams(window.location.search).get("diffFixture") === "large"
  ) {
    const first = Array.from(
      { length: 800 },
      (_, i) => `+export const value${i} = ${i};`,
    ).join("\n");
    return `diff --git a/large.ts b/large.ts\n--- a/large.ts\n+++ b/large.ts\n@@ -1 +1,800 @@\n-old value\n${first}\n@@ -5000 +5800 @@\n-old tail\n+new tail\n`;
  }
  return "diff --git a/reconcile.ts b/reconcile.ts\n--- a/reconcile.ts\n+++ b/reconcile.ts\n@@ -1,2 +1,2 @@\n-const pending = await fetchAll();\n+const pending = await fetchScoped(repository);\n return reconcile(pending);\n";
}
