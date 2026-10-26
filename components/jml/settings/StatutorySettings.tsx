"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { STATUTORY_KEYS } from "@/lib/statutory/parameters";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Row = {
  id: string;
  key: string;
  value: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  verified: boolean;
  verifiedAt: string | null;
  note: string | null;
  verifiedBy: { name: string | null } | null;
};

const EPOCH = "1970-01-01";

/** Statutory parameters (Offboarding US16): effective-dated, verified by the HR Manager. */
export function StatutorySettings() {
  const t = useTranslations("jml.settings.statutory");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure") || can("jml.verifyStatutory");
  const q = useQuery({
    queryKey: ["jml", "statutory"],
    queryFn: () =>
      apiClient.get<{ rows: Row[]; unverifiedCount: number; unverifiedKeys: string[] }>(
        "/api/jml/config/statutory",
      ),
    enabled: allowed,
  });
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading || (allowed && q.isLoading))
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  if (!allowed)
    return (
      <div className="space-y-6">
        {header}
        <NotPermitted title={t("title")} />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed />
      </div>
    );
  return (
    <div className="space-y-6">
      {header}
      {q.data.unverifiedCount > 0 ? (
        <p
          role="status"
          className="rounded-md border border-border bg-status-warn p-3 text-sm text-status-warn-fg"
        >
          {t("provisional", { count: q.data.unverifiedCount })}
        </p>
      ) : null}
      <SectionCard title={t("parameters")} noBodyPadding>
        {q.data.rows.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("key")}</TableHead>
                <TableHead>{t("value")}</TableHead>
                <TableHead>{t("effective")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.rows.map((r) => (
                <ParamRow key={r.id} row={r} canVerify={can("jml.verifyStatutory")} />
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
      {can("jml.configure") ? <AddParameter /> : null}
    </div>
  );
}

function ParamRow({ row, canVerify }: { row: Row; canVerify: boolean }) {
  const t = useTranslations("jml.settings.statutory");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const [source, setSource] = useState("");
  const from = row.effectiveFrom.slice(0, 10);
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.key}</TableCell>
      <TableCell>{row.value}</TableCell>
      <TableCell className="text-sm">
        {t("range", {
          from: from === EPOCH ? t("always") : from,
          to: row.effectiveTo ? row.effectiveTo.slice(0, 10) : t("open"),
        })}
      </TableCell>
      <TableCell>
        <Badge variant={row.verified ? "success" : "warning"}>
          {row.verified ? t("verified", { name: row.verifiedBy?.name ?? "" }) : t("unverified")}
        </Badge>
        {row.note ? (
          <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{row.note}</p>
        ) : null}
      </TableCell>
      <TableCell>
        {!canVerify ? null : row.verified ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  apiClient.post(`/api/jml/config/statutory/${row.id}/verify`, { verified: false }),
                t("withdrawn"),
              )
            }
          >
            {t("withdraw")}
          </Button>
        ) : (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  apiClient.post(`/api/jml/config/statutory/${row.id}/verify`, {
                    verified: true,
                    sourceReference: source,
                  }),
                t("confirmed"),
              );
            }}
          >
            <Field id={`src-${row.id}`} label={t("checkedAgainst")}>
              <Input
                id={`src-${row.id}`}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </Field>
            <Button type="submit" size="sm" disabled={busy || source.trim().length < 3}>
              {t("confirm")}
            </Button>
          </form>
        )}
      </TableCell>
    </TableRow>
  );
}

function AddParameter() {
  const t = useTranslations("jml.settings.statutory");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const [key, setKey] = useState<string>(STATUTORY_KEYS[0]);
  const [value, setValue] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  return (
    <SectionCard title={t("add")} subtitle={t("addNote")}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const done = await run(
            () =>
              apiClient.post("/api/jml/config/statutory", {
                key,
                value,
                effectiveFrom: from,
                effectiveTo: to || null,
                note: note || null,
              }),
            t("addedRow"),
          );
          if (done) {
            setValue("");
            setFrom("");
            setTo("");
            setNote("");
          }
        }}
      >
        <Field id="sp-key" label={t("key")}>
          <NativeSelect
            id="sp-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="w-full"
          >
            {STATUTORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="sp-value" label={t("value")}>
          <Input id="sp-value" value={value} onChange={(e) => setValue(e.target.value)} required />
        </Field>
        <Field id="sp-from" label={t("from")}>
          <Input
            id="sp-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
        </Field>
        <Field id="sp-to" label={t("to")} hint={t("toHint")}>
          <Input id="sp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field id="sp-note" label={t("note")}>
          <Input id="sp-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={busy || !value || !from}>
            {t("addButton")}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
