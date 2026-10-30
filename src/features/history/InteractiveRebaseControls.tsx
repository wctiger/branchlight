import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OperationDialog } from "@/components/operation-dialog";
import { getRebasePlan, normalizeGitError } from "@/lib/tauri";
import type { RebaseStep, RunDelivery } from "@/types/delivery";
import styles from "@/features/history/InteractiveRebaseControls.module.css";

export function InteractiveRebaseControls({
  path,
  revision,
  head,
  branch,
  disabled,
  run,
}: {
  path: string;
  revision: string;
  head: string | null;
  branch: string | null;
  disabled: boolean;
  run: RunDelivery;
}) {
  const [plan, setPlan] = useState<(RebaseStep & { subject: string })[] | null>(
    null,
  );
  const [review, setReview] = useState<{ head: string; branch: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retained = plan?.filter((step) => step.action !== "drop") ?? [];
  const valid =
    retained.length > 0 &&
    retained[0].action !== "squash" &&
    retained.every((step) => step.action !== "reword" || step.message?.trim());
  function move(index: number, direction: number) {
    setPlan((current) => {
      if (
        !current ||
        index + direction < 0 ||
        index + direction >= current.length
      )
        return current;
      const next = [...current];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      return next;
    });
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy || !head || !branch}
        onClick={async () => {
          if (!head || !branch) return;
          setBusy(true);
          setError("");
          setReview({ head, branch });
          try {
            setPlan(
              (await getRebasePlan(path, revision)).map((commit) => ({
                ...commit,
                action: "pick",
                message: "",
              })),
            );
          } catch (error) {
            setError(normalizeGitError(error).message);
            setReview(null);
          } finally {
            setBusy(false);
          }
        }}
      >
        Interactive rebase…
      </Button>
      {error && !plan && <p role="alert">{error}</p>}
      {plan && review && (
        <OperationDialog
          title="Review interactive rebase"
          busy={busy}
          onClose={() => {
            setPlan(null);
            setReview(null);
          }}
          description={
            <p>
              Rewrite local branch <strong>{review.branch}</strong> from commit{" "}
              {revision.slice(0, 12)} through {review.head.slice(0, 12)}. Rows
              run from top to bottom. Squash combines a commit into the
              preceding retained commit. Published history may require
              coordination and force-with-lease. Start with a clean working
              tree.
            </p>
          }
        >
          <ol className={styles.plan} aria-label="Ordered rebase plan">
            {plan.map((step, index) => (
              <li key={step.hash}>
                <code>{step.hash.slice(0, 12)}</code> {step.subject}
                <label>
                  Action for {step.hash.slice(0, 12)}
                  <select
                    disabled={busy}
                    value={step.action}
                    onChange={(event) => {
                      const action = event.target.value as RebaseStep["action"];
                      setPlan(
                        plan.map((item) =>
                          item.hash === step.hash ? { ...item, action } : item,
                        ),
                      );
                    }}
                  >
                    <option value="pick">Pick</option>
                    <option value="drop">Drop</option>
                    <option value="squash">Squash</option>
                    <option value="reword">Reword</option>
                  </select>
                </label>
                <Button
                  variant="outline"
                  disabled={busy || index === 0}
                  aria-label={`Move ${step.hash.slice(0, 12)} earlier`}
                  onClick={() => move(index, -1)}
                >
                  Earlier
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || index === plan.length - 1}
                  aria-label={`Move ${step.hash.slice(0, 12)} later`}
                  onClick={() => move(index, 1)}
                >
                  Later
                </Button>
                {step.action === "reword" && (
                  <label>
                    New message for {step.hash.slice(0, 12)}
                    <textarea
                      disabled={busy}
                      value={step.message ?? ""}
                      onChange={(event) =>
                        setPlan(
                          plan.map((item) =>
                            item.hash === step.hash
                              ? { ...item, message: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                )}
              </li>
            ))}
          </ol>
          {!valid && (
            <p role="status">
              Retain at least one commit, give each reword a message, and put a
              retained commit before squash.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setPlan(null);
              setReview(null);
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={
              disabled ||
              busy ||
              !valid ||
              head !== review.head ||
              branch !== review.branch
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                if (
                  await run({
                    kind: "history",
                    expectedHead: review.head,
                    expectedBranch: review.branch,
                    action: {
                      kind: "interactiveRebase",
                      revision,
                      steps: plan.map(({ hash, action, message }) => ({
                        hash,
                        action,
                        message,
                      })),
                    },
                  })
                ) {
                  setPlan(null);
                  setReview(null);
                } else
                  setError(
                    "Git stopped or failed. Close this dialog to review the refreshed operation status and use continue, skip, or abort.",
                  );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Rebasing…" : "Rewrite branch with this plan"}
          </Button>
        </OperationDialog>
      )}
    </>
  );
}
