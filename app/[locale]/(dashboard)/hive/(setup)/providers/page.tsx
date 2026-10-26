"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { ReferenceManager, type Row } from "@/components/hive/admin/ReferenceManager";
import { apiClient, ApiError } from "@/lib/api-client";

type Page = { rows: Row[]; total: number; page: number; pageSize: number };
type ImportResult = {
  cleared: number;
  added: number;
  alreadyPresent: number;
  skippedCount: number;
  skipped: { line: number; reason: string }[];
  total: number;
};

/**
 * Insurance network providers (HIVE §4.6), searched by `hive_network_providers`
 * (pg_trgm similarity). ~464 rows arrive from the insurer's spreadsheet: upload
 * it here (the same import as `npm run hive:providers`), then fix single rows.
 */
export default function HiveProvidersPage() {
  const t = useTranslations("hive.setup");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["hive-ref", "providers", q, page],
    queryFn: () =>
      apiClient.get<Page>(
        `/api/hive/admin/ref/providers?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      ),
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <>
      <PageHeader title={t("providersTitle")} subtitle={t("providersIntro")} />
      <div className="space-y-6">
        <UploadCard />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72">
            <label htmlFor="prov-q" className="mb-1 block text-sm font-medium">
              {t("search")}
            </label>
            <Input
              id="prov-q"
              value={q}
              maxLength={100}
              placeholder={t("searchProviders")}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("providerCount", { count: list.data?.total ?? 0 })}
          </p>
        </div>
        <ReferenceManager
          resource="providers"
          title={t("providers")}
          rows={list.data?.rows}
          external
          defaults={{ name: "", providerType: "", location: "", address: "", phone: "" }}
          fields={[
            { key: "name", label: "name", kind: "text" },
            { key: "providerType", label: "providerType", kind: "text" },
            { key: "location", label: "location", kind: "text" },
            { key: "address", label: "address", kind: "textarea" },
            { key: "phone", label: "phone", kind: "text" },
          ]}
          columns={[
            { label: t("field.name"), render: (r) => String(r.name) },
            { label: t("field.providerType"), render: (r) => String(r.providerType ?? "—") },
            { label: t("field.location"), render: (r) => String(r.location) },
            { label: t("field.phone"), render: (r) => String(r.phone ?? "—") },
          ]}
        />
        {pages > 1 ? (
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("previous")}
            </Button>
            <span className="text-sm text-muted-foreground">{t("pageOf", { page, pages })}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("next")}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function UploadCard() {
  const t = useTranslations("hive.setup");
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      if (replace) form.set("replace", "1");
      const res = await fetch("/api/hive/admin/providers/import", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as {
        data?: ImportResult;
        error?: string;
      } | null;
      if (!res.ok || !body?.data) throw new ApiError(body?.error ?? t("saveFailed"), res.status);
      setResult(body.data);
      await queryClient.invalidateQueries({ queryKey: ["hive-ref", "providers"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title={t("upload")} subtitle={t("uploadNote")}>
      <div className="space-y-3">
        <label htmlFor="prov-file" className="block text-sm font-medium">
          {t("uploadFile")}
        </label>
        <input
          id="prov-file"
          type="file"
          accept=".xlsx"
          className="text-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          {t("replace")}
        </label>
        <Button disabled={!file || busy} onClick={() => void upload()}>
          {busy ? t("uploading") : t("uploadButton")}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive-emphasis">
            {error}
          </p>
        ) : null}
        {result ? (
          <div role="status" className="text-sm">
            <p>
              {t("uploadResult", {
                added: result.added,
                present: result.alreadyPresent,
                skipped: result.skippedCount,
                cleared: result.cleared,
                total: result.total,
              })}
            </p>
            {result.skipped.length > 0 ? (
              <ul className="mt-2 list-disc ps-5 text-xs text-muted-foreground">
                {result.skipped.map((s) => (
                  <li key={s.line}>{t("skippedLine", { line: s.line, reason: s.reason })}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
