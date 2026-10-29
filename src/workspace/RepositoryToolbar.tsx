import { FolderOpen, RefreshCw, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RemoteControls } from "@/features/DeliveryControls";
import { BranchSummary } from "@/workspace/BranchSummary";
import { BranchlightMark } from "@/workspace/icons";
import type { OpenState, RepositoryStatusState } from "@/workspace/types";
import type { RunDelivery } from "@/types/delivery";
import type { Repository } from "@/types/repository";
import type { RepositoryStatus } from "@/types/status";

export function RepositoryToolbar({
  repository,
  status,
  statusState,
  isRefreshing,
  isMutating,
  hasActiveRepositoryOperation,
  openState,
  onDelivery,
  onStash,
  onRefresh,
  onOpenRepository,
}: {
  repository: Repository;
  status: RepositoryStatus | null;
  statusState: RepositoryStatusState;
  isRefreshing: boolean;
  isMutating: boolean;
  hasActiveRepositoryOperation: boolean;
  openState: OpenState;
  onDelivery: RunDelivery;
  onStash: () => void;
  onRefresh: () => void;
  onOpenRepository: () => void;
}) {
  return (
    <header className="repository-bar">
      <div className="repository-brand">
        <BranchlightMark />
        <div className="repository-identity">
          <h1>{repository.name}</h1>
          <span title={repository.path}>{repository.path}</span>
        </div>
      </div>

      <div className="repository-branch" aria-live="polite">
        {status ? (
          <BranchSummary branch={status.branch} />
        ) : (
          <div className="branch-summary branch-summary--loading">
            <span className="status-dot status-dot--checking" />
            <div className="branch-summary__identity">
              <strong>
                {statusState.state === "error"
                  ? "Status unavailable"
                  : "Reading branch…"}
              </strong>
              <span>System Git</span>
            </div>
          </div>
        )}
      </div>

      <div className="repository-actions">
        <RemoteControls
          path={repository.path}
          disabled={
            isRefreshing ||
            isMutating ||
            hasActiveRepositoryOperation ||
            openState !== "idle"
          }
          run={onDelivery}
        />
        <Button
          variant="outline"
          className="secondary-button"
          type="button"
          disabled={
            !status ||
            isRefreshing ||
            isMutating ||
            hasActiveRepositoryOperation ||
            openState !== "idle"
          }
          onClick={onStash}
        >
          Stash
        </Button>
        <Button
          variant="outline"
          className="secondary-button"
          type="button"
          disabled={isRefreshing || isMutating || openState !== "idle"}
          aria-busy={isRefreshing}
          onClick={onRefresh}
        >
          {isRefreshing ? (
            <LoaderCircle
              className="small-spinner"
              aria-hidden="true"
              data-icon="inline-start"
            />
          ) : (
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
          )}
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </Button>
        <Button
          variant="outline"
          className="secondary-button"
          type="button"
          disabled={isMutating || openState !== "idle"}
          aria-busy={openState !== "idle"}
          onClick={onOpenRepository}
        >
          <FolderOpen aria-hidden="true" data-icon="inline-start" />
          {openState === "idle" ? "Open another" : "Opening…"}
        </Button>
      </div>
    </header>
  );
}
