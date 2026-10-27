"use client";

import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/hiring/money";
import { ExtractCvButton, RunFitButton } from "../ai/CandidateAiActions";
import { StallCard } from "./StallCard";
import type { CandidateDetail } from "./types";

type Experience = {
  title?: string;
  company?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
};
type Education = { degree?: string; institution?: string; year?: string };
type Profile = {
  summary?: string;
  experience?: Experience[];
  education?: Education[];
  skills?: unknown[];
};

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const humanize = (k: string) =>
  k
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

/** The Profile tab: extracted CV profile and fit on the left, details on the right. */
export function ProfileTab({ c }: { c: CandidateDetail }) {
  const t = useTranslations("hiring.candidate");
  const tsrc = useTranslations("hiring.source");
  const contact = c.contact;
  const profile = (contact?.profileData ?? null) as Profile | null;
  const dash = (v: string | null | undefined) => v || "—";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="space-y-4">
        {contact ? <FitCard c={c} hasProfile={Boolean(profile)} /> : null}
        <SectionCard
          title={t("extractedTitle")}
          actions={c.can.manage && contact?.hasCv ? <ExtractCvButton candidateId={c.id} /> : null}
        >
          {profile && contact ? (
            <ExtractedProfile p={profile} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("noProfile")}</p>
          )}
        </SectionCard>
      </div>
      <div className="space-y-4">
        <SectionCard title={t("detailsTitle")}>
          <DescriptionList
            columns={1}
            items={[
              ...(contact
                ? [
                    { key: "email", label: t("email"), value: dash(contact.email) },
                    { key: "phone", label: t("phone"), value: dash(contact.phone) },
                    { key: "emp", label: t("employer"), value: dash(contact.currentEmployer) },
                  ]
                : []),
              {
                key: "src",
                label: t("source"),
                value: <Badge variant="outline">{tsrc(c.source)}</Badge>,
              },
              ...(c.referredBy
                ? [{ key: "ref", label: t("referredBy"), value: c.referredBy.name }]
                : []),
              { key: "req", label: t("requisition"), value: c.requisition?.title ?? "—" },
              { key: "applied", label: t("applied"), value: formatDate(c.createdAt) },
            ]}
          />
          {!contact ? <p className="mt-3 text-xs text-muted-foreground">{t("piiHidden")}</p> : null}
        </SectionCard>
        <SensitiveCard c={c} />
        {c.can.manage ? <StallCard c={c} /> : null}
      </div>
    </div>
  );
}

function ExtractedProfile({ p }: { p: Profile }) {
  const t = useTranslations("hiring.candidate");
  const label = "mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground";
  return (
    <div className="space-y-5 text-sm">
      {p.summary ? <p>{p.summary}</p> : null}
      {p.experience?.length ? (
        <div>
          <p className={label}>{t("experience")}</p>
          <ul className="space-y-3">
            {p.experience.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-primary-emphasis">
                  <Building2 aria-hidden className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">
                    {[str(e.title), str(e.company)].filter(Boolean).join(" · ")}
                  </p>
                  {str(e.startDate) || str(e.endDate) ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      {t("dateRange", {
                        from: str(e.startDate) ?? "?",
                        to: str(e.endDate) ?? t("present"),
                      })}
                    </p>
                  ) : null}
                  {str(e.description) ? (
                    <p className="text-muted-foreground">{e.description}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.education?.length ? (
        <div>
          <p className={label}>{t("education")}</p>
          <ul className="space-y-1">
            {p.education.map((e, i) => (
              <li key={i}>
                <span className="font-semibold">
                  {[str(e.degree), str(e.institution)].filter(Boolean).join(" · ")}
                </span>
                {str(e.year) ? <span className="text-muted-foreground"> — {e.year}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.skills?.length ? (
        <div>
          <p className={label}>{t("skills")}</p>
          <div className="flex flex-wrap gap-1.5">
            {p.skills.map((s, i) => (
              <Badge key={i} variant="outline">
                {String(s)}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** AI fit (advisory): the rationale, the recommendation and the per-competency scores. */
function FitCard({ c, hasProfile }: { c: CandidateDetail; hasProfile: boolean }) {
  const t = useTranslations("hiring.candidate");
  const contact = c.contact;
  if (!contact) return null;
  const fit = Object.entries((contact.fitScores ?? {}) as Record<string, unknown>).filter(
    (e): e is [string, number] => typeof e[1] === "number",
  );
  return (
    <SectionCard
      title={t("fitTitle")}
      subtitle={t("fitAdvisory")}
      actions={c.can.manage ? <RunFitButton candidateId={c.id} hasProfile={hasProfile} /> : null}
    >
      {contact.aiRationale || contact.aiWhyNot ? (
        <div className="space-y-2 text-sm">
          {contact.aiRationale ? (
            <p className="whitespace-pre-wrap">{contact.aiRationale}</p>
          ) : null}
          {contact.aiWhyNot ? (
            <p className="whitespace-pre-wrap text-muted-foreground">{contact.aiWhyNot}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noFit")}</p>
      )}
      {fit.length ? (
        <ul className="mt-4 space-y-3">
          {fit.map(([k, v]) => (
            <li key={k}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{humanize(k)}</span>
                <span className="font-mono font-bold">{v.toFixed(1)}</span>
              </div>
              <div
                role="meter"
                aria-label={humanize(k)}
                aria-valuemin={0}
                aria-valuemax={5}
                aria-valuenow={v}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.max(0, Math.min(100, (v / 5) * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}

/**
 * Protected attributes and pay expectation, apart from the working details
 * (docs/blueprints/ux-p0.md, US-4). Each field keeps its own server-side gate —
 * nationality and national ID need `hiring.viewPii`, gender and ethnicity
 * `hiring.viewDei`, the expectation the comp rules — so a field the viewer may
 * not see never reaches the browser. An interview panel sees none of them.
 */
function SensitiveCard({ c }: { c: CandidateDetail }) {
  const t = useTranslations("hiring.candidate");
  const contact = c.contact;
  const items = [
    ...(contact
      ? [
          { key: "nat", label: t("nationality"), value: contact.nationality || "—" },
          { key: "nec", label: t("nec"), value: contact.nec || "—" },
        ]
      : []),
    ...(c.dei
      ? [
          { key: "g", label: t("gender"), value: c.dei.gender ?? t("notDeclared") },
          { key: "e", label: t("ethnicity"), value: c.dei.ethnicity ?? t("notDeclared") },
        ]
      : []),
    ...(c.can.viewComp
      ? [
          {
            key: "exp",
            label: t("expectation"),
            value:
              c.salaryExpectation == null ? t("notDeclared") : formatMoney(c.salaryExpectation),
          },
        ]
      : []),
  ];
  if (items.length === 0) return null;
  return (
    <SectionCard title={t("sensitiveTitle")} subtitle={t("sensitiveHint")}>
      <DescriptionList columns={1} items={items} />
    </SectionCard>
  );
}
