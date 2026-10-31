import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { OperationDialog } from "@/components/operation-dialog";
import { ErrorNotice } from "@/workspace/ErrorNotice";
import {
  getSubmodules,
  openSubmodule,
  reviewSubmoduleAction,
  normalizeGitError,
} from "@/lib/tauri";
import type { GitError } from "@/types/git";
import type { Repository } from "@/types/repository";
import type {
  Submodule,
  SubmoduleAction,
  SubmoduleReview,
} from "@/types/submodules";
import type { RunDelivery } from "@/types/delivery";
import styles from "./SubmodulesPanel.module.css";

interface Props {
  path: string;
  disabled: boolean;
  run: RunDelivery;
  error: GitError | null;
  onOpened: (repository: Repository) => void;
}
export function SubmodulesPanel(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        data-command="repository.submodules"
        onClick={() => setOpen(true)}
      >
        Submodules
      </Button>
      {open && (
        <SubmoduleManager
          key={props.path}
          {...props}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
function SubmoduleManager({
  path,
  disabled,
  run,
  error: operationError,
  onOpened,
  close,
}: Props & { close: () => void }) {
  const id = useId();
  const alive = useRef(true),
    sequence = useRef(0),
    body = useRef<HTMLDivElement>(null);
  const [modules, setModules] = useState<Submodule[]>([]),
    [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<GitError | null>(null),
    [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<"add" | "edit" | null>(null);
  const [destination, setDestination] = useState(""),
    [source, setSource] = useState(""),
    [branch, setBranch] = useState("");
  const [review, setReview] = useState<SubmoduleReview | null>(null);
  const module = modules.find((item) => item.path === selected);
  const blocked = disabled || busy || loading;
  useEffect(() => {
    if (busy) return;
    const content = body.current;
    const target =
      !review && form
        ? content?.querySelector<HTMLInputElement>("input")
        : [
            ...(content?.querySelectorAll<HTMLButtonElement>("button") ?? []),
          ].find((button) => button.textContent === "Cancel");
    target?.focus();
  }, [review, busy, form]);
  async function refresh() {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const result = await getSubmodules(path);
      if (!alive.current || request !== sequence.current) return;
      setModules(result);
      setSelected((current) =>
        result.some((item) => item.path === current)
          ? current
          : (result[0]?.path ?? ""),
      );
    } catch (cause) {
      if (alive.current && request === sequence.current) {
        setModules([]);
        setError(normalizeGitError(cause));
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
  async function prepare(action: SubmoduleAction) {
    if (blocked) return;
    setBusy(true);
    setError(null);
    setFailed(false);
    setNotice("");
    try {
      const next = await reviewSubmoduleAction(path, action);
      if (alive.current) setReview(next);
    } catch (cause) {
      if (alive.current) setError(normalizeGitError(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function confirm() {
    if (blocked || !review) return;
    setBusy(true);
    setError(null);
    setFailed(false);
    try {
      const success = await run({ kind: "submodule", review });
      if (!alive.current) return;
      if (success) {
        setReview(null);
        setForm(null);
        setNotice(
          "Submodule operation completed. Parent and open child repository views refreshed.",
        );
      } else setFailed(true);
    } catch (cause) {
      if (alive.current) setError(normalizeGitError(cause));
    } finally {
      if (alive.current) {
        await refresh();
        setBusy(false);
      }
    }
  }
  async function open() {
    if (blocked || !module?.initialized) return;
    setBusy(true);
    setError(null);
    try {
      const repository = await openSubmodule(path, module.path);
      if (alive.current) {
        onOpened(repository);
        close();
      }
    } catch (cause) {
      if (alive.current) setError(normalizeGitError(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function edit() {
    if (!module || blocked) return;
    setSource("");
    setBranch(module.branch ?? "");
    setForm("edit");
    setError(null);
    setFailed(false);
  }
  return (
    <OperationDialog
      title={review ? `Review submodule ${review.action.kind}` : "Submodules"}
      description={path}
      onClose={close}
      busy={busy}
    >
      <div ref={body} className={styles.body}>
        {error && (
          <ErrorNotice
            error={error}
            title="Submodule operation could not finish"
          />
        )}
        {failed &&
          (operationError ? (
            <ErrorNotice
              error={operationError}
              title="Submodule operation could not finish"
            />
          ) : (
            <p role="alert">
              Git could not complete the operation. Review the refreshed state
              before retrying.
            </p>
          ))}
        {notice && <p role="status">{notice}</p>}
        {busy && <p role="status">Working with system Git…</p>}
        {review ? (
          <>
            <dl className={styles.details}>
              <dt>Path</dt>
              <dd>{review.path}</dd>
              <dt>Parent HEAD</dt>
              <dd>{review.parentHead ?? "Unborn branch"}</dd>
              <dt>Expected revision</dt>
              <dd>{review.expectedOid ?? "Unavailable"}</dd>
              <dt>Checked-out revision</dt>
              <dd>{review.currentOid ?? "Not initialized"}</dd>
              {review.action.kind === "add" && (
                <>
                  <dt>Source</dt>
                  <dd>{review.action.source}</dd>
                </>
              )}
              {review.action.kind === "edit" && (
                <>
                  <dt>New URL</dt>
                  <dd>{review.action.url}</dd>
                  <dt>Tracking branch</dt>
                  <dd>{review.action.branch ?? "Remote default"}</dd>
                </>
              )}
            </dl>
            <p>{review.effects}</p>
            <p>
              Git rechecks the reviewed parent/submodule state before applying
              this action.
            </p>
            <div className={styles.actions}>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setReview(null);
                  setFailed(false);
                }}
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
            {loading && <p role="status">Reading submodules…</p>}
            {!loading && !modules.length && !error && (
              <p>No configured submodules.</p>
            )}
            {!!modules.length && (
              <>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`${id}-selected`}>
                      Configured submodule
                    </FieldLabel>
                    <select
                      id={`${id}-selected`}
                      value={selected}
                      disabled={blocked}
                      onChange={(event) => {
                        setSelected(event.target.value);
                        setForm(null);
                        setError(null);
                        setFailed(false);
                      }}
                    >
                      {modules.map((item) => (
                        <option key={item.path} value={item.path}>
                          {item.path} ·{" "}
                          {item.initialized
                            ? item.dirty
                              ? "dirty"
                              : "initialized"
                            : "not initialized"}
                        </option>
                      ))}
                    </select>
                  </Field>
                </FieldGroup>
                {module && (
                  <>
                    <dl className={styles.details}>
                      <dt>Path</dt>
                      <dd>{module.path}</dd>
                      <dt>State</dt>
                      <dd>
                        {module.initialized
                          ? module.dirty
                            ? "Initialized · dirty"
                            : "Initialized · clean"
                          : "Not initialized"}
                      </dd>
                      <dt>Expected revision (parent index)</dt>
                      <dd>{module.expectedOid ?? "Unavailable / unmerged"}</dd>
                      <dt>Checked-out revision</dt>
                      <dd>{module.currentOid ?? "Not checked out"}</dd>
                      <dt>URL</dt>
                      <dd>{module.url ?? "Not configured"}</dd>
                      <dt>Tracking branch</dt>
                      <dd>{module.branch ?? "Remote default"}</dd>
                    </dl>
                    {module.error && <p role="alert">{module.error}</p>}
                    <div className={styles.actions}>
                      <Button
                        variant="outline"
                        disabled={blocked || !module.initialized}
                        onClick={() => void open()}
                      >
                        Open repository
                      </Button>
                      <Button
                        variant="outline"
                        disabled={blocked || !!module.error}
                        onClick={edit}
                      >
                        Edit configuration…
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          blocked || !!module.error || !module.expectedOid
                        }
                        onClick={() =>
                          void prepare({
                            kind: module.initialized ? "update" : "initialize",
                            path: module.path,
                          })
                        }
                      >
                        {module.initialized
                          ? "Update to expected revision…"
                          : "Initialize…"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          blocked || !module.initialized || !!module.error
                        }
                        onClick={() =>
                          void prepare({ kind: "reset", path: module.path })
                        }
                      >
                        Reset submodule…
                      </Button>
                      <Button
                        variant="outline"
                        disabled={blocked || !!module.error}
                        onClick={() =>
                          void prepare({ kind: "remove", path: module.path })
                        }
                      >
                        Remove submodule…
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
            {form ? (
              <>
                <FieldGroup>
                  {form === "add" && (
                    <Field>
                      <FieldLabel htmlFor={`${id}-path`}>
                        New submodule path (relative)
                      </FieldLabel>
                      <Input
                        id={`${id}-path`}
                        value={destination}
                        disabled={blocked}
                        onChange={(event) => setDestination(event.target.value)}
                      />
                    </Field>
                  )}
                  <Field>
                    <FieldLabel htmlFor={`${id}-url`}>
                      {form === "add"
                        ? "Source URL"
                        : "New submodule URL"}
                    </FieldLabel>
                    <Input
                      id={`${id}-url`}
                      value={source}
                      disabled={blocked}
                      onChange={(event) => setSource(event.target.value)}
                    />
                  </Field>
                  {form === "edit" && (
                    <Field>
                      <FieldLabel htmlFor={`${id}-branch`}>
                        Tracking branch (blank for remote default)
                      </FieldLabel>
                      <Input
                        id={`${id}-branch`}
                        value={branch}
                        disabled={blocked}
                        onChange={(event) => setBranch(event.target.value)}
                      />
                    </Field>
                  )}
                </FieldGroup>
                <p>
                  {form === "add"
                    ? "Review reads the source's default HEAD before reserving a new destination. Existing paths are not overwritten."
                    : "Enter the URL explicitly. Existing local Git credentials and transport policies are used. Editing configuration does not update checked-out files."}
                </p>
                <div className={styles.actions}>
                  <Button
                    variant="outline"
                    disabled={blocked}
                    onClick={() => setForm(null)}
                  >
                    Cancel editing
                  </Button>
                  <Button
                    disabled={
                      blocked ||
                      !source.trim() ||
                      (form === "add" ? !destination.trim() : !module)
                    }
                    onClick={() =>
                      void prepare(
                        form === "add"
                          ? {
                              kind: "add",
                              path: destination.trim(),
                              source: source.trim(),
                            }
                          : {
                              kind: "edit",
                              path: module!.path,
                              url: source.trim(),
                              branch: branch.trim() || null,
                            },
                      )
                    }
                  >
                    Review {form}
                  </Button>
                </div>
              </>
            ) : (
              <Button
                variant="outline"
                disabled={blocked}
                onClick={() => {
                  setForm("add");
                  setDestination("");
                  setSource("");
                  setError(null);
                  setFailed(false);
                }}
              >
                Add submodule…
              </Button>
            )}
            <div className={styles.actions}>
              <Button variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={blocked}
                onClick={() => {
                  setError(null);
                  setFailed(false);
                  void refresh();
                }}
              >
                Refresh submodules
              </Button>
            </div>
          </>
        )}
      </div>
    </OperationDialog>
  );
}
