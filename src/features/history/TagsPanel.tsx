import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OperationDialog } from "@/components/operation-dialog";
import {
  getLocalTags,
  inspectLocalTag,
  normalizeGitError,
  type LocalTag,
  type TagDetails,
} from "@/lib/tauri";
import type { RunDelivery } from "@/types/delivery";
import styles from "@/features/history/TagsPanel.module.css";

export function TagsPanel({
  path,
  revision,
  disabled,
  refreshKey,
  run,
  onInspectCommit,
}: {
  path: string;
  revision: string | null;
  disabled: boolean;
  refreshKey: unknown;
  run: RunDelivery;
  onInspectCommit: (hash: string) => void;
}) {
  const [tags, setTags] = useState<LocalTag[]>([]);
  const [selected, setSelected] = useState<TagDetails | null>(null);
  const [deleteReview, setDeleteReview] = useState<TagDetails | null>(null);
  const [dialog, setDialog] = useState<"create" | "delete" | null>(null);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [annotated, setAnnotated] = useState(false);
  const [annotation, setAnnotation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0),
    detailsRequest = useRef(0);
  async function reload() {
    const id = ++sequence.current;
    detailsRequest.current++;
    setSelected(null);
    setLoading(true);
    setError("");
    try {
      const result = await getLocalTags(path);
      if (id === sequence.current) setTags(result);
    } catch (error) {
      if (id === sequence.current) setError(normalizeGitError(error).message);
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    return () => {
      sequence.current++;
      detailsRequest.current++;
    };
  }, [path, refreshKey]);
  return (
    <section className={styles.panel} aria-label="Local tags">
      <h3>Local tags</h3>
      <p>Local refs only. No remote tag administration.</p>
      <Button
        size="sm"
        variant="outline"
        data-command="tag.create"
        disabled={disabled || busy || !revision}
        onClick={() => {
          setTarget(revision!);
          setName("");
          setAnnotation("");
          setAnnotated(false);
          setDialog("create");
          setError("");
        }}
      >
        Create tag at selected commit…
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy || loading}
        onClick={() => void reload()}
      >
        Refresh tags
      </Button>
      {loading && <p role="status">Reading local tags…</p>}
      {!loading && tags.length === 0 && <p>No local tags.</p>}
      <ul className={styles.list} aria-label="Tag names">
        {tags.map((tag) => (
          <li key={tag.name}>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-pressed={selected?.name === tag.name}
              onClick={async () => {
                const id = ++detailsRequest.current;
                setSelected(null);
                setError("");
                try {
                  const result = await inspectLocalTag(path, tag.name);
                  if (id === detailsRequest.current) setSelected(result);
                } catch (error) {
                  if (id === detailsRequest.current)
                    setError(normalizeGitError(error).message);
                }
              }}
            >
              {tag.name}
            </Button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className={styles.metadata}>
          <strong>{selected.name}</strong>
          <p>
            {selected.annotated ? "Annotated tag" : "Lightweight tag"} · target{" "}
            {selected.targetType}
          </p>
          <code>{selected.targetId}</code>
          <pre>{selected.metadata || "No annotation metadata available."}</pre>
          {selected.metadataTruncated && (
            <p>Metadata preview is limited to 512 KiB.</p>
          )}
          {selected.targetType === "commit" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onInspectCommit(selected.targetId)}
            >
              Inspect tagged commit
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            data-command="tag.delete"
            disabled={disabled || busy}
            onClick={() => {
              setDeleteReview(selected);
              setDialog("delete");
              setError("");
            }}
          >
            Delete local tag…
          </Button>
        </div>
      )}
      {error && !dialog && <p role="alert">{error}</p>}
      {dialog && (
        <OperationDialog
          title={dialog === "create" ? "Create local tag" : "Delete local tag?"}
          busy={busy}
          onClose={() => setDialog(null)}
          description={
            dialog === "create" ? (
              <p>
                Create an unsigned {annotated ? "annotated" : "lightweight"} tag
                at commit <code>{target}</code>. Existing tags are never
                overwritten.
              </p>
            ) : (
              <p>
                Delete local tag <strong>{deleteReview?.name}</strong>{" "}
                referencing object <code>{deleteReview?.objectId}</code>. The
                commit and any remote tag remain available.
              </p>
            )
          }
        >
          {dialog === "create" && (
            <>
              <label>
                Tag name
                <Input
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={annotated}
                  disabled={busy}
                  onChange={(event) => setAnnotated(event.target.checked)}
                />
                Annotated tag
              </label>
              {annotated && (
                <label>
                  Tag annotation
                  <textarea
                    value={annotation}
                    disabled={busy}
                    onChange={(event) => setAnnotation(event.target.value)}
                  />
                </label>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setDialog(null)}
          >
            Cancel
          </Button>
          <Button
            variant={dialog === "delete" ? "destructive" : "default"}
            disabled={
              disabled ||
              busy ||
              (dialog === "create"
                ? !name.trim() || (annotated && !annotation.trim())
                : !deleteReview)
            }
            onClick={async () => {
              const action =
                dialog === "create"
                  ? {
                      kind: "createTag" as const,
                      name,
                      revision: target,
                      annotation: annotated ? annotation : null,
                    }
                  : deleteReview
                    ? {
                        kind: "deleteTag" as const,
                        name: deleteReview.name,
                        expectedOid: deleteReview.objectId,
                      }
                    : null;
              if (!action) return;
              setBusy(true);
              try {
                const ok = await run(action);
                await reload();
                if (ok) setDialog(null);
                else
                  setError(
                    "Git could not complete the tag operation. Review the Git error in the branch panel and the refreshed tag list.",
                  );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Running…"
              : dialog === "create"
                ? "Create local tag"
                : "Delete reviewed local tag"}
          </Button>
        </OperationDialog>
      )}
    </section>
  );
}
