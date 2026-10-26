"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * One case action behind a dialog: the fields it needs, a confirm button, and
 * the dialog closes only when the action succeeded (the server's refusal stays
 * on screen as a toast and the form keeps what was typed).
 */
export function ActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  disabled = false,
  busy = false,
  onConfirm,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** Return true when the action succeeded. */
  onConfirm: () => Promise<boolean>;
  children?: ReactNode;
}) {
  const t = useTranslations("jml.common");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        {children ? <div className="space-y-3">{children}</div> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            variant={destructive ? "destructive" : "default"}
            disabled={disabled || busy}
            onClick={async () => {
              if (await onConfirm()) setOpen(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
