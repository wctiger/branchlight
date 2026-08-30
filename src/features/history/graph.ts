import type { Commit } from "../../types/history";

export interface GraphNode {
  hash: string;
  row: number;
  lane: number;
  refs: string[];
}

export interface GraphEdge {
  childHash: string;
  parentHash: string;
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
}

export interface CommitGraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  laneCount: number;
}

/** Returns the lowest reusable lane, growing the active lane list when needed. */
function reserveOpenLane(activeLanes: Array<string | null>): number {
  const openLane = activeLanes.indexOf(null);
  if (openLane >= 0) {
    return openLane;
  }

  activeLanes.push(null);
  return activeLanes.length - 1;
}

/** Computes stable rows, lanes, and exact child-to-parent edges for bounded history. */
export function layoutCommitGraph(commits: Commit[]): CommitGraphLayout {
  const activeLanes: Array<string | null> = [];
  const nodes: GraphNode[] = [];
  let laneCount = 0;

  commits.forEach((commit, row) => {
    let lane = activeLanes.findIndex((expectedHash) => expectedHash === commit.hash);
    if (lane < 0) {
      lane = reserveOpenLane(activeLanes);
    }

    activeLanes.forEach((expectedHash, expectedLane) => {
      if (expectedHash === commit.hash) {
        activeLanes[expectedLane] = null;
      }
    });

    commit.parents.forEach((parentHash) => {
      if (activeLanes.includes(parentHash)) {
        return;
      }
      const parentLane = activeLanes[lane] === null
        ? lane
        : reserveOpenLane(activeLanes);
      activeLanes[parentLane] = parentHash;
    });

    nodes.push({
      hash: commit.hash,
      row,
      lane,
      refs: [...commit.refs],
    });
    laneCount = Math.max(laneCount, activeLanes.length, lane + 1);
  });

  const nodesByHash = new Map(nodes.map((node) => [node.hash, node]));
  const edges: GraphEdge[] = [];
  commits.forEach((commit) => {
    const child = nodesByHash.get(commit.hash);
    if (!child) {
      return;
    }
    commit.parents.forEach((parentHash) => {
      const parent = nodesByHash.get(parentHash);
      if (parent) {
        edges.push({
          childHash: child.hash,
          parentHash,
          fromRow: child.row,
          fromLane: child.lane,
          toRow: parent.row,
          toLane: parent.lane,
        });
      }
    });
  });

  return {
    nodes,
    edges,
    laneCount: Math.max(laneCount, commits.length > 0 ? 1 : 0),
  };
}
