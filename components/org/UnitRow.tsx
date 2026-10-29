"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmAction } from "@/components/shared/ConfirmAction";

/**
 * One org unit in a list: its name and meta, an inline rename, optional extra
 * controls (move), and retire behind a confirmation. The server decides whether
 * a retire is allowed (AC-F1.3) and its refusal is what the toast shows.
 */
export function UnitRow({
  name,
  meta,
  badge,
  head,
  extra,
  busy,
  onRename,
  onRetire,
}: {
  name: string;
  meta?: ReactNode;
  badge?: ReactNode;
  /** The unit's head control (overnight item 2). */
  head?: ReactNode;
  extra?: ReactNode;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onRetire?: () => void;
}) {
  const t = useTranslations("org");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border py-2 text-sm last:border-b-0">
      {badge}
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onRename(draft.trim())) setEditing(false);
          }}
        >
          <Input
            aria-label={t("rename")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-56"
          />
          <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
            {t("save")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t("cancel")}
          </Button>
        </form>
      ) : (
        <span className="font-medium text-foreground">{name}</span>
      )}
      {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
      <span className="ms-auto flex flex-wrap items-center gap-2">
        {head}
        {extra}
        {!editing ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
          >
            {t("rename")}
          </Button>
        ) : null}
        {onRetire ? (
          <ConfirmAction
            title={t("retireTitle", { name })}
            description={t("retireDescription")}
            okText={t("retire")}
            okType="danger"
            onConfirm={onRetire}
          >
            <Button size="sm" variant="ghost" disabled={busy}>
              {t("retire")}
            </Button>
          </ConfirmAction>
        ) : null}
      </span>
    </li>
  );
}
