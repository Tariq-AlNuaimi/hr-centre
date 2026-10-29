"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, X } from "lucide-react";
import type { CareersRole } from "./types";

type Form = {
  name: string;
  email: string;
  phone: string;
  nationality: string;
  currentEmployer: string;
  linkedinUrl: string;
  consent: boolean;
};
const EMPTY: Form = {
  name: "",
  email: "",
  phone: "",
  nationality: "",
  currentEmployer: "",
  linkedinUrl: "",
  consent: false,
};

const inputCls =
  "w-full rounded-md border border-careers-line bg-careers-panel px-3 py-2 text-sm text-careers-ink outline-none focus:border-careers-royal";

/**
 * The application form (Interview Hub `ApplyForm`). Rendered in place (not a
 * portal) so it stays inside the page's light scope. Esc closes; focus starts
 * on the first field. Consent is required here AND on the server (D2).
 */
export function ApplyPanel({ role, onClose }: { role: CareersRole; onClose: () => void }) {
  const t = useTranslations("careers");
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // P2-11 — the candidate's status page, linked from the confirmation.
  const [statusPath, setStatusPath] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/careers/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requisitionId: role.id,
          name: f.name,
          email: f.email,
          phone: f.phone || undefined,
          nationality: f.nationality || undefined,
          currentEmployer: f.currentEmployer || undefined,
          linkedinUrl: f.linkedinUrl || undefined,
          consent: f.consent,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        data?: { statusPath?: string };
      } | null;
      if (res.ok) {
        setStatusPath(json?.data?.statusPath ?? null);
        setDone(true);
      } else setError(json?.error ?? t("genericError"));
    } catch {
      setError(t("networkError"));
    } finally {
      setBusy(false);
    }
  }
  const fields: {
    k: keyof Form;
    label: string;
    type?: string;
    required?: boolean;
    auto?: string;
  }[] = [
    { k: "name", label: t("fieldName"), required: true, auto: "name" },
    { k: "email", label: t("fieldEmail"), type: "email", required: true, auto: "email" },
    { k: "phone", label: t("fieldPhone"), type: "tel", auto: "tel" },
    { k: "nationality", label: t("fieldNationality") },
    { k: "currentEmployer", label: t("fieldEmployer"), auto: "organization" },
    { k: "linkedinUrl", label: t("fieldLinkedin"), type: "url", auto: "url" },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-careers-navy/50 p-4 sm:p-10">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-title"
        className="w-full max-w-xl rounded-lg bg-careers-panel p-6 shadow-lg"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-careers-muted uppercase">
              {t("apply")}
            </p>
            <h2 id="apply-title" className="text-h4 font-bold text-careers-navy">
              {role.title}
            </h2>
            <p className="text-sm text-careers-muted">
              {[role.company, role.department].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="rounded-md p-1 text-careers-muted hover:text-careers-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {done ? (
          <div
            role="status"
            className="flex gap-3 rounded-md bg-status-ok p-4 text-sm text-status-ok-fg"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">{t("submittedTitle")}</p>
              <p>{t("submittedBody")}</p>
              {statusPath ? (
                <p className="mt-2">
                  <a href={statusPath} className="font-semibold underline">
                    {t("trackStatus")}
                  </a>{" "}
                  {t("trackStatusHelp")}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            {fields.map((x, i) => (
              <label key={x.k} className="block text-sm">
                <span className="mb-1 block font-medium text-careers-ink">
                  {x.label}
                  {x.required ? (
                    <span aria-hidden className="text-status-err-fg">
                      {" "}
                      *
                    </span>
                  ) : null}
                </span>
                <input
                  ref={i === 0 ? first : undefined}
                  className={inputCls}
                  type={x.type ?? "text"}
                  required={x.required}
                  autoComplete={x.auto}
                  maxLength={x.k === "phone" ? 50 : 255}
                  placeholder={x.k === "linkedinUrl" ? t("linkedinPlaceholder") : undefined}
                  value={f[x.k] as string}
                  onChange={(e) => set(x.k, e.target.value)}
                />
              </label>
            ))}
            <div className="rounded-md border border-careers-line bg-careers-page p-3 text-xs text-careers-muted">
              <p className="mb-1 font-semibold text-careers-ink">{t("noticeTitle")}</p>
              <p>{t("noticeBody")}</p>
            </div>
            <label className="flex items-start gap-2 text-sm text-careers-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={f.consent}
                onChange={(e) => set("consent", e.target.checked)}
                required
              />
              <span>{t("consent")}</span>
            </label>
            {error ? (
              <p role="alert" className="text-sm text-status-err-fg">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-careers-line px-4 py-2 text-sm text-careers-ink"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={busy || !f.consent}
                className="rounded-md bg-careers-royal px-5 py-2 text-sm font-semibold text-careers-panel disabled:opacity-60"
              >
                {busy ? t("submitting") : t("submit")}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
