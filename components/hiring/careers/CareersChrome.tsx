import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Careers header and footer (Interview Hub `CareersHeader` / `CareersFooter`), candidate brand. */
export async function CareersHeader({ locale }: { locale: string }) {
  const t = await getTranslations("careers");
  return (
    <header className="border-b border-careers-line bg-careers-panel">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link
          href={`/${locale}/careers`}
          className="inline-flex items-center gap-2 font-bold text-careers-navy"
        >
          <span
            aria-hidden
            className="h-7 w-7 rounded-full bg-linear-to-br from-careers-mint via-careers-sky to-careers-royal"
          />
          {t("brand")}
        </Link>
        <nav
          aria-label={t("navLabel")}
          className="flex gap-5 text-sm font-medium text-careers-muted"
        >
          <a href="#open-roles" className="hover:text-careers-ink">
            {t("navRoles")}
          </a>
        </nav>
      </div>
    </header>
  );
}

export async function CareersFooter() {
  const t = await getTranslations("careers");
  return (
    <footer className="border-t border-careers-line bg-careers-panel">
      <div className="mx-auto max-w-5xl px-6 py-6 text-xs text-careers-muted">
        {t("footer", { year: new Date().getFullYear() })}
      </div>
    </footer>
  );
}
