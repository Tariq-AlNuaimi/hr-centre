import { redirect } from "next/navigation";

/**
 * UX review P0 (docs/blueprints/ux-p0.md, AC-7.4): the starter template's
 * Settings page showed only the app name and NODE_ENV — dead UI, and a minor
 * disclosure. HR Centre's real configuration lives in each module's settings;
 * the person-level page is Profile, which this address now opens.
 */
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/settings/profile`);
}
