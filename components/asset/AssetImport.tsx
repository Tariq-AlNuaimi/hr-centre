"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type Status = { kind: "idle" | "loading" | "ok" | "error"; msg?: string };

/**
 * CSV bulk-import panel for assets (T11). Reads a file client-side, POSTs its text to
 * `/api/asset/import`, and shows an honest per-batch result (success count or the
 * row-indexed error string the route returns). On success, calls `onImported` so the
 * list refetches. On-token; all copy through next-intl.
 */
export function AssetImport({ onImported }: { onImported?: () => void }) {
  const t = useTranslations("assets");
  const [csv, setCsv] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsv(await f.text());
    setStatus({ kind: "idle" });
  };

  const doImport = async () => {
    if (!csv) return;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch("/api/asset/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const j: { data?: { imported?: number }; error?: string } = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", msg: j.error ?? t("importFailed") });
        return;
      }
      setStatus({ kind: "ok", msg: t("importSuccess", { count: j.data?.imported ?? 0 }) });
      setCsv("");
      onImported?.();
    } catch {
      setStatus({ kind: "error", msg: t("importFailed") });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-4">
      <p className="text-sm font-medium text-foreground">{t("importTitle")}</p>
      <p className="text-sm text-muted-foreground">{t("importHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          aria-label={t("importTitle")}
          className="text-sm text-foreground"
        />
        <Button type="button" onClick={doImport} disabled={!csv || status.kind === "loading"}>
          {status.kind === "loading" ? t("importing") : t("importAction")}
        </Button>
      </div>
      {status.msg ? (
        <p
          className={
            status.kind === "error" ? "text-sm text-destructive" : "text-sm text-foreground"
          }
        >
          {status.msg}
        </p>
      ) : null}
    </div>
  );
}
