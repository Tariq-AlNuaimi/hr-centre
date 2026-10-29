import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { RoleApply } from "@/components/hiring/careers/RoleApply";
import { JdBody } from "@/components/hiring/careers/JdBody";
import { env } from "@/lib/env";
import { formatDay } from "@/lib/format";
import { openRole } from "@/lib/hiring/careers";
import { idFromSlug, jdBlocks, jobPostingJsonLd, scriptSafeJson } from "@/lib/hiring/careers-jd";

/**
 * `/careers/<slug>` — one advertised role (UX review P1-10): the full JD, the
 * apply panel, share links and `JobPosting` structured data. Public (under
 * CANDIDATE_PATHS); the same advertised-role rule as the board, 404 otherwise.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; slug: string }>;

async function load(slug: string) {
  const id = idFromSlug(slug);
  return id ? openRole(id) : null;
}

const origin = () => env.AUTH_URL?.replace(/\/+$/, "") ?? "";

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const role = await load(slug);
  const t = await getTranslations("careers");
  if (!role) return { title: t("metaTitle") };
  const path = `/${locale}/careers/${role.slug}`;
  const description = role.description.slice(0, 200);
  const title = t("roleMetaTitle", { title: role.title, company: role.company || t("brand") });
  return {
    title,
    description,
    alternates: { canonical: `${origin()}${path}` },
    openGraph: { title, description, type: "website", url: `${origin()}${path}` },
  };
}

export default async function CareersRolePage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  const role = await load(slug);
  if (!role) notFound();
  if (role.slug !== slug) permanentRedirect(`/${locale}/careers/${role.slug}`);
  const t = await getTranslations("careers");
  const url = `${origin()}/${locale}/careers/${role.slug}`;
  const jsonLd = jobPostingJsonLd({
    title: role.title,
    description: role.description,
    company: role.company,
    postedAt: role.postedAt,
    validThrough: role.validThrough,
    url,
    location: role.location,
  });
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <script
        type="application/ld+json"
        // The JSON is escaped so nothing in a JD can close this tag (scriptSafeJson).
        dangerouslySetInnerHTML={{ __html: scriptSafeJson(jsonLd) }}
      />
      <Link
        href={`/${locale}/careers`}
        className="inline-flex items-center gap-1.5 text-sm text-careers-royal hover:underline"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
        {t("allRoles")}
      </Link>
      <header className="mt-4 flex flex-wrap items-start gap-4 border-b border-careers-line pb-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-h2 font-bold text-careers-navy">{role.title}</h1>
          <p className="mt-1 text-sm text-careers-muted">
            {[role.company, role.department].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-sm text-careers-muted">
            {role.place} · {t(`arrangement.${role.location.arrangement}`)}
          </p>
          {role.postedAt ? (
            <p className="mt-1 text-xs text-careers-muted">
              {t("postedOn", { date: formatDay(role.postedAt) })}
            </p>
          ) : null}
        </div>
        <RoleApply role={role} url={url} />
      </header>
      <JdBody blocks={jdBlocks(role.descriptionMarkdown)} empty={t("noDescription")} />
    </main>
  );
}
