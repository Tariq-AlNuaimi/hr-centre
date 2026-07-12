import { loader } from "fumadocs-core/source";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { docs, adrs } from "collections/server";
import { defaultLocale } from "@/i18n/config";

// Fumadocs source adapter (ADR-053) — the seam the docs route group imports;
// Fumadocs internals stay out of `app/`. Two sources: the curated
// `content/docs/**` tree plus the ADR series (see source.config.ts).
//
// baseUrl is locale-prefixed with the DEFAULT locale: the docs mount under
// `/{locale}/docs` (operator decision), and v1 serves the single English tree
// for every locale — sidebar/search links point at the default locale so no
// per-click middleware redirect is paid. A multi-locale fork can wire
// fumadocs-core i18n later without moving files.
export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    adrs: toFumadocsSource(adrs, []),
  },
  {
    baseUrl: `/${defaultLocale}/docs`,
  },
);
