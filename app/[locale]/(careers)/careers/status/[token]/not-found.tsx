import { getTranslations } from "next-intl/server";

/** QA2 N-17 — every invalid status link: HTTP 404, the same friendly words. */
export default async function CandidateStatusInvalid() {
  const t = await getTranslations("careersStatus");
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <h1 className="text-h3 font-bold text-careers-navy">{t("invalidTitle")}</h1>
      <p className="mt-2 text-careers-muted">{t("invalidBody")}</p>
    </main>
  );
}
