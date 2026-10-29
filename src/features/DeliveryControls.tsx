import styles from "@/features/DeliveryControls.module.css";
import { useEffect, useState } from "react";
import { OperationDialog } from "../components/operation-dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { getRemotes, normalizeGitError, reviewPush } from "../lib/tauri";
import type { Branches } from "../types/branch";
import type {
  CommitOptions,
  PullStrategy,
  PushReview,
  RunDelivery,
} from "../types/delivery";

export function CommitComposer({
  disabled,
  staged,
  onCommit,
}: {
  disabled: boolean;
  staged: number;
  onCommit: (options: CommitOptions) => Promise<boolean>;
}) {
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [skipHooks, setSkipHooks] = useState(false);
  const [pushAfterCommit, setPushAfterCommit] = useState(false);
  return (
    <form
      data-slot="commit-panel" className={styles["commit-panel"]}
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || !staged || !summary.trim()) return;
        if (await onCommit({ summary, body, skipHooks, pushAfterCommit })) {
          setSummary("");
          setBody("");
          setSkipHooks(false);
          setPushAfterCommit(false);
        }
      }}
    >
      <h3>Commit staged changes</h3>
      <label>
        Summary
        <Input
          value={summary}
          disabled={disabled}
          onChange={(event) => setSummary(event.target.value)}
        />
      </label>
      <label>
        Body (optional)
        <textarea
          className={styles["delivery-body"]}
          value={body}
          disabled={disabled}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={skipHooks}
          disabled={disabled}
          onChange={(event) => setSkipHooks(event.target.checked)}
        />{" "}
        Skip pre-commit and commit-msg hooks for this commit
      </label>
      <p className={styles["commit-hint"]}>
        Prepare-commit-msg and post-commit hooks still run. Push hooks are
        unaffected. Your configured Git identity and hooks directory are used.
      </p>
      <label>
        <input
          type="checkbox"
          checked={pushAfterCommit}
          disabled={disabled}
          onChange={(event) => setPushAfterCommit(event.target.checked)}
        />{" "}
        Push to upstream after a successful commit
      </label>
      <Button type="submit" disabled={disabled || !staged || !summary.trim()}>
        Commit
      </Button>
    </form>
  );
}

export function RemoteControls({
  path,
  disabled,
  run,
}: {
  path: string;
  disabled: boolean;
  run: RunDelivery;
}) {
  const [mode, setMode] = useState<"fetch" | "pull" | "force" | null>(null);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [remote, setRemote] = useState("");
  const [prune, setPrune] = useState(false);
  const [strategy, setStrategy] = useState<PullStrategy>("fastForwardOnly");
  const [review, setReview] = useState<PushReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!mode) return;
    let active = true;
    setLoading(true);
    setError("");
    setReview(null);
    const request =
      mode === "fetch"
        ? getRemotes(path).then((names) => {
            if (active) {
              setRemotes(names);
              setRemote(names[0] ?? "");
            }
          })
        : mode === "force"
          ? reviewPush(path).then((value) => {
              if (active) setReview(value);
            })
          : Promise.resolve();
    void request
      .catch((failure) => {
        if (active) setError(normalizeGitError(failure).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, path]);
  async function confirm() {
    if (disabled || loading) return;
    const action =
      mode === "fetch"
        ? { kind: "fetch" as const, remote, prune }
        : mode === "pull"
          ? { kind: "pull" as const, strategy }
          : review
            ? { kind: "force" as const, review }
            : null;
    if (action) {
      await run(action);
      setMode(null);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setMode("fetch")}
      >
        Fetch…
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setMode("pull")}
      >
        Pull…
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => void run({ kind: "push" })}
      >
        Push
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setMode("force")}
      >
        Force push…
      </Button>
      {mode && (
        <OperationDialog
          title={
            mode === "force"
              ? "Review force-with-lease push"
              : mode === "fetch"
                ? "Fetch configured remote"
                : "Pull from upstream"
          }
          description={
            mode === "force"
              ? "This can replace remote history. The push is rejected if the remote branch differs from the expected commit below. Fetching afterward does not update this expectation."
              : "Uses your installed Git and existing credentials."
          }
          busy={disabled}
          onClose={() => setMode(null)}
        >
          {loading && <p role="status">Reading Git configuration…</p>}
          {error && <p role="alert">{error}</p>}
          {mode === "fetch" && (
            <>
              <label>
                Remote
                <select
                  value={remote}
                  disabled={disabled || loading}
                  onChange={(event) => setRemote(event.target.value)}
                >
                  {remotes.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              {!loading && !remotes.length && !error && (
                <p>Configure a remote using external Git, then reopen Fetch.</p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={prune}
                  disabled={disabled}
                  onChange={(event) => setPrune(event.target.checked)}
                />{" "}
                Prune stale remote-tracking references
              </label>
              <p>
                Pruning removes stale tracking refs only. It does not delete
                local branches or branches on the remote.
              </p>
            </>
          )}
          {mode === "pull" && (
            <label>
              Pull strategy
              <select
                value={strategy}
                disabled={disabled}
                onChange={(event) =>
                  setStrategy(event.target.value as PullStrategy)
                }
              >
                <option value="fastForwardOnly">Fast-forward only</option>
                <option value="merge">Merge</option>
                <option value="rebase">Rebase</option>
              </select>
              <p>
                Merge preserves local commits; rebase replays them. Fast-forward
                only refuses divergence. Persistent Git configuration is
                unchanged.
              </p>
            </label>
          )}
          {mode === "force" && review && (
            <div className={styles["push-review"]}>
              <p>
                Local branch: <code>{review.branch}</code>
              </p>
              <p>
                Source commit: <code>{review.localOid}</code>
              </p>
              <p>
                Destination:{" "}
                <code>
                  {review.remote} · {review.remoteRef}
                </code>
              </p>
              <p>
                Expected remote commit: <code>{review.expectedOid}</code>
              </p>
            </div>
          )}
          <Button
            variant={mode === "force" ? "destructive" : "default"}
            disabled={
              disabled ||
              loading ||
              Boolean(error) ||
              (mode === "fetch" && !remote) ||
              (mode === "force" && !review)
            }
            onClick={() => void confirm()}
          >
            {mode === "force"
              ? "Push with reviewed lease"
              : mode === "fetch"
                ? "Fetch"
                : "Pull"}
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => setMode(null)}
          >
            Cancel
          </Button>
        </OperationDialog>
      )}
    </>
  );
}

export function BranchControls({
  branches,
  commit,
  disabled,
  run,
}: {
  branches: Branches;
  commit: string | null;
  disabled: boolean;
  run: RunDelivery;
}) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(false);
  const [local, setLocal] = useState("");
  const [reference, setReference] = useState("");
  const selectedLocal = branches.local.find((branch) => branch.name === local);
  const selectedRemote = branches.remote.find(
    (branch) => branch.fullRef === reference,
  );
  return (
    <details className={styles["delivery-branch-controls"]}>
      <summary>Branch start point and upstream</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            commit &&
            (await run({ kind: "createAt", name, revision: commit, checkout }))
          )
            setName("");
        }}
      >
        <p>
          {commit ? (
            <>
              Selected commit: <code>{commit.slice(0, 12)}</code>
            </>
          ) : (
            "Select a commit in History to create a branch there."
          )}
        </p>
        <label>
          New local branch
          <Input
            value={name}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={checkout}
            disabled={disabled}
            onChange={(event) => setCheckout(event.target.checked)}
          />{" "}
          Check out after creation
        </label>
        <Button type="submit" disabled={disabled || !commit || !name.trim()}>
          Create at selected commit
        </Button>
      </form>
      <label>
        Remote-tracking branch
        <select
          value={reference}
          disabled={disabled}
          onChange={(event) => setReference(event.target.value)}
        >
          <option value="">Choose remote branch</option>
          {branches.remote.map((branch) => (
            <option key={branch.fullRef} value={branch.fullRef}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={disabled || !selectedRemote || !name.trim()}
        onClick={async () => {
          if (await run({ kind: "checkoutRemote", name, reference }))
            setName("");
        }}
      >
        Create & check out tracking branch
      </Button>
      <label>
        Existing local branch
        <select
          value={local}
          disabled={disabled}
          onChange={(event) => setLocal(event.target.value)}
        >
          <option value="">Choose local branch</option>
          {branches.local.map((branch) => (
            <option key={branch.fullRef} value={branch.name}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      {selectedLocal && (
        <p>Current upstream: {selectedLocal.upstream ?? "None"}</p>
      )}
      <Button
        disabled={disabled || !selectedLocal || !selectedRemote}
        onClick={() => void run({ kind: "upstream", name: local, reference })}
      >
        Set upstream
      </Button>
    </details>
  );
}
