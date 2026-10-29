import { useEffect, useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OperationDialog } from "@/components/operation-dialog";
import { ErrorNotice } from "@/workspace/ErrorNotice";
import {
  getDiagnostics,
  normalizeGitError,
  type Diagnostics,
} from "@/lib/tauri";
import type { GitError } from "@/types/git";
import styles from "@/features/DeliveryControls.module.css";

export function DiagnosticsPanel({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let stale = false;
    setData(null);
    setError(null);
    getDiagnostics(path)
      .then((result) => {
        if (!stale) setData(result);
      })
      .catch((failure) => {
        if (!stale) setError(normalizeGitError(failure));
      });
    return () => {
      stale = true;
    };
  }, [path, open, revision]);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Bug data-icon="inline-start" aria-hidden="true" />
        Diagnostics
      </Button>
      {open && (
        <OperationDialog
          title="Git diagnostics"
          description="Recent operation names, results, and timing for this repository. The last 200 operations across repositories are retained in memory for this app session. Arguments and command output are omitted to avoid retaining secrets; command errors appear in the repository view."
          onClose={() => setOpen(false)}
        >
          {error && <ErrorNotice error={error} />}
          {!data && !error && <p role="status">Reading diagnostics…</p>}
          {data && (
            <div className={styles["diagnostics"]}>
              <p>{data.version}</p>
              <p>
                Git on PATH (candidate):{" "}
                <code>{data.pathCandidate ?? "Not found"}</code>
              </p>
              <p>
                Git is launched by name. The operating system may select a
                different executable.
              </p>
              {!data.logs.length && (
                <p>No operations recorded in this session.</p>
              )}
              <ol>
                {data.logs.map((entry, index) => (
                  <li key={index}>
                    <time>
                      {new Date(entry.timestamp * 1000).toLocaleTimeString()}
                    </time>{" "}
                    · git {entry.command} ·{" "}
                    {entry.exitCode === 0
                      ? "Succeeded"
                      : `Failed (${entry.exitCode ?? "signal"})`}{" "}
                    · {entry.durationMs} ms
                  </li>
                ))}
              </ol>
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh logs
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </OperationDialog>
      )}
    </>
  );
}
