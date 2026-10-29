import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { candidateStatusView } from "@/lib/hiring/candidate-status";
import { CANDIDATE_STEPS } from "@/lib/hiring/candidate-status-rules";
import { rateLimit } from "@/lib/rate-limit";
import { inviteTokenSchema } from "@/lib/validations/hiring/public";

/**
 * `/careers/status/<token>` — P2-11, where a candidate's application stands, in
 * candidate-facing words (MyGreenhouse pattern). Under the already-public
 * `/careers` surface (ADR-080); the token is the authorisation for one
 * application (ADR-090). Rate-limited per IP; every failure renders the same
 * "not valid" page; never indexed or cached.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("careersStatus");
  return { title: t("metaTitle"), robots: { index: false, follow: false, nocache: true } };
}

async function throttled(): Promise<boolean> {
  const h = await headers();
  const limit = await rateLimit(new Request("https://hiring.internal/status", { headers: h }), {
    id: "hiring-candidate-status",
    limit: 30,
    windowMs: 60_000,
  });
  return !limit.ok;
}

export default async function CandidateStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const t = await getTranslations("careersStatus");
  const { token } = await params;
  const parsed = inviteTokenSchema.safeParse(token);
  const view =
    parsed.success && !(await throttled()) ? await candidateStatusView(parsed.data) : null;
  // QA2 N-17 — a real 404 (not a 200 with an error body); ./not-found.tsx
  // renders the same friendly "not valid" page for every failure.
  if (!view) notFound();
  const current = CANDIDATE_STEPS.indexOf(view.step);
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-6 py-12">
      <header className="space-y-1">
        <p className="text-sm text-careers-muted">{t("hello", { name: view.firstName })}</p>
        <h1 className="text-h3 font-bold text-careers-navy">
          {view.roleTitle ?? t("yourApplication")}
        </h1>
        <p className="text-sm text-careers-muted">
          {[view.companyName, t("appliedOn", { date: view.appliedOn })].filter(Boolean).join(" · ")}
        </p>
      </header>

      {view.outcome ? (
        <p role="status" className="rounded-md border border-border p-4 text-careers-ink">
          {t(`outcome.${view.outcome}`)}
        </p>
      ) : null}

      <ol className="space-y-3" aria-label={t("progress")}>
        {CANDIDATE_STEPS.map((step, i) => {
          const done = i < current || (i === current && view.outcome === "HIRED");
          const now = i === current && !view.outcome;
          return (
            <li
              key={step}
              aria-current={now ? "step" : undefined}
              className={`rounded-md border p-4 ${now ? "border-careers-navy" : "border-border"}`}
            >
              <p className="m-0 font-semibold text-careers-ink">
                {t(`step.${step}.title`)}
                <span className="ms-2 text-xs font-normal text-careers-muted">
                  {done ? t("done") : now ? t("current") : i > current ? t("upcoming") : ""}
                </span>
              </p>
              {now ? (
                <p className="m-0 mt-1 text-sm text-careers-muted">{t(`step.${step}.body`)}</p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-careers-muted">
        {view.updatedOn ? t("updatedOn", { date: view.updatedOn }) : null} {t("privacy")}
      </p>
    </main>
  );
}
