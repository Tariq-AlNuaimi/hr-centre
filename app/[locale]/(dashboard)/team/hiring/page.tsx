import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { navContextFor } from "@/lib/nav/server-context";
import { ownsRequisitions } from "@/lib/nav/tabs";
import { myHiring } from "@/lib/hiring/my-hiring";
import { HIRING_STEPS } from "@/lib/hiring/stage-rules";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { MyHiringReview } from "@/components/hiring/MyHiringReview";

/**
 * My hiring — the hiring manager's landing (UX review tickets P1-9,
 * docs/blueprints/ux-p1-team.md US-2): my requisitions with candidates per
 * phase and days open, candidates waiting for MY decision (advance / reject
 * with a note), and job descriptions waiting for my signature. For anyone who
 * may own a requisition (`hiring.hiringManager` or `hiring.manage`); every
 * action re-checks on its route.
 */
export default async function MyHiringPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);
  const ctx = await navContextFor(session);
  if (!ownsRequisitions(ctx)) notFound();
  const t = await getTranslations("team.myHiring");
  const tStage = await getTranslations("hiring.stage");
  const data = await myHiring(session.user.id);
  const link = "text-foreground font-medium underline-offset-4 hover:underline";

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <SectionCard title={t("reviewTitle")} subtitle={t("reviewNote")}>
        {data.awaitingReview.length === 0 ? (
          <EmptyState description={t("reviewEmpty")} />
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {data.awaitingReview.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0"
              >
                <div className="min-w-0">
                  <Link href={`/${locale}/hiring/candidates/${c.id}`} className={link}>
                    {c.name}
                  </Link>
                  <p className="m-0 text-sm text-muted-foreground">
                    {c.requisition.title} · {tStage(c.stage)} ·{" "}
                    {t("waiting", { days: c.waitingDays })}
                  </p>
                </div>
                <MyHiringReview
                  candidateId={c.id}
                  nextStage={c.next}
                  nextLabel={c.next ? tStage(c.next) : null}
                />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {data.jdSignoffs.length > 0 ? (
        <SectionCard title={t("jdTitle")} subtitle={t("jdNote")}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {data.jdSignoffs.map((r) => (
              <li key={r.id}>
                <Link href={`/${locale}/hiring/requisitions/${r.id}/jd`} className={link}>
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard title={t("requisitionsTitle")} noBodyPadding>
        {data.requisitions.length === 0 ? (
          <div className="p-6">
            <EmptyState description={t("requisitionsEmpty")} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-start text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t("requisition")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t("daysOpen")}
                  </th>
                  {HIRING_STEPS.slice(1).map((step) => (
                    <th key={step} scope="col" className="px-2 py-2 text-center font-medium">
                      {t(`step.${step}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.requisitions.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/${locale}/hiring/requisitions/${r.id}`} className={link}>
                        {r.title}
                      </Link>{" "}
                      <Badge variant="outline">{t(`status.${r.status}`)}</Badge>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{r.daysOpen}</td>
                    {r.perStep.map((n, i) => (
                      <td
                        key={i}
                        className={`px-2 py-2 text-center tabular-nums ${n === 0 ? "text-muted-foreground" : ""}`}
                      >
                        {n}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
