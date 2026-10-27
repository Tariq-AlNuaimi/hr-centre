"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Link2, Share2 } from "lucide-react";
import { ApplyPanel } from "./ApplyPanel";
import type { CareersRole } from "./types";

/** The role page's actions: Apply (the board's panel), copy link, share on LinkedIn. */
export function RoleApply({ role, url }: { role: CareersRole; url: string }) {
  const t = useTranslations("careers");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = () => url || window.location.href;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const linkedIn = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1.5 rounded-md border border-careers-line bg-careers-panel px-3 py-2 text-sm text-careers-ink hover:border-careers-royal"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <Link2 className="h-4 w-4" aria-hidden />
        )}
        <span aria-live="polite">{copied ? t("copied") : t("copyLink")}</span>
      </button>
      {url ? (
        <a
          href={linkedIn}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-careers-line bg-careers-panel px-3 py-2 text-sm text-careers-ink hover:border-careers-royal"
        >
          <Share2 className="h-4 w-4" aria-hidden />
          {t("shareLinkedIn")}
        </a>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-careers-royal px-5 py-2 text-sm font-semibold text-careers-panel hover:bg-careers-navy"
      >
        {t("apply")}
      </button>
      {open ? <ApplyPanel role={role} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
