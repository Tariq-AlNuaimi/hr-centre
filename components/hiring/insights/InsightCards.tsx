"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/shared/SectionCard";
import type { Insights } from "./types";

const WITHHELD = "__withheld__";

export function VelocityCard({ v }: { v: Insights["velocity"] }) {
  const t = useTranslations("hiring.insights");
  return (
    <SectionCard title={t("velocityTitle")} subtitle={t("velocityHint")}>
      {v.hires === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noHires")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="py-1 text-start font-medium">
                {t("colCompany")}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {t("colHires")}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {t("colAvgDays")}
              </th>
            </tr>
          </thead>
          <tbody>
            {v.byCompany.map((r) => (
              <tr key={r.company} className="border-b border-border last:border-0">
                <td className="py-1">{r.company}</td>
                <td className="py-1 text-end font-mono">{r.hires}</td>
                <td className="py-1 text-end font-mono">{r.avgDays ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {v.truncated ? <p className="mt-2 text-xs text-muted-foreground">{t("truncated")}</p> : null}
    </SectionCard>
  );
}

export function OmanizationCard({ o }: { o: NonNullable<Insights["omanization"]> }) {
  const t = useTranslations("hiring.insights");
  return (
    <SectionCard title={t("omanTitle")} subtitle={t("omanHint")}>
      {o.overall.hires === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noHires")}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-h3 font-semibold">{t("pct", { n: o.overall.pct ?? 0 })}</p>
          <ul className="space-y-2 text-sm">
            {o.companies.map((c) => (
              <li key={c.company} className="flex flex-wrap items-center justify-between gap-2">
                <span>{c.company}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">
                    {t("omanOf", { omani: c.omani, hires: c.hires, pct: c.pct ?? 0 })}
                  </span>
                  {c.target === null ? (
                    <Badge variant="outline">{t("noTarget")}</Badge>
                  ) : (
                    <Badge variant={c.meetsTarget ? "success" : "warning"}>
                      {c.meetsTarget
                        ? t("onTarget", { target: c.target })
                        : t("belowTarget", { target: c.target })}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function Buckets({
  title,
  rows,
  declared,
}: {
  title: string;
  rows: { value: string; count: number }[];
  declared: number;
}) {
  const t = useTranslations("hiring.insights");
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      {declared === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noneDeclared")}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.value} className="flex justify-between">
              <span className={r.value === WITHHELD ? "text-muted-foreground" : ""}>
                {r.value === WITHHELD ? t("withheld") : r.value}
              </span>
              <span className="font-mono">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DeiCard({ d }: { d: NonNullable<Insights["dei"]> }) {
  const t = useTranslations("hiring.insights");
  return (
    <SectionCard title={t("deiTitle")} subtitle={t("deiHint")}>
      <div className="grid gap-6 sm:grid-cols-2">
        <Buckets
          title={t("deiGender", { n: d.declaredGender })}
          rows={d.gender}
          declared={d.declaredGender}
        />
        <Buckets
          title={t("deiEthnicity", { n: d.declaredEthnicity })}
          rows={d.ethnicity}
          declared={d.declaredEthnicity}
        />
      </div>
    </SectionCard>
  );
}
