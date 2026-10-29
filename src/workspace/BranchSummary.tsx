import styles from "@/workspace/BranchSummary.module.css";
import { ArrowDown, ArrowUp, GitBranch } from "lucide-react";
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
    <div className={styles["branch-summary"]}>
      <GitBranch className={styles["branch-symbol"]} aria-hidden="true" />
      <div className={styles["branch-summary__identity"]}>
        <strong>{branchLabel}</strong>
        <span>{trackingLabel}</span>
      </div>
      {branch.upstream && (
        <div className={styles["branch-counts"]} aria-label="Upstream divergence">
          <span title="Commits ahead of upstream"><ArrowUp aria-hidden="true" /> {branch.ahead ?? 0}</span>
          <span title="Commits behind upstream"><ArrowDown aria-hidden="true" /> {branch.behind ?? 0}</span>
        </div>
      )}
    </div>
  );
}
