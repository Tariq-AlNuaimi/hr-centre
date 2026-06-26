// Single source of truth for the fork's i18n surface.
//
// Everything locale-shaped — the next-intl routing, the URL `/<locale>` prefix
// regex used across middleware + chrome, and the <html dir> direction — derives
// from `locales` / `defaultLocale` in project.config.json. A fork that wants
// Arabic (or any other locale) flips that array; nothing else needs editing.
// This replaces the six hardcoded `/^\/(en|ar)/` regexes the codebase used to
// carry (one per file), which silently rotted whenever the locale set changed.
//
// Pure data + a derived RegExp — safe to import from BOTH server (middleware,
// layout, i18n/request) and client components (header/sidebar/breadcrumbs).
import projectConfig from "@/project.config.json";

type ProjectConfig = {
  locales?: unknown;
  defaultLocale?: unknown;
};

const config = projectConfig as ProjectConfig;

// Locales the right-to-left direction applies to. Only `ar` ships today, but a
// fork enabling Hebrew/Persian/Urdu gets correct direction for free.
const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

function readLocales(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const cleaned = raw.filter(
      (l): l is string => typeof l === "string" && l.length > 0,
    );
    if (cleaned.length > 0) return cleaned;
  }
  // Defensive fallback: an empty/malformed config must never produce a routing
  // with zero locales (next-intl would throw at startup).
  return ["en"];
}

/** Configured locales (e.g. `["en"]` English-only, or `["en","ar"]`). */
export const locales: string[] = readLocales(config.locales);

/** Default locale; must be one of `locales`, else the first configured one. */
export const defaultLocale: string =
  typeof config.defaultLocale === "string" &&
  locales.includes(config.defaultLocale)
    ? config.defaultLocale
    : locales[0];

/** `ltr` | `rtl` per configured locale, derived from RTL_LOCALES. */
export const localeDirection: Record<string, "ltr" | "rtl"> =
  Object.fromEntries(
    locales.map((l) => [l, RTL_LOCALES.has(l) ? "rtl" : "ltr"] as const),
  );

/** Resolve text direction for an (arbitrary) locale; defaults to `ltr`. */
export function directionForLocale(locale: string): "ltr" | "rtl" {
  return localeDirection[locale] ?? "ltr";
}

/** True when more than one locale ships → the locale switcher is meaningful. */
export const hasMultipleLocales = locales.length > 1;

/** The locale after `current` in the configured order (wraps). */
export function nextLocale(current: string): string {
  const i = locales.indexOf(current);
  return locales[(i + 1) % locales.length];
}

// Matches a leading `/<locale>` URL segment (e.g. `/en`, `/ar`) at a path
// boundary, capturing the locale in group 1. Derived from `locales` so adding a
// locale needs no regex edits. The `(?=/|$)` boundary makes it stricter than the
// old `/^\/(en|ar)/` (which would also have matched `/enterprise` → "en"), while
// staying behavior-identical for real locale-prefixed paths.
export const localePrefixRegex = new RegExp(
  `^/(${locales.join("|")})(?=/|$)`,
);
