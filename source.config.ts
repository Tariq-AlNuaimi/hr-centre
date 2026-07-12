import { defineConfig, defineDocs, defineCollections } from "fumadocs-mdx/config";
import { z } from "zod";

// Fumadocs MDX collections (ADR-053; emitted by `npm run enable:docs-site`).
//
// `docs` — the curated content tree. Frontmatter `title` is REQUIRED here so a
// malformed page fails the build with a file-pointed error (blueprint AC-2.2),
// never a blank page.
export const docs = defineDocs({
  dir: "content/docs",
});

// `adrs` — the ADR series pulled in from `docs/decisions/` unchanged (the
// operator-chosen "light frontmatter shim"): ADR files carry no frontmatter, so
// the schema DEFAULTS `title` from the filename at build time
// ("ADR-012-some-slug.md" -> "ADR-012 — Some Slug").
function adrTitleFromPath(filePath: string): string {
  const base =
    filePath
      .split("/")
      .pop()
      ?.replace(/\.mdx?$/, "") ?? filePath;
  const m = /^ADR-(\d+)-(.+)$/.exec(base);
  if (!m) return base;
  const words = m[2].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return `ADR-${m[1]} — ${words.join(" ")}`;
}

export const adrs = defineCollections({
  type: "doc",
  dir: "docs/decisions",
  // ADR-TEMPLATE is authoring scaffolding, not a decision — and its raw-HTML
  // placeholders don't survive MDX compilation.
  files: ["**/*.md", "!ADR-TEMPLATE.md"],
  schema: (ctx) =>
    z.object({
      title: z.string().default(adrTitleFromPath(ctx.path)),
      description: z.string().optional(),
      // keeps page.data shape union-compatible with the `docs` collection
      full: z.boolean().optional(),
    }),
});

export default defineConfig();
