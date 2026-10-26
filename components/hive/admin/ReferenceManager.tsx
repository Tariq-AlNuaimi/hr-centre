"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/org/NativeSelect";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

/**
 * One reference-data list with add / edit / remove (HR tickets setup, US-H9).
 * Config-driven so pairs, members, coverage, rotation, discounts and providers
 * share one well-tested editor instead of seven hand-rolled ones. The server
 * validates everything (`lib/validations/hive/reference.ts`); this only shows
 * its sentence when a save is refused.
 */

export type Option = { value: string; label: string };

export type FieldDef = {
  key: string;
  /** Key under `hive.setup.field`. */
  label: string;
  kind: "text" | "textarea" | "number" | "checkbox" | "select" | "date" | "list";
  options?: Option[];
  /** Hint key under `hive.setup.hint`. */
  hint?: string;
};

export type Row = { id: string } & Record<string, unknown>;

export function ReferenceManager({
  resource,
  title,
  description,
  fields,
  columns,
  defaults,
  filter,
  rows: givenRows,
  external = false,
  onChanged,
}: {
  resource: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  /** Columns shown in the list: a field key and a renderer. */
  columns: Array<{ label: string; render: (row: Row) => React.ReactNode }>;
  defaults: Record<string, unknown>;
  /** Show only some rows (e.g. one pair's members). */
  filter?: (row: Row) => boolean;
  /** Rows supplied by the parent (when it already loaded them). */
  rows?: Row[];
  /** The parent owns loading: never query, and `rows` undefined means loading. */
  external?: boolean;
  onChanged?: () => void;
}) {
  const t = useTranslations("hive.setup");
  const { success, error: notifyError } = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const endpoint = `/api/hive/admin/ref/${resource}`;

  const query = useQuery({
    queryKey: ["hive-ref", resource],
    queryFn: () => apiClient.get<Row[]>(endpoint),
    enabled: !external,
  });
  const all = (external ? givenRows : query.data) ?? [];
  const rows = filter ? all.filter(filter) : all;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["hive-ref"] });
    onChanged?.();
  }

  async function remove(row: Row) {
    try {
      await apiClient.delete(`${endpoint}/${row.id}`);
      success(t("removed"));
      await refresh();
    } catch (e) {
      notifyError(e instanceof ApiError ? e.message : t("saveFailed"));
    }
  }

  return (
    <SectionCard
      title={title}
      subtitle={description}
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          {t("add")}
        </Button>
      }
    >
      {(external ? givenRows === undefined : query.isLoading) ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : !external && query.isError ? (
        <p role="alert" className="text-sm text-destructive-emphasis">
          {t("loadFailed")}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState description={t("empty")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                {columns.map((c) => (
                  <th key={c.label} className="px-2 py-2 text-start font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-b-0 align-top">
                  {columns.map((c) => (
                    <td key={c.label} className="px-2 py-2">
                      {c.render(row)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-2 text-end">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                      {t("edit")}
                    </Button>
                    <ConfirmAction
                      title={t("removeTitle")}
                      description={t("removeDescription")}
                      okText={t("remove")}
                      okType="danger"
                      onConfirm={() => void remove(row)}
                    >
                      <Button size="sm" variant="ghost">
                        {t("remove")}
                      </Button>
                    </ConfirmAction>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? (
        <RowDialog
          key={editing === "new" ? "new" : editing.id}
          endpoint={endpoint}
          title={
            editing === "new" ? t("addTitle", { what: title }) : t("editTitle", { what: title })
          }
          fields={fields}
          initial={editing === "new" ? defaults : { ...defaults, ...editing }}
          id={editing === "new" ? null : editing.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            success(t("saved"));
            await refresh();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function toFormValue(kind: FieldDef["kind"], v: unknown): string | boolean {
  if (kind === "checkbox") return v === true;
  if (kind === "list") return Array.isArray(v) ? v.join("\n") : "";
  if (kind === "date") return typeof v === "string" ? v.slice(0, 10) : "";
  return v === null || v === undefined ? "" : String(v);
}

function fromFormValue(kind: FieldDef["kind"], v: string | boolean): unknown {
  if (kind === "checkbox") return v === true;
  if (kind === "list")
    return String(v)
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
  if (kind === "number") return Number(v || 0);
  return v;
}

function RowDialog({
  endpoint,
  title,
  fields,
  initial,
  id,
  onClose,
  onSaved,
}: {
  endpoint: string;
  title: string;
  fields: FieldDef[];
  initial: Record<string, unknown>;
  id: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("hive.setup");
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, toFormValue(f.kind, initial[f.key])])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(
      fields.map((f) => [f.key, fromFormValue(f.kind, values[f.key])]),
    );
    try {
      if (id) await apiClient.patch(`${endpoint}/${id}`, body);
      else await apiClient.post(endpoint, body);
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: string, v: string | boolean) => setValues((cur) => ({ ...cur, [key]: v }));

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          id="hive-ref-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {fields.map((f) => {
            const fid = `ref-${f.key}`;
            const label = t(`field.${f.label}`);
            if (f.kind === "checkbox") {
              return (
                <label key={f.key} htmlFor={fid} className="flex items-center gap-2 text-sm">
                  <input
                    id={fid}
                    type="checkbox"
                    checked={values[f.key] === true}
                    onChange={(e) => set(f.key, e.target.checked)}
                  />
                  {label}
                </label>
              );
            }
            return (
              <div key={f.key}>
                <label htmlFor={fid} className="mb-1 block text-sm font-medium text-foreground">
                  {label}
                </label>
                {f.kind === "select" ? (
                  <NativeSelect
                    id={fid}
                    className="w-full"
                    value={String(values[f.key])}
                    onChange={(e) => set(f.key, e.target.value)}
                  >
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                ) : f.kind === "textarea" || f.kind === "list" ? (
                  <textarea
                    id={fid}
                    rows={f.kind === "list" ? 4 : 3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={String(values[f.key])}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : (
                  <Input
                    id={fid}
                    type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
                    value={String(values[f.key])}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
                {f.hint ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t(`hint.${f.hint}`)}</p>
                ) : null}
              </div>
            );
          })}
          {error ? (
            <p role="alert" className="text-sm text-destructive-emphasis">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button type="submit" form="hive-ref-form" disabled={busy}>
            {busy ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
