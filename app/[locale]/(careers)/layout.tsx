import { CareersFooter, CareersHeader } from "@/components/hiring/careers/CareersChrome";

/**
 * The shell for the candidate- and agency-facing hiring pages (ADR-080):
 * `/careers` and `/agency/<token>`. No console chrome — no sidebar, user menu
 * or sign-out — and always the light recruitment brand.
 */
export default async function CareersLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <div className="careers-light flex min-h-screen flex-col bg-careers-page text-careers-ink">
      <CareersHeader locale={locale} />
      {children}
      <CareersFooter />
    </div>
  );
}
