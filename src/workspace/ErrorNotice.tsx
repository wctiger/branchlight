import { Alert } from "@/components/ui/alert";
import type { GitError } from "@/types/git";

/** Presents a structured Git error and any captured command output. */
export function ErrorNotice({
  error,
  title = "That folder couldn’t be opened",
}: {
  error: GitError;
  title?: string;
}) {
  const details =
    error.output?.stderr.trim() || error.output?.stdout.trim() || undefined;

  return (
    <Alert variant="destructive" className="error-notice">
      <span className="error-notice__icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{title}</strong>
        <p>{error.message}</p>
        {details && <pre>{details}</pre>}
      </div>
    </Alert>
  );
}
