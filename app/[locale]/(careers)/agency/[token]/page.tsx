import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AgencySubmitForm } from "@/components/hiring/careers/AgencySubmitForm";
import { invitePageView } from "@/lib/hiring/agency-invites";
import { inviteTokenSchema } from "@/lib/validations/hiring/public";

/**
 * `/agency/<token>` — an agency's submission link. The token is resolved HERE
 * on the server; every failure renders the same "not valid" page, which is
 * given nothing about the invite. Never indexed, never cached.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("agency");
  return { title: t("metaTitle"), robots: { index: false, follow: false, nocache: true } };
}

export default async function AgencyPage({ params }: { params: Promise<{ token: string }> }) {
  const t = await getTranslations("agency");
  const { token } = await params;
  const parsed = inviteTokenSchema.safeParse(token);
  const view = parsed.success ? await invitePageView(parsed.data) : { state: "invalid" as const };
  if (view.state !== "valid" || !("agencyName" in view)) {
    const capped = view.state === "cap-reached";
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <h1 className="text-h3 font-bold text-careers-navy">
          {capped ? t("cappedTitle") : t("invalidTitle")}
        </h1>
        <p className="mt-2 text-careers-muted">{capped ? t("cappedBody") : t("invalidBody")}</p>
      </main>
    );
  }
  const company = view.company ?? t("rihal");
  const roleLine = view.role
    ? [view.role.title, company, view.role.department].filter(Boolean).join(" · ")
    : t("generalPool", { company });
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <p className="text-xs font-semibold tracking-wide text-careers-muted uppercase">
        {t("eyebrow", { agency: view.agencyName })}
      </p>
      <h1 className="mt-1 mb-6 text-h3 font-bold text-careers-navy">{t("title")}</h1>
      <AgencySubmitForm token={parsed.data!} roleLine={roleLine} />
    </main>
  );
}
