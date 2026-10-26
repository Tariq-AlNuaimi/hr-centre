"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MODULES, PERMISSIONS } from "@/lib/rbac/catalogue";
import type { RoleRow } from "./types";

/**
 * Create or edit a role: a name, a description, and actions ticked per module
 * (AC-F3.1). The catalogue comes from code, so a role cannot hold an action no
 * route enforces.
 */
export function RoleDialog({
  open,
  role,
  busy,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  role: RoleRow | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (body: { name: string; description: string; permissions: string[] }) => void;
}) {
  const t = useTranslations("rbac");
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [ticked, setTicked] = useState<Set<string>>(new Set(role?.permissions ?? []));

  function toggle(code: string) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? t("editRole") : t("newRole")}</DialogTitle>
          <DialogDescription>{t("roleHelp")}</DialogDescription>
        </DialogHeader>
        <form
          id="role-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              name: name.trim(),
              description: description.trim(),
              permissions: [...ticked],
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="role-name" className="mb-1 block text-sm font-medium text-foreground">
                {t("roleName")}
              </label>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="role-desc" className="mb-1 block text-sm font-medium text-foreground">
                {t("roleDescription")}
              </label>
              <Input
                id="role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          {MODULES.map((module) => (
            <fieldset key={module} className="rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-foreground">
                {t(`module.${module}`)}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMISSIONS.filter((p) => p.module === module).map((p) => (
                  <label key={p.code} className="flex items-start gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={ticked.has(p.code)}
                      onChange={() => toggle(p.code)}
                    />
                    <span>{t(`permission.${p.code}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="text-xs text-muted-foreground">{t("scopeNote")}</p>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-destructive-emphasis">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form="role-form"
            disabled={busy || !name.trim() || ticked.size === 0}
          >
            {busy ? t("saving") : t("saveRole")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
