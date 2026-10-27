/**
 * What never reaches a model (Interview Hub `redactPromptPii` +
 * `lib/ai/profile-redact.ts`): emails, phone numbers and the candidate's name
 * in prompts; and in a CV profile, every protected-attribute proxy
 * (nationality, gender, age / dates of birth, address, school, photo, contact)
 * with calendar dates turned into durations.
 */

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /\+?\d[\d\s().-]{5,}\d/g;

export function redactPromptPii(text: string, names: readonly string[] = []): string {
  if (!text) return text;
  let out = text.replace(EMAIL_RE, "[REDACTED_EMAIL]");
  out = out.replace(PHONE_RE, (m) => ((m.match(/\d/g) ?? []).length >= 7 ? "[REDACTED_PHONE]" : m));
  const tokens = new Set<string>();
  for (const raw of names) {
    const n = raw?.trim();
    if (!n) continue;
    tokens.add(n);
    for (const part of n.split(/\s+/)) tokens.add(part);
  }
  for (const t of [...tokens].filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"),
      "[CANDIDATE]",
    );
  }
  return out;
}

const PROXY_KEYS = new Set([
  "nationality",
  "citizenship",
  "gender",
  "sex",
  "ethnicity",
  "race",
  "religion",
  "maritalstatus",
  "marital",
  "age",
  "dob",
  "dateofbirth",
  "birthdate",
  "birthday",
  "placeofbirth",
  "address",
  "city",
  "country",
  "region",
  "postcode",
  "zip",
  "location",
  "institution",
  "university",
  "school",
  "college",
  "academy",
  "photo",
  "photourl",
  "image",
  "imageurl",
  "avatar",
  "picture",
  "headshot",
  "email",
  "phone",
  "mobile",
  "linkedin",
  "linkedinurl",
]);
const DATE_KEYS = new Set([
  "startdate",
  "enddate",
  "start",
  "end",
  "from",
  "to",
  "date",
  "dates",
  "year",
  "years",
  "graduationyear",
  "graduated",
  "period",
]);
const YEAR_RE = /\b(19|20)\d{2}\b/g;
const MAX_DEPTH = 8;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function toMonths(v: unknown): number | null {
  if (typeof v === "number" && v >= 1900 && v <= 2099) return v * 12;
  if (typeof v !== "string") return null;
  const iso = /\b((?:19|20)\d{2})[-/](\d{1,2})\b/.exec(v);
  if (iso) return Number(iso[1]) * 12 + Number(iso[2]) - 1;
  const year = /\b((?:19|20)\d{2})\b/.exec(v);
  if (year) return Number(year[1]) * 12;
  if (/\b(present|current|now|ongoing)\b/i.test(v)) {
    const d = new Date();
    return d.getFullYear() * 12 + d.getMonth();
  }
  return null;
}

function durationOf(entry: Record<string, unknown>): number | null {
  let start: number | null = null;
  let end: number | null = null;
  for (const [k, v] of Object.entries(entry)) {
    const lk = k.toLowerCase();
    if (start === null && ["startdate", "start", "from"].includes(lk)) start = toMonths(v);
    if (end === null && ["enddate", "end", "to"].includes(lk)) end = toMonths(v);
  }
  if (start === null || end === null) return null;
  const months = end - start;
  return months >= 0 && months < 1200 ? months : null;
}

function scrub(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (isObj(value)) {
    const duration = durationOf(value);
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const lk = key.toLowerCase().replace(/[\s_-]/g, "");
      if (PROXY_KEYS.has(lk) || DATE_KEYS.has(lk)) continue;
      out[key] = scrub(v, depth + 1);
    }
    if (duration !== null) out.durationMonths = duration;
    return out;
  }
  if (typeof value === "string") return value.replace(YEAR_RE, "[YEAR]");
  if (typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2099)
    return "[YEAR]";
  return value;
}

export function redactProfileProxies(profile: unknown): unknown {
  if (profile === null || profile === undefined) return {};
  if (!isObj(profile) && !Array.isArray(profile)) return {};
  return scrub(profile, 0);
}
