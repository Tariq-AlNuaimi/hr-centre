"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotify } from "@/hooks/use-notify";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { DOCUMENT_CATEGORIES } from "@/lib/validations/core/documents";

type Item = {
  key: string;
  source: "core" | "jml" | "performance" | "hiring";
  id: string;
  title: string;
  category: string;
  date: string;
  href: string;
  restricted: boolean;
};

/**
 * Employee › Documents (ADR-098): the person's files from every module, each
 * opened through its module's own checked route, plus HR's own uploads.
 */
export function EmployeeDocuments({
  employeeId,
  locale,
  items,
  canUpload,
}: {
  employeeId: string;
  locale: string;
  items: Item[];
  canUpload: boolean;
}) {
  const t = useTranslations("people.documents");
  const router = useRouter();
  const { success, error } = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  // API routes open directly; module pages get the locale prefix.
  const hrefOf = (i: Item) => (i.href.startsWith("/api/") ? i.href : `/${locale}${i.href}`);
  async function remove(id: string) {
    setBusy(id);
    try {
      await apiClient.delete(`/api/employees/${employeeId}/documents/${id}`);
      success(t("removed"));
      router.refresh();
    } catch (e) {
      error(e instanceof ApiError ? e.message : t("removeFailed"));
    } finally {
      setBusy(null);
    }
  }
  return (
    <SectionCard title={t("title")} subtitle={t("note")}>
      {items.length === 0 ? (
        <EmptyState description={t("none")} />
      ) : (
        <ul className="mb-4">
          {items.map((i) => (
            <li
              key={i.key}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="brand">{t(`source.${i.source}`)}</Badge>
                  {i.restricted ? <Badge variant="warning">{t("restricted")}</Badge> : null}
                  <span className="truncate text-sm font-medium text-foreground">{i.title}</span>
                </div>
                <p className="text-xs text-muted-foreground">{formatDate(i.date)}</p>
              </div>
              <span className="flex items-center gap-2">
                <Link
                  href={hrefOf(i)}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                  {...(i.href.startsWith("/api/") ? { target: "_blank", rel: "noopener" } : {})}
                >
                  {t("open")}
                </Link>
                {canUpload && i.source === "core" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void remove(i.id)}
                  >
                    {t("remove")}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canUpload ? <UploadForm employeeId={employeeId} /> : null}
    </SectionCard>
  );
}

function UploadForm({ employeeId }: { employeeId: string }) {
  const t = useTranslations("people.documents");
  const router = useRouter();
  const { success, error } = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("contract");
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const file = fileRef.current?.files?.[0];
        if (!file) return;
        const body = new FormData();
        body.set("file", file);
        body.set("title", title);
        body.set("category", category);
        body.set("restricted", String(restricted));
        setBusy(true);
        fetch(`/api/employees/${employeeId}/documents`, { method: "POST", body })
          .then(async (res) => {
            if (!res.ok) {
              const json = (await res.json().catch(() => null)) as { error?: string } | null;
              throw new Error(json?.error ?? t("uploadFailed"));
            }
            success(t("uploaded"));
            setTitle("");
            if (fileRef.current) fileRef.current.value = "";
            router.refresh();
          })
          .catch((err: unknown) => error(err instanceof Error ? err.message : t("uploadFailed")))
          .finally(() => setBusy(false));
      }}
    >
      <div className="space-y-1">
        <label htmlFor="doc-title" className="block text-sm font-medium text-foreground">
          {t("titleLabel")}
        </label>
        <Input
          id="doc-title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="doc-category" className="block text-sm font-medium text-foreground">
          {t("category")}
        </label>
        <select
          id="doc-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        >
          {DOCUMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`categories.${c}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="doc-file" className="block text-sm font-medium text-foreground">
          {t("file")}
        </label>
        <input
          id="doc-file"
          ref={fileRef}
          type="file"
          required
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="block w-full text-sm text-foreground"
        />
      </div>
      <label className="flex items-center gap-2 self-end text-sm text-foreground">
        <input
          type="checkbox"
          checked={restricted}
          onChange={(e) => setRestricted(e.target.checked)}
        />
        {t("markRestricted")}
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || !title.trim()}>
          {t("upload")}
        </Button>
      </div>
    </form>
  );
}
