"use client";

import { useState } from "react";
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
 * ConfirmAction (ADR-029, Workstream C2 — Radix Dialog rebuild, same prop API).
 * Wraps a trigger (its `children`) in a confirmation step before running a
 * destructive action; the AntD `Popconfirm` replacement. Keeps the same prop
 * surface (title + the Popconfirm callbacks/labels) so existing call sites —
 * `<ConfirmAction title=… onConfirm=…><Button …/></ConfirmAction>` — compile and
 * behave unchanged. The prop surface is now the local AntD-Popconfirm subset
 * these call sites use (title + the confirm callbacks/labels) — no antd import.
 */
interface ConfirmActionProps {
  title?: string;
  description?: React.ReactNode;
  okText?: React.ReactNode;
  cancelText?: React.ReactNode;
  okType?: "primary" | "default" | "dashed" | "link" | "text" | "danger";
  onConfirm?: () => void;
  children: React.ReactNode;
}

export function ConfirmAction({
  title,
  description,
  okText,
  cancelText,
  okType,
  onConfirm,
  children,
}: ConfirmActionProps) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-sm" hideClose>
        <DialogHeader>
          <DialogTitle>{title ?? t("confirm")}</DialogTitle>
        </DialogHeader>
        {description ? (
          <p className="text-sm text-muted-foreground">{description as React.ReactNode}</p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {(cancelText as React.ReactNode) ?? t("no")}
            </Button>
          </DialogClose>
          <Button
            variant={okType === "danger" ? "destructive" : "default"}
            size="sm"
            onClick={() => {
              onConfirm?.();
              setOpen(false);
            }}
          >
            {(okText as React.ReactNode) ?? t("yes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
