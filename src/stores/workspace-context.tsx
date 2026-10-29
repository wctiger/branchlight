import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type {
  createWorkspaceStore,
  WorkspaceState,
} from "@/stores/workspace-store";

export const WorkspaceStoreContext = createContext<ReturnType<
  typeof createWorkspaceStore
> | null>(null);
export function useWorkspaceStore<T>(
  selector: (state: WorkspaceState) => T,
): T {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("Workspace store provider is missing.");
  return useStore(store, selector);
}
