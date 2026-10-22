import { useEffect, useRef, type KeyboardEvent } from "react";
import { ChevronDown, Ellipsis, FolderGit2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Repository } from "@/types/repository";

export type RepositoryTab = {
  repository: Repository;
  group: string;
  busy: boolean;
  error: boolean;
  dirty: boolean;
};
export function RepositoryTabs({
  tabs,
  active,
  groups,
  onSelect,
  onClose,
  onGroup,
}: {
  tabs: RepositoryTab[];
  active: string;
  groups: string[];
  onSelect: (path: string) => void;
  onClose: (tab: RepositoryTab) => void;
  onGroup: (path: string, group: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);
  const move = (event: KeyboardEvent, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onSelect(tabs[next].repository.path);
    strip.current
      ?.querySelectorAll<HTMLButtonElement>(".repository-tab-select")
      [next]?.focus();
  };
  return (
    <div className="repository-tabs-container">
      <div
        ref={strip}
        className="repository-tab-strip"
        role="group"
        aria-label="Open repositories; use arrow keys to switch"
      >
        {tabs.map((tab, index) => (
          <div
            key={tab.repository.path}
            className={`repository-tab${active === tab.repository.path ? " repository-tab--active" : ""}`}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    className="repository-tab-select"
                    aria-label={`${tab.repository.name}${tab.dirty ? ", uncommitted changes" : ""}${tab.busy ? ", working" : tab.error ? ", error" : ""}`}
                    aria-pressed={active === tab.repository.path}
                    tabIndex={active === tab.repository.path ? 0 : -1}
                    onKeyDown={(event) => move(event, index)}
                    onClick={() => onSelect(tab.repository.path)}
                  />
                }
              >
                <FolderGit2 aria-hidden="true" />
                <span>
                  {tab.group && <small>{tab.group} / </small>}
                  {tab.repository.name}
                </span>
                {(tab.busy || tab.error || tab.dirty) && (
                  <span
                    className={tab.error ? "tab-error" : "tab-status"}
                    aria-hidden="true"
                  >
                    {tab.busy ? "↻" : tab.error ? "!" : "●"}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent>
                {tab.repository.path}
                {tab.group && ` · ${tab.group}`}
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    className="tab-icon"
                    aria-label={`Options for ${tab.repository.name}`}
                  />
                }
              >
                <Ellipsis />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Move to group</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={tab.group}
                    onValueChange={(group) =>
                      onGroup(tab.repository.path, group)
                    }
                  >
                    {["", ...groups].map((group) => (
                      <DropdownMenuRadioItem key={group} value={group}>
                        {group || "Ungrouped"}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              className="tab-icon"
              aria-label={`Close ${tab.repository.name}`}
              disabled={tab.busy}
              onClick={() => onClose(tab)}
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
      {!!tabs.length && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                className="repository-overflow"
                aria-label={`All ${tabs.length} repositories`}
              />
            }
          >
            <ChevronDown />
            <span>{tabs.length}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Open repositories</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {tabs.map((tab) => (
                <DropdownMenuItem
                  key={tab.repository.path}
                  onClick={() => onSelect(tab.repository.path)}
                  aria-current={
                    active === tab.repository.path ? "true" : undefined
                  }
                >
                  <span className="overflow-repo-name">
                    {active === tab.repository.path ? "✓ " : ""}
                    {tab.group && `${tab.group} / `}
                    {tab.repository.name}
                    <small>{tab.repository.path}</small>
                  </span>
                  {tab.busy
                    ? "Working…"
                    : tab.error
                      ? "Error"
                      : tab.dirty
                        ? "●"
                        : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
