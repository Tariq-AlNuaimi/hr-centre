"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button-variants";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { LIVE_SEGMENTS } from "../nav";

/**
 * "The 15 steps of the Rihal hiring process, and the screen that serves each
 * one" (Interview Hub `/hiring-flow`, `lib/services/hiring-process.ts`). The
 * process is reconstructed from Interview Hub's conformance trace; the source
 * .docx is with the operator.
 */
const PHASES: { key: string; steps: { n: number; href: string; perRecord?: boolean }[] }[] = [
  {
    key: "plan",
    steps: [
      { n: 1, href: "requisitions/request" },
      { n: 2, href: "approvals" },
      { n: 3, href: "requisitions", perRecord: true },
    ],
  },
  {
    key: "attract",
    steps: [
      { n: 4, href: "requisitions", perRecord: true },
      { n: 5, href: "requisitions", perRecord: true },
      { n: 6, href: "requisitions", perRecord: true },
    ],
  },
  {
    key: "assess",
    steps: [
      { n: 7, href: "interviews" },
      { n: 8, href: "requisitions", perRecord: true },
      { n: 9, href: "candidates", perRecord: true },
    ],
  },
  {
    key: "offer",
    steps: [
      { n: 10, href: "approvals" },
      { n: 11, href: "offers", perRecord: true },
      { n: 12, href: "offers", perRecord: true },
    ],
  },
  {
    key: "close",
    steps: [
      { n: 13, href: "close-out" },
      { n: 14, href: "candidates", perRecord: true },
      { n: 15, href: "candidates", perRecord: true },
    ],
  },
];

const SPINE = [
  "requisition",
  "apply",
  "screen",
  "interview",
  "evaluate",
  "decide",
  "offer",
  "hire",
];

export function HiringFlow() {
  const t = useTranslations("hiring.flow");
  const locale = useLocale();
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Link href={`/${locale}/hiring/requisitions/request`} className={buttonVariants({})}>
            {t("start")}
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {PHASES.map((phase) => (
          <SectionCard key={phase.key} title={t(`phase.${phase.key}`)}>
            <ol className="space-y-3">
              {phase.steps.map((s) => (
                <li key={s.n} className="text-sm">
                  <p className="font-medium text-foreground">
                    {s.n}. {t(`step.${s.n}.title`)}
                  </p>
                  <p className="text-muted-foreground">
                    {LIVE_SEGMENTS.has(s.href.split("/")[0]) ? (
                      <Link
                        className="text-primary-emphasis hover:underline"
                        href={`/${locale}/hiring/${s.href}`}
                      >
                        {t(`step.${s.n}.screen`)}
                      </Link>
                    ) : (
                      t(`step.${s.n}.screen`)
                    )}
                    {s.perRecord ? ` · ${t(`step.${s.n}.opens`)}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </SectionCard>
        ))}
      </div>
      <SectionCard title={t("spineTitle")} subtitle={t("spineHint")}>
        <ol className="flex flex-wrap gap-2">
          {SPINE.map((k, i) => (
            <li
              key={k}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground"
            >
              {i}. {t(`spine.${k}`)}
            </li>
          ))}
        </ol>
      </SectionCard>
    </div>
  );
}
