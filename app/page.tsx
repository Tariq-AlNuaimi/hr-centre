import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n/config";

// The bare root has no locale prefix; send it to the configured default locale
// (driven by project.config.json, not hardcoded) so a fork that changes its
// defaultLocale doesn't land on a non-existent /en route.
export default function RootPage() {
  redirect(`/${defaultLocale}`);
}
