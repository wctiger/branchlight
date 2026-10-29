import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type {
  createRepositoryStore,
  RepositoryState,
} from "@/stores/repository-store";

export type RepositoryStore = ReturnType<typeof createRepositoryStore>;
export const RepositoryStoreContext = createContext<RepositoryStore | null>(
  null,
);
export function useRepositoryStore<T>(
  selector: (state: RepositoryState) => T,
): T {
  const store = useContext(RepositoryStoreContext);
  if (!store) throw new Error("Repository store provider is missing.");
  return useStore(store, selector);
}
