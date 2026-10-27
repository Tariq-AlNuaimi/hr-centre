"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";

const inputCls =
  "w-full rounded-md border border-careers-line bg-careers-panel px-3 py-2 text-sm text-careers-ink outline-none focus:border-careers-royal";

/** An agency submits a candidate through its invite (Interview Hub `AgencySubmitForm`). */
export function AgencySubmitForm({ token, roleLine }: { token: string; roleLine: string }) {
  const t = useTranslations("agency");
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; cvStored: boolean } | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const cv = fd.get("cv");
    if (!(cv instanceof File) || cv.size === 0) return setError(t("needCv"));
    if (fd.get("consent") !== "on") return setError(t("needConsent"));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/agency/${encodeURIComponent(token)}/submit`, {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => null)) as {
        data?: { cvStored: boolean };
        error?: string;
      } | null;
      if (res.ok)
        setDone({
          name: String(fd.get("candidateName") ?? ""),
          cvStored: json?.data?.cvStored !== false,
        });
      else setError(json?.error ?? t("failed"));
    } catch {
      setError(t("networkError"));
    } finally {
      setBusy(false);
    }
  }
  if (done) {
    return (
      <div
        role="status"
        className="space-y-3 rounded-lg border border-careers-line bg-careers-panel p-6 text-sm"
      >
        <p className="inline-flex items-center gap-2 text-lg font-semibold text-careers-navy">
          <CheckCircle2 className="h-5 w-5 text-status-ok-fg" aria-hidden />
          {t("submittedTitle")}
        </p>
        <p className="text-careers-ink">
          {t("submittedBody", { name: done.name || t("theCandidate") })}
        </p>
        {!done.cvStored ? <p className="text-status-err-fg">{t("cvNotStored")}</p> : null}
        <button
          type="button"
          className="rounded-md border border-careers-line px-4 py-2 text-careers-ink"
          onClick={() => (setDone(null), form.current?.reset())}
        >
          {t("another")}
        </button>
      </div>
    );
  }
  return (
    <form
      ref={form}
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-careers-line bg-careers-panel p-6"
    >
      <p className="text-sm text-careers-muted">{t("intro", { role: roleLine })}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-careers-ink">{t("name")}</span>
          <input name="candidateName" required maxLength={255} className={inputCls} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-careers-ink">{t("email")}</span>
          <input name="candidateEmail" type="email" required maxLength={255} className={inputCls} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-careers-ink">{t("employer")}</span>
          <input name="currentEmployer" maxLength={255} className={inputCls} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-careers-ink">{t("salary")}</span>
          <input name="salaryExpectation" type="number" min={0} step="0.001" className={inputCls} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-careers-ink">{t("cv")}</span>
        <input
          name="cv"
          type="file"
          accept="application/pdf"
          required
          className="block text-sm text-careers-ink"
        />
        <span className="mt-1 block text-xs text-careers-muted">{t("cvHint")}</span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-careers-ink">{t("fit")}</span>
        <textarea name="fitNote" rows={4} maxLength={4000} className={inputCls} />
      </label>
      <label className="flex items-start gap-2 text-sm text-careers-ink">
        <input name="consent" type="checkbox" className="mt-1" required />
        <span>{t("consent")}</span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-status-err-fg">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-careers-muted">{t("attribution")}</p>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-careers-royal px-5 py-2 text-sm font-semibold text-careers-panel disabled:opacity-60"
        >
          {busy ? t("submitting") : t("submit")}
        </button>
      </div>
    </form>
  );
}
