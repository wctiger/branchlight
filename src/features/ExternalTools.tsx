import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OperationDialog } from "@/components/operation-dialog";
import { getLauncherStatus, normalizeGitError } from "@/lib/tauri";
import { readToolPreferences, saveToolPreferences } from "@/lib/external-tools";
import type {
  ExternalTool,
  ToolConfig,
  ToolLaunch,
  ToolRequest,
} from "@/types/external-tools";
import styles from "@/features/ExternalTools.module.css";

const labels: Record<ExternalTool, string> = {
  editor: "Open editor",
  terminal: "Open terminal",
  fileManager: "Reveal in file manager",
  diff: "Open Git diff tool",
  merge: "Open Git merge tool",
};
export function ExternalTools({
  path,
  file,
  kind,
  conflicted,
  disabled,
  launch,
  refresh,
}: {
  path: string;
  file: string | null;
  kind: string | null;
  conflicted: boolean;
  disabled: boolean;
  launch: (request: ToolRequest) => Promise<ToolLaunch | null>;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [settings, setSettings] = useState(false),
    [busy, setBusy] = useState(false);
  const [preferences, setPreferences] = useState(readToolPreferences);
  const [editorArgs, setEditorArgs] = useState(""),
    [terminalArgs, setTerminalArgs] = useState("");
  const [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  async function start(tool: ExternalTool) {
    if (disabled || busy) return;
    setBusy(true);
    setError("");
    const configs = readToolPreferences();
    const config =
      tool === "editor" || tool === "terminal" ? configs[tool] : null;
    try {
      const result = await launch({
        tool,
        filePath: tool === "terminal" ? null : file,
        staged: kind === "staged",
        config: config?.executable ? config : null,
      });
      if (result) {
        setNotice(result.message);
        setJobId(result.jobId);
      } else
        setError(
          "The tool could not launch or finish. Review the Git operation error and verify the installed tool configuration.",
        );
    } finally {
      setBusy(false);
    }
  }
  function editSettings() {
    const current = readToolPreferences();
    setPreferences(current);
    setEditorArgs(JSON.stringify(current.editor.args));
    setTerminalArgs(JSON.stringify(current.terminal.args));
    setSettings(true);
    setError("");
  }
  function parseArgs(text: string): string[] {
    const value: unknown = JSON.parse(text);
    if (
      !Array.isArray(value) ||
      value.length > 64 ||
      !value.every(
        (arg) =>
          typeof arg === "string" && !arg.includes("\0") && arg.length <= 4096,
      )
    )
      throw new Error(
        "Arguments must be a JSON array of up to 64 strings, without NUL characters.",
      );
    return value;
  }
  return (
    <>
      <Button
        data-command="repository.tools"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        External tools…
      </Button>
      {open && (
        <OperationDialog
          title="External tools"
          busy={busy}
          onClose={() => {
            setOpen(false);
            setSettings(false);
            setConfirmMerge(false);
          }}
          description={
            <p>
              Repository: <code>{path}</code>
              {file && (
                <>
                  {" "}
                  · Selected file: <code>{file}</code> ({kind})
                </>
              )}
              . Refresh Git state after external edits. Editor and terminal
              configuration is stored locally.
            </p>
          }
        >
          <div className={styles.actions}>
            {(Object.keys(labels) as ExternalTool[]).map((tool) => (
              <Button
                key={tool}
                variant="outline"
                disabled={
                  disabled ||
                  busy ||
                  ((tool === "diff" || tool === "merge") && !file) ||
                  (tool === "merge" && !conflicted)
                }
                onClick={() =>
                  tool === "merge" ? setConfirmMerge(true) : void start(tool)
                }
              >
                {labels[tool]}
              </Button>
            ))}
          </div>
          <p>
            Diff and merge tools use Git’s existing diff.tool / merge.tool
            configuration. Merge tools may edit and stage the selected conflict;
            Git mutation controls stay busy until the tool returns.
          </p>
          {confirmMerge && (
            <div>
              <p>
                Launch the configured merge tool for <code>{file}</code>? Git
                may mark this file resolved when the tool succeeds.
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmMerge(false)}
              >
                Cancel merge launch
              </Button>
              <Button
                disabled={disabled || busy || !conflicted || !file}
                onClick={async () => {
                  await start("merge");
                  setConfirmMerge(false);
                }}
              >
                Launch merge tool for selected file
              </Button>
            </div>
          )}
          <Button variant="outline" disabled={busy} onClick={editSettings}>
            Configure editor and terminal…
          </Button>
          {settings && (
            <section
              className={styles.settings}
              aria-label="External tool settings"
            >
              <p>
                Use an executable path or PATH command name. Arguments are a
                JSON string array. Placeholders: {"{repository}"}, {"{target}"}{" "}
                (file or repository), and {"{file}"} (requires a file). No shell
                expansion occurs. Without a placeholder, the target is appended.
                Leave the terminal executable empty to use Terminal on macOS or
                Windows Terminal on Windows.
              </p>
              {(["editor", "terminal"] as const).map((tool) => (
                <div key={tool}>
                  <label>
                    {tool === "editor"
                      ? "Editor executable"
                      : "Terminal executable"}
                    <Input
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      value={preferences[tool].executable}
                      onChange={(event) =>
                        setPreferences({
                          ...preferences,
                          [tool]: {
                            ...preferences[tool],
                            executable: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    {tool === "editor"
                      ? "Editor arguments"
                      : "Terminal arguments"}
                    <Input
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      value={tool === "editor" ? editorArgs : terminalArgs}
                      onChange={(event) =>
                        tool === "editor"
                          ? setEditorArgs(event.target.value)
                          : setTerminalArgs(event.target.value)
                      }
                    />
                  </label>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => {
                  try {
                    const editor: ToolConfig = {
                      ...preferences.editor,
                      args: parseArgs(editorArgs),
                    };
                    const terminal: ToolConfig = {
                      ...preferences.terminal,
                      args: parseArgs(terminalArgs),
                    };
                    saveToolPreferences({ editor, terminal });
                    setSettings(false);
                    setNotice("Tool settings saved locally.");
                    setError("");
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Unable to save local tool settings.",
                    );
                  }
                }}
              >
                Save tool settings
              </Button>
            </section>
          )}
          {notice && <p role="status">{notice}</p>}
          {jobId !== null && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                try {
                  const status = await getLauncherStatus(jobId);
                  setNotice(
                    status.running
                      ? "Launcher is still running. You can explicitly refresh after external edits."
                      : status.exitCode === 0
                        ? "Launcher completed successfully. The external application may still be open."
                        : `Launcher exited (${status.exitCode === null ? "terminated by signal" : `exit code ${status.exitCode}`}). Check the configured executable and arguments.`,
                  );
                } catch (error) {
                  setError(normalizeGitError(error).message);
                }
              }}
            >
              Check launcher status
            </Button>
          )}
          {error && <p role="alert">{error}</p>}
          <Button
            variant="outline"
            disabled={disabled || busy}
            onClick={() => void refresh()}
          >
            Refresh after external changes
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setSettings(false);
              setConfirmMerge(false);
            }}
          >
            Close
          </Button>
        </OperationDialog>
      )}
    </>
  );
}
