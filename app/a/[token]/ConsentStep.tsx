"use client";

import * as React from "react";
import { PenLine, MessageSquare, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CandidateLocale, CandidateStrings } from "@/lib/candidate-i18n";
import { postConsent } from "./save";

// Step 0 — Welcome & Consent (UI-SPEC C.1). Plain-language PDPL notice + an
// explicit checkbox; "Begin" is disabled until checked and POSTs consent before
// advancing. If consent fails, the answer flow never opens (honest feedback).
export function ConsentStep({
  t,
  locale,
  token,
  roleTitle,
  onConsented,
}: {
  t: CandidateStrings;
  locale: CandidateLocale;
  token: string;
  roleTitle: string;
  onConsented: () => void;
}) {
  const [checked, setChecked] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const expectSteps = [
    { icon: PenLine, title: t.stepReflect, desc: t.stepReflectDesc },
    { icon: MessageSquare, title: t.stepRespond, desc: t.stepRespondDesc },
    { icon: CheckCircle2, title: t.stepDone, desc: t.stepDoneDesc },
  ];

  const begin = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await postConsent(token, locale);
      onConsented();
    } catch {
      setError(t.offlineHint);
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {roleTitle && (
        <p className="text-sm text-muted-foreground">
          {t.applyingFor}{" "}
          <span className="font-medium text-foreground">{roleTitle}</span>
        </p>
      )}

      <div>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-foreground">
          {t.welcomeHero}
        </h1>
        <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-muted-foreground">
          {t.welcomeSubcopy}
        </p>
      </div>

      <section aria-labelledby="expect-h">
        <h2
          id="expect-h"
          className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t.whatToExpectTitle}
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {expectSteps.map(({ icon: Icon, title, desc }) => (
            <li
              key={title}
              className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)]"
            >
              <Icon aria-hidden className="size-5 text-accent" />
              <p className="mt-2 font-medium text-foreground">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="consent-h"
        className="rounded-lg border border-border bg-[var(--rihal-mist)] p-6"
      >
        <h2
          id="consent-h"
          className="font-display text-lg font-semibold tracking-tight text-foreground"
        >
          {t.consentTitle}
        </h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <div>
            <dt className="font-medium text-foreground">{t.consentWhatTitle}</dt>
            <dd className="text-muted-foreground">{t.consentWhat}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{t.consentWhyTitle}</dt>
            <dd className="text-muted-foreground">{t.consentWhy}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">
              {t.consentRetentionTitle}
            </dt>
            <dd className="text-muted-foreground">{t.consentRetention}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{t.consentWhoTitle}</dt>
            <dd className="text-muted-foreground">{t.consentWho}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm">
          <a
            href="/methodology"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent underline underline-offset-4 hover:no-underline"
          >
            {t.methodologyLink}
          </a>
        </p>

        <label className="mt-5 flex items-start gap-3 rounded-md border border-border bg-card p-4">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--rihal-azure)]"
          />
          <span className="text-sm leading-relaxed text-foreground">
            {t.consentCheckbox}
          </span>
        </label>
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          onClick={begin}
          disabled={!checked || submitting}
          className="w-full sm:w-auto"
        >
          {t.begin}
        </Button>
        {!checked && (
          <p className="text-xs text-muted-foreground">{t.consentRequiredHint}</p>
        )}
      </div>
    </div>
  );
}
