import { useRef, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Shared modal shell; each caller retains its existing mutation guards and actions. */
export function OperationDialog({
  title,
  description,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const [returnTarget] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (busy) details.cancel();
        else if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        ref={contentRef}
        initialFocus={() => {
          const cancel = [
            ...contentRef.current!.querySelectorAll<HTMLButtonElement>(
              "button",
            ),
          ].find((button) => button.textContent?.trim() === "Cancel");
          return cancel ?? true;
        }}
        finalFocus={() => (returnTarget?.isConnected ? returnTarget : false)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription render={<div />}>{description}</DialogDescription>
        </DialogHeader>
        <div className="operation-dialog-actions">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
