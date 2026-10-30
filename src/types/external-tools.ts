export type ExternalTool =
  "editor" | "terminal" | "fileManager" | "diff" | "merge";
export interface ToolConfig {
  executable: string;
  args: string[];
}
export interface ToolRequest {
  tool: ExternalTool;
  filePath: string | null;
  staged: boolean;
  config: ToolConfig | null;
}
export interface ToolLaunch {
  jobId: number | null;
  message: string;
}
export interface LauncherStatus {
  running: boolean;
  exitCode: number | null;
}
export type ToolPreferences = { editor: ToolConfig; terminal: ToolConfig };
