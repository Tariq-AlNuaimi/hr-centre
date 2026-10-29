/**
 * Per-role careers pages (UX review P1-10): the shareable slug, the job
 * description as safe blocks, and the `JobPosting` structured data. Pure — the
 * page renders blocks as React text (never HTML), so a JD cannot inject markup.
 */

const SLUG_TITLE_MAX = 60;
/** Requisition ids are cuids (25 lowercase alphanumerics). */
const ID_RE = /^[a-z0-9]{20,40}$/;

/** "Senior Data Engineer" + id → "senior-data-engineer-<id>". */
export function roleSlug(title: string, id: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_TITLE_MAX)
    .replace(/-+$/, "");
  return words ? `${words}-${id}` : id;
}

/** The requisition id a slug ends in, or null when it cannot be one. */
export function idFromSlug(slug: string): string | null {
  const id = slug.slice(slug.lastIndexOf("-") + 1);
  return ID_RE.test(id) ? id : null;
}

export type JdBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/** Inline Markdown → plain text: links keep their label, emphasis and code ticks go. */
function inline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

const HEADING = /^\s{0,3}#{1,6}\s+/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** A JD's Markdown as headings, paragraphs and lists — the only shapes a JD needs. */
export function jdBlocks(md: string): JdBlock[] {
  const blocks: JdBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: inline(para.join(" ")) });
    if (list.length) blocks.push({ kind: "list", items: list });
    para = [];
    list = [];
  };
  const lines = md
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .split("\n");
  for (const raw of lines) {
    const line = raw.replace(/^\s*>\s?/, "");
    if (!line.trim() || RULE.test(line)) flush();
    else if (HEADING.test(line)) {
      flush();
      blocks.push({ kind: "heading", text: inline(line.replace(HEADING, "")) });
    } else if (ITEM.test(line)) {
      if (para.length) flush();
      list.push(inline(line.replace(ITEM, "")));
    } else {
      if (list.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return blocks.filter((b) => (b.kind === "list" ? b.items.length > 0 : b.text.length > 0));
}

/** A requisition's location (overnight item 3). */
export type JobLocation = {
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  arrangement: "ON_SITE" | "HYBRID" | "REMOTE";
};

/** "Oman" for "OM" — English names from the runtime, the code itself if unknown. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Muscat, Oman" — the place part of a location (the arrangement is shown beside it). */
export function placeLabel(l: Pick<JobLocation, "city" | "country">): string {
  return `${l.city}, ${countryName(l.country)}`;
}

export type JobPostingInput = {
  title: string;
  description: string;
  company: string;
  postedAt: string | null;
  validThrough: string | null;
  url: string;
  location: JobLocation;
};

/**
 * schema.org `JobPosting` (Google for Jobs) with the requisition's location.
 * A remote role adds `jobLocationType: TELECOMMUTE` and the country applicants
 * must be in; it keeps `jobLocation` (the hiring office), which Google accepts.
 */
export function jobPostingJsonLd(r: JobPostingInput): Record<string, unknown> {
  const remote = r.location.arrangement === "REMOTE";
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: r.title,
    description: r.description,
    ...(r.postedAt ? { datePosted: r.postedAt.slice(0, 10) } : {}),
    ...(r.validThrough ? { validThrough: r.validThrough } : {}),
    hiringOrganization: { "@type": "Organization", name: r.company || "Rihal" },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: r.location.city,
        addressCountry: r.location.country,
      },
    },
    ...(remote
      ? {
          jobLocationType: "TELECOMMUTE",
          applicantLocationRequirements: {
            "@type": "Country",
            name: countryName(r.location.country),
          },
        }
      : {}),
    url: r.url,
  };
}

/** JSON for a `<script type="application/ld+json">`: nothing in it can close the tag. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
