import { useWorkspaceStore } from "@/stores/workspace-context";
import { useEffect, useState } from "react";
import { RepositoryScreen } from "@/workspace/RepositoryScreen";
import { createRepositoryStore } from "@/stores/repository-store";
import { RepositoryStoreContext } from "@/stores/repository-context";
import type { Repository } from "@/types/repository";

/** Keeps each repository store alive while its tab is open, including hidden tabs. */
export function RepositoryApp({
  initialRepository,
}: {
  initialRepository: Repository;
}) {
  const onOpen = useWorkspaceStore((state) => state.open);
  const onFeedback = useWorkspaceStore((state) => state.feedback);
  const [store] = useState(() =>
    createRepositoryStore(initialRepository, onOpen),
  );
  useEffect(() => {
    const report = () => {
      const state = store.getState();
      const status =
        state.statusState.state === "ready" ? state.statusState.status : null;
      const snapshots = [
        state.statusState,
        state.branchesState,
        state.stashesState,
        state.historyState,
      ];
      onFeedback(
        initialRepository.path,
        state.operation.state !== "idle",
        Boolean(
          state.changeOperationError ||
          state.branchOperationError ||
          state.remoteOperationError ||
          state.stashOperationError ||
          state.conflictOperationError ||
          snapshots.some(
            (snapshot) =>
              snapshot.state === "error" ||
              (snapshot.state === "ready" && snapshot.refreshError),
          ),
        ),
        Boolean(
          status &&
          (status.staged.length ||
            status.unstaged.length ||
            status.conflicts.length),
        ),
        status ? (status.branch.name ?? "Detached HEAD") : undefined,
      );
    };
    const unsubscribe = store.subscribe(report);
    store.getState().onRefresh();
    return unsubscribe;
  }, [store, initialRepository.path, onFeedback]);
  return (
    <RepositoryStoreContext value={store}>
      <RepositoryScreen />
    </RepositoryStoreContext>
  );
}
