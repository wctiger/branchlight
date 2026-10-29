import type { BranchStatus } from "@/types/status";

/** Summarizes the checked-out branch and its upstream divergence. */
export function BranchSummary({ branch }: { branch: BranchStatus }) {
  const branchLabel = branch.isDetached
    ? "Detached HEAD"
    : (branch.name ?? "Unknown branch");
  const trackingLabel = branch.isDetached
    ? (branch.oid?.slice(0, 10) ?? "No commit")
    : (branch.upstream ?? (branch.oid ? "No upstream" : "No commits yet"));

  return (
    <div className="branch-summary">
      <span className="branch-symbol" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <div className="branch-summary__identity">
        <strong>{branchLabel}</strong>
        <span>{trackingLabel}</span>
      </div>
      {branch.upstream && (
        <div className="branch-counts" aria-label="Upstream divergence">
          <span title="Commits ahead of upstream">↑ {branch.ahead ?? 0}</span>
          <span title="Commits behind upstream">↓ {branch.behind ?? 0}</span>
        </div>
      )}
    </div>
  );
}
