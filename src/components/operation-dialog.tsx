import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          const content = event.currentTarget as HTMLElement;
          const cancel = [
            ...content.querySelectorAll<HTMLButtonElement>("button"),
          ].find((button) => button.textContent?.trim() === "Cancel");
          if (cancel) {
            event.preventDefault();
            cancel.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnTarget?.isConnected) returnTarget.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        <div className="operation-dialog-actions">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
