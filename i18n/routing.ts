import { defineRouting } from "next-intl/routing";
import { locales, defaultLocale } from "./config";

// Locales + default come from project.config.json (via i18n/config.ts) so a fork
// changes its language set in one place. Default ships English-only (["en"]).
export const routing = defineRouting({
  locales,
  defaultLocale,
});
