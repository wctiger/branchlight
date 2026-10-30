import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { File, Virtualizer } from "@pierre/diffs/react";
import { Button } from "@/components/ui/button";
import { OperationDialog } from "@/components/operation-dialog";
import {
  getConflictFile,
  normalizeGitError,
  type ConflictFile,
} from "@/lib/tauri";
import { DiffRenderBoundary } from "@/features/inspection/DiffRenderBoundary";
import {
  tokenStyles,
  themes,
  themeSnapshot,
  subscribeTheme,
} from "@/features/inspection/diff-theme";
import styles from "@/features/inspection/ConflictResolver.module.css";

export default function ConflictResolver({
  path,
  filePath,
  disabled,
  onSave,
}: {
  path: string;
  filePath: string;
  disabled: boolean;
  onSave: (
    snapshot: ConflictFile,
    output: string,
    markResolved: boolean,
  ) => Promise<boolean>;
}) {
  const [snapshot, setSnapshot] = useState<ConflictFile | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadConfirmation, setReloadConfirmation] = useState(false);
  const request = useRef(0);
  const theme = useSyncExternalStore(
    subscribeTheme,
    themeSnapshot,
    () => "light" as const,
  );
  const options = useMemo(
    () => ({ theme: themes, themeType: theme, unsafeCSS: tokenStyles }),
    [theme],
  );
  const sides = useMemo(
    () =>
      snapshot
        ? [
            {
              label: "Base · common ancestor",
              file: { name: filePath, contents: snapshot.base },
            },
            {
              label:
                snapshot.operation === "rebase"
                  ? "Current · rebased branch (ours)"
                  : "Current · index stage 2 (ours)",
              file: { name: filePath, contents: snapshot.current },
            },
            {
              label:
                snapshot.operation === "rebase"
                  ? "Incoming · commit being replayed (theirs)"
                  : "Incoming · index stage 3 (theirs)",
              file: { name: filePath, contents: snapshot.incoming },
            },
          ]
        : [],
    [snapshot, filePath],
  );
  async function reload() {
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      const result = await getConflictFile(path, filePath);
      if (id === request.current) {
        setSnapshot(result);
        setDraft(result.output);
      }
    } catch (error) {
      if (id === request.current) setError(normalizeGitError(error).message);
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    void reload();
    return () => {
      request.current++;
    };
  }, [path, filePath]);
  async function save(markResolved: boolean) {
    if (!snapshot || busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      if (await onSave(snapshot, draft, markResolved)) {
        if (!markResolved) await reload();
      } else
        setError(
          "Unable to save or stage this resolution. Your draft is retained. Review the Git error in the operation banner; reload if the file changed externally.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Three-way conflict resolution"
      className={styles.resolver}
    >
      <h3>Resolve {filePath}</h3>
      {snapshot && (
        <p>
          Active operation: {snapshot.operation}. Inspect the three index
          versions, edit the output, then explicitly mark the file resolved.
          This does not finish the Git operation.
        </p>
      )}
      {busy && <p role="status">Reading or saving conflict…</p>}
      {error && (
        <p role="alert">
          {error} Unsupported conflicts remain unresolved; use an external Git
          tool and refresh status.
        </p>
      )}
      {snapshot && (
        <>
          <div className={styles.sides}>
            {sides.map((side) => (
              <section key={side.label} aria-label={side.label}>
                <h4>{side.label}</h4>
                <DiffRenderBoundary text={side.file.contents}>
                  <Virtualizer className={styles.viewport}>
                    <File file={side.file} options={options} />
                  </Virtualizer>
                </DiffRenderBoundary>
              </section>
            ))}
          </div>
          <div className={styles.actions}>
            <Button
              variant="outline"
              disabled={disabled || busy}
              onClick={() => setDraft(snapshot.current)}
            >
              Use current as output
            </Button>
            <Button
              variant="outline"
              disabled={disabled || busy}
              onClick={() => setDraft(snapshot.incoming)}
            >
              Use incoming as output
            </Button>
          </div>
          <label>
            Resolution output
            <textarea
              className={styles.output}
              aria-label="Resolution output"
              value={draft}
              disabled={disabled || busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <Button
              variant="outline"
              disabled={disabled || busy}
              onClick={() => void save(false)}
              data-command="conflict.draft"
            >
              Save draft
            </Button>
            <Button data-command="conflict.resolve" disabled={disabled || busy} onClick={() => void save(true)}>
              Save and mark resolved
            </Button>
          </div>
        </>
      )}
      <Button
        data-command="conflict.reload"
        variant="outline"
        disabled={disabled || busy}
        onClick={() => {
          if (snapshot && draft !== snapshot.output)
            setReloadConfirmation(true);
          else void reload();
        }}
      >
        Reload conflict versions
      </Button>
      {reloadConfirmation && (
        <OperationDialog
          title="Discard unsaved resolution edits?"
          description="Reloading replaces your draft with the current working file and rereads the conflict stages."
          onClose={() => setReloadConfirmation(false)}
        >
          <Button
            variant="outline"
            onClick={() => setReloadConfirmation(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              setReloadConfirmation(false);
              void reload();
            }}
          >
            Discard draft and reload
          </Button>
        </OperationDialog>
      )}
    </section>
  );
}
