import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { OperationDialog } from "@/components/operation-dialog";
import {
  getLfsState,
  getLfsProgress,
  getRemotes,
  reviewLfsPrune,
  normalizeGitError,
} from "@/lib/tauri";
import type { RunDelivery } from "@/types/delivery";
import type { LfsAction, LfsState } from "@/types/lfs";
import styles from "./LfsPanel.module.css";

interface Review {
  action: LfsAction;
  title: string;
  description: string;
}
export function LfsPanel(props: {
  path: string;
  disabled: boolean;
  run: RunDelivery;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        data-command="repository.lfs"
        onClick={() => setOpen(true)}
      >
        LFS
      </Button>
      {open && (
        <LfsManager key={props.path} {...props} close={() => setOpen(false)} />
      )}
    </>
  );
}
function LfsManager({
  path,
  disabled,
  run,
  close,
}: {
  path: string;
  disabled: boolean;
  run: RunDelivery;
  close: () => void;
}) {
  const id = useId();
  const sequence = useRef(0);
  const body = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const [state, setState] = useState<LfsState | null>(null);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [remote, setRemote] = useState("");
  const [directory, setDirectory] = useState("");
  const [pattern, setPattern] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  useEffect(() => {
    if (review && !busy)
      [...(body.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((button) => button.textContent === "Cancel")
        ?.focus();
  }, [review, busy]);
  async function refresh() {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const [next, names] = await Promise.all([
        getLfsState(path),
        getRemotes(path),
      ]);
      if (!alive.current || request !== sequence.current) return;
      setState(next);
      setRemotes(names);
      setRemote((current) =>
        names.includes(current) ? current : (names[0] ?? ""),
      );
    } catch (cause) {
      if (alive.current && request === sequence.current) {
        setState(null);
        setError(normalizeGitError(cause).message);
      }
    } finally {
      if (alive.current && request === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      ++sequence.current;
    };
  }, [path]);
  useEffect(() => {
    if (!busy) return;
    let live = true;
    const poll = async () => {
      try {
        const progress = await getLfsProgress(path);
        if (live && progress.message) setMessage(progress.message);
      } catch {
        /* The operation result still reports transfer failures. */
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, 500);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [busy, path]);
  const blocked = disabled || busy || loading;
  const ready =
    !!state?.available && state.filterConfigured && state.hookInstalled;
  function choose(action: LfsAction, title: string, description: string) {
    if (blocked) return;
    setReview({ action, title, description });
    setError("");
    setMessage("");
  }
  async function prune() {
    if (blocked || !ready || !state?.pruneAllowed) return;
    setBusy(true);
    setError("");
    try {
      const preview = await reviewLfsPrune(path);
      if (alive.current)
        setReview({
          action: { kind: "prune", token: preview.token },
          title: "Prune LFS objects",
          description: `Storage: ${state.storagePath}\n\n${preview.report}\n\nDelete only eligible cached objects after verification by the configured remote adapter. Git LFS retains current, recent, unpushed, stashed and other-worktree objects; reflog entries alone do not retain objects. Worktree files are unchanged. Eligibility will be checked again before deletion.`,
        });
    } catch (cause) {
      if (alive.current) setError(normalizeGitError(cause).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function confirm() {
    if (blocked || !review) return;
    setBusy(true);
    setMessage("Starting Git LFS…");
    try {
      const succeeded = await run({ kind: "lfs", action: review.action });
      if (!alive.current) return;
      setMessage(
        succeeded
          ? "Git LFS operation completed. Repository state refreshed."
          : "Git LFS stopped. Review the Git operation error and refreshed state.",
      );
      if (succeeded) setReview(null);
    } catch (cause) {
      if (alive.current) setError(normalizeGitError(cause).message);
    } finally {
      if (alive.current) {
        await refresh();
        setBusy(false);
      }
    }
  }
  function transfer(kind: "fetch" | "pull" | "push") {
    if (!state?.head || !remote || !ready) return;
    choose(
      { kind, remote, expectedHead: state.head },
      `${kind[0].toUpperCase()}${kind.slice(1)} LFS objects`,
      `Repository: ${path}\nRemote: ${remote}\nCommit: ${state.head}\n\n${kind === "fetch" ? "Download this commit's LFS objects to the local cache without changing worktree files." : kind === "pull" ? "Download this commit's LFS objects and hydrate matching pointer files. Modified files are preserved." : "Upload this commit's LFS objects. Git branch references are not pushed."} Your existing Git credentials, SSH and LFS configuration are used.`,
    );
  }
  return (
    <OperationDialog
      title={review?.title ?? "Git LFS"}
      description={path}
      onClose={close}
      busy={busy}
    >
      <div ref={body} className={styles.body}>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {review ? (
          <>
            <pre className={styles.report}>{review.description}</pre>
            <div className={styles.actions}>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Cancel
              </Button>
              <Button disabled={blocked} onClick={() => void confirm()}>
                Confirm {review.action.kind}
              </Button>
            </div>
          </>
        ) : (
          <>
            {loading && <p role="status">Reading LFS status…</p>}
            {state && (
              <>
                <p>{state.version}</p>
                {!state.available ? (
                  <p>
                    Install Git LFS from{" "}
                    <a
                      href="https://git-lfs.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      the official setup guide
                    </a>
                    , then restart Branchlight so system Git can find it.
                  </p>
                ) : (
                  <>
                    <p>
                      Filters:{" "}
                      {state.filterConfigured ? "configured" : "not configured"}
                      . Pre-push hook:{" "}
                      {state.hookInstalled ? "installed" : "not installed"}.
                    </p>
                    <p className={styles.path}>Hook: {state.hookPath}</p>
                    <Button
                      variant="outline"
                      disabled={blocked}
                      onClick={() =>
                        choose(
                          { kind: "initialize" },
                          "Initialize Git LFS",
                          `Configure LFS filters in this repository's local Git configuration and install the pre-push hook at ${state.hookPath}. Linked worktrees share local configuration. An existing incompatible hook will be preserved and reported as an error; Branchlight does not force replacement.`,
                        )
                      }
                    >
                      Initialize for this repository…
                    </Button>
                    <h3>Tracked patterns</h3>
                    {state.patterns.length ? (
                      <ul>
                        {state.patterns.map((item, index) => (
                          <li key={`${item.source}:${item.pattern}:${index}`}>
                            <code>{item.pattern}</code> — {item.source}
                            {item.lockable ? " (lockable)" : ""}
                            {!item.tracked ? " (excluded)" : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No LFS patterns.</p>
                    )}
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={`${id}-directory`}>
                          Attributes directory (relative; blank for repository
                          root)
                        </FieldLabel>
                        <Input
                          id={`${id}-directory`}
                          value={directory}
                          disabled={blocked}
                          onChange={(event) => setDirectory(event.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`${id}-pattern`}>
                          LFS pattern
                        </FieldLabel>
                        <Input
                          id={`${id}-pattern`}
                          placeholder="*.psd"
                          value={pattern}
                          disabled={blocked}
                          onChange={(event) => setPattern(event.target.value)}
                        />
                      </Field>
                    </FieldGroup>
                    <div className={styles.actions}>
                      {(["track", "untrack"] as const).map((kind) => (
                        <Button
                          key={kind}
                          variant="outline"
                          disabled={blocked || !ready || !pattern.trim()}
                          onClick={() =>
                            choose(
                              { kind, directory, pattern },
                              kind === "track"
                                ? "Track LFS pattern"
                                : "Untrack LFS pattern",
                              `${kind === "track" ? "Add" : "Remove"} pattern ${pattern} in ${directory || "."}/.gitattributes. The attributes change remains visible for review and commit. Existing history is not migrated and existing cached objects are retained.`,
                            )
                          }
                        >
                          {kind === "track" ? "Track…" : "Untrack…"}
                        </Button>
                      ))}
                    </div>
                    <h3>Files at HEAD</h3>
                    {state.files.length ? (
                      <ul>
                        {state.files.map((file) => (
                          <li key={file.name}>
                            <strong>{file.name}</strong> —{" "}
                            {file.checkout ? "full content" : "pointer"};{" "}
                            {file.downloaded ? "cached" : "not cached"};{" "}
                            {file.size} bytes
                            <code className={styles.path}>{file.oid}</code>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No LFS files at HEAD.</p>
                    )}
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={`${id}-remote`}>
                          Configured remote
                        </FieldLabel>
                        <select
                          id={`${id}-remote`}
                          disabled={blocked}
                          value={remote}
                          onChange={(event) => setRemote(event.target.value)}
                        >
                          {!remotes.length && (
                            <option value="">No remotes</option>
                          )}
                          {remotes.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </FieldGroup>
                    <div className={styles.actions}>
                      {(["fetch", "pull", "push"] as const).map((kind) => (
                        <Button
                          key={kind}
                          variant="outline"
                          disabled={blocked || !ready || !state.head || !remote}
                          onClick={() => transfer(kind)}
                        >
                          {kind[0].toUpperCase()}
                          {kind.slice(1)} objects…
                        </Button>
                      ))}
                      <Button
                        variant="outline"
                        disabled={blocked || !ready || !state.head}
                        onClick={() => {
                          if (state.head)
                            choose(
                              { kind: "checkout", expectedHead: state.head },
                              "Checkout cached LFS content",
                              `Commit: ${state.head}\n\nHydrate missing files and matching LFS pointers from the local cache. This does not fetch objects or overwrite modified files.`,
                            );
                        }}
                      >
                        Checkout cached content…
                      </Button>
                    </div>
                    <p>{state.pruneReason}</p>
                    <Button
                      variant="outline"
                      disabled={
                        blocked || !ready || !state.head || !state.pruneAllowed
                      }
                      onClick={() => void prune()}
                    >
                      Preview prune…
                    </Button>
                  </>
                )}
              </>
            )}
            <div className={styles.actions}>
              <Button variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={blocked}
                onClick={() => {
                  setError("");
                  void refresh();
                }}
              >
                Refresh LFS status
              </Button>
            </div>
          </>
        )}
      </div>
    </OperationDialog>
  );
}
