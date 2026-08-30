import { describe, expect, test } from "bun:test";

import { layoutCommitGraph } from "../src/features/history/graph";
import type { Commit } from "../src/types/history";

/** Builds concise graph fixtures without omitting any production commit field. */
function commit(
  hash: string,
  parents: string[],
  refs: string[] = [],
): Commit {
  return {
    hash,
    parents,
    refs,
    subject: hash,
    author: "Test Author",
    timestamp: 1_700_000_000,
  };
}

describe("layoutCommitGraph", () => {
  test("keeps linear history in one vertical lane", () => {
    const commits = [
      commit("c", ["b"], ["main"]),
      commit("b", ["a"]),
      commit("a", []),
    ];

    const layout = layoutCommitGraph(commits);

    expect(layout.laneCount).toBe(1);
    expect(layout.nodes.map((node) => node.lane)).toEqual([0, 0, 0]);
    expect(layout.edges).toEqual([
      {
        childHash: "c",
        parentHash: "b",
        fromRow: 0,
        fromLane: 0,
        toRow: 1,
        toLane: 0,
      },
      {
        childHash: "b",
        parentHash: "a",
        fromRow: 1,
        fromLane: 0,
        toRow: 2,
        toLane: 0,
      },
    ]);
  });

  test("uses a diagonal lane for ordinary branch divergence", () => {
    const commits = [
      commit("main-tip", ["base"], ["main"]),
      commit("feature-tip", ["base"], ["feature"]),
      commit("base", ["root"]),
      commit("root", []),
    ];

    const layout = layoutCommitGraph(commits);

    expect(layout.nodes.map(({ hash, lane }) => ({ hash, lane }))).toEqual([
      { hash: "main-tip", lane: 0 },
      { hash: "feature-tip", lane: 1 },
      { hash: "base", lane: 0 },
      { hash: "root", lane: 0 },
    ]);
    expect(layout.edges).toContainEqual({
      childHash: "feature-tip",
      parentHash: "base",
      fromRow: 1,
      fromLane: 1,
      toRow: 2,
      toLane: 0,
    });
    expect(layout.nodes.find((node) => node.hash === "feature-tip")?.refs)
      .toEqual(["feature"]);
  });

  test("renders both parent relationships for a two-parent merge", () => {
    const commits = [
      commit("merge", ["main-work", "feature-work"], ["main"]),
      commit("main-work", ["base"]),
      commit("feature-work", ["base"], ["feature"]),
      commit("base", []),
    ];

    const first = layoutCommitGraph(commits);
    const second = layoutCommitGraph(commits);

    expect(second).toEqual(first);
    expect(first.laneCount).toBe(2);
    expect(first.edges.filter((edge) => edge.childHash === "merge"))
      .toEqual([
        {
          childHash: "merge",
          parentHash: "main-work",
          fromRow: 0,
          fromLane: 0,
          toRow: 1,
          toLane: 0,
        },
        {
          childHash: "merge",
          parentHash: "feature-work",
          fromRow: 0,
          fromLane: 0,
          toRow: 2,
          toLane: 1,
        },
      ]);

    const expectedRelationships = commits.flatMap((entry) =>
      entry.parents
        .filter((parent) => commits.some((candidate) => candidate.hash === parent))
        .map((parent) => `${entry.hash}->${parent}`),
    );
    expect(first.edges.map((edge) => `${edge.childHash}->${edge.parentHash}`))
      .toEqual(expectedRelationships);
  });
});
