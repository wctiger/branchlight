import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OperationDialog } from "@/components/operation-dialog";
import type { HistoryAction, RunDelivery } from "@/types/delivery";
import type { Commit } from "@/types/history";
import styles from "@/features/DeliveryControls.module.css";
import { InteractiveRebaseControls } from "@/features/history/InteractiveRebaseControls";

export function HistoryControls({
  commit,
  path,
  head,
  branch,
  disabled,
  run,
}: {
  commit: Commit;
  path?: string;
  head: string | null;
  branch: string | null;
  disabled: boolean;
  run: RunDelivery;
}) {
  const [expectedHead, setExpectedHead] = useState<string | null>(null);
  const [expectedBranch, setExpectedBranch] = useState<string | null>(null);
  const [kind, setKind] = useState<Exclude<HistoryAction["kind"], "interactiveRebase"> | null>(null);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"soft" | "mixed" | "hard">("soft");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const rewriting = kind === "amend" || kind === "reword";
  const effects = {
    soft: "Move the branch to this commit and keep changes staged.",
    mixed: "Move the branch to this commit and keep changes unstaged.",
    hard: "Move the branch to this commit and discard staged and tracked working changes. Untracked paths obstructing tracked files may also be deleted.",
  };
  const labels = {
    amend: "Amend latest commit",
    reword: "Reword commit",
    cherryPick: "Cherry-pick commit",
    revert: "Revert commit",
    reset: "Reset branch",
  };
  return (
    <div className={styles["history-controls"]}>
      {path && <InteractiveRebaseControls path={path} revision={commit.hash} head={head} branch={branch} disabled={disabled} run={run} />}
      {(["amend", "reword", "cherryPick", "revert", "reset"] as const).map(
        (action) => (
          <Button
            key={action}
            data-command={`history.${action}`}
            size="sm"
            variant="outline"
            disabled={
              disabled || !head || !branch || (action === "amend" && commit.hash !== head)
            }
            onClick={() => {
              setKind(action);
              setExpectedHead(head);
              setExpectedBranch(branch);
              setMessage("");
              setMode("soft");
              setFailed(false);
            }}
          >
            {labels[action]}
          </Button>
        ),
      )}
      {kind && (
        <OperationDialog
          title={labels[kind]}
          busy={busy}
          onClose={() => setKind(null)}
          description={
            <>
              <p>
                Selected commit: <code>{commit.hash.slice(0, 12)}</code> ·{" "}
                {commit.subject}
              </p>
              {rewriting && (
                <p>
                  This rewrites history. Published commits may require
                  coordination and a force-with-lease push.{" "}
                  {kind === "amend"
                    ? "Staged changes will be included."
                    : "Only the message changes; descendants receive new commit IDs. Rewording across merges requires external Git."}
                </p>
              )}
              {kind === "cherryPick" && (
                <p>
                  Apply this commit to the current branch. Start with a clean
                  working tree. Conflicts may require external Git to finish.
                </p>
              )}
              {kind === "revert" && (
                <p>
                  Create a new commit that reverses this commit’s changes. Start
                  with a clean working tree. Conflicts may require external Git
                  to finish.
                </p>
              )}
              {kind === "reset" && (
                <p>{effects[mode]} Reset rewrites the branch’s history.</p>
              )}
            </>
          }
        >
          {rewriting && (
            <label className={styles["history-message"]}>
              New full commit message
              <textarea
                className={styles["delivery-body"]}
                aria-label="New full commit message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={busy}
              />
            </label>
          )}
          {kind === "reset" && (
            <fieldset className={styles["reset-modes"]} disabled={busy}>
              <legend>Reset mode</legend>
              {(["soft", "mixed", "hard"] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="resetMode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  {value}
                </label>
              ))}
            </fieldset>
          )}
          {failed && (
            <p role="alert">
              Git could not complete this operation. Close this dialog to review
              the error and current operation state.
            </p>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setKind(null)}
          >
            Cancel
          </Button>
          <Button
            variant={
              kind === "reset" && mode === "hard" ? "destructive" : "default"
            }
            disabled={
              disabled || busy || !head || (rewriting && !message.trim())
            }
            onClick={async () => {
              if (!expectedHead || !expectedBranch) return;
              const action: HistoryAction =
                kind === "amend"
                  ? { kind, message }
                  : kind === "reword"
                    ? { kind, revision: commit.hash, message }
                    : kind === "reset"
                      ? { kind, revision: commit.hash, mode }
                      : { kind, revision: commit.hash };
              setBusy(true);
              try {
                if (await run({ kind: "history", expectedHead, expectedBranch, action }))
                  setKind(null);
                else setFailed(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Running…"
              : kind === "reset" && mode === "hard"
                ? "Discard changes and reset"
                : labels[kind]}
          </Button>
        </OperationDialog>
      )}
    </div>
  );
}
