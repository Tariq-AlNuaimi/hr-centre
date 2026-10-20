import type { PmsActor } from "./permissions";

/**
 * §7.1's evidence rules — the pure half.
 *
 * Everything that decides whether an evidence item is acceptable lives here, in
 * functions that need no network and no database, because that is the only way
 * the same answer reaches the upload token, the delete route and the sign-off
 * gate. A rule enforced in a route handler is a rule one new caller can skip.
 *
 * Evidence is **Confidential** (SECURITY.md §1): disclosure harms the
 * individual. Not Restricted — that tier is secrets and salary, and the
 * scrubbing it forces would make the feature unusable — but it is never public,
 * never unauthenticated, and never served from a URL that outlives its check.
 */

/**
 * The allowlist, by magic bytes rather than by name.
 *
 * A denylist is a list of the attacks someone thought of. The extension and the
 * browser-supplied `Content-Type` are both chosen by the uploader, so a `.pdf`
 * that is really HTML is the entire attack — which is why `sniffContentType`
 * below reads the file's own first bytes and the name is used for nothing but
 * display.
 *
 * No `svg`: it is a script container. No archives: the thing inside is
 * unreviewable. No `html`.
 */
export const ALLOWED_EVIDENCE_TYPES = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "text/csv": ["csv"],
  "text/plain": ["txt"],
  "text/markdown": ["md"],
} as const;

export type AllowedContentType = keyof typeof ALLOWED_EVIDENCE_TYPES;

/** 10 MB per file — a scanned PDF or a screenshot set, not a video. */
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

/**
 * 10 items per KPI.
 *
 * As load-bearing as the per-file cap: evidence is REQUIRED, so without a
 * ceiling "attach something" is an unbounded write path on a route an employee
 * can call all day.
 */
export const MAX_EVIDENCE_PER_KPI = 10;

/** Labels are shown, not parsed; bounded so a row cannot carry a payload. */
export const MAX_EVIDENCE_LABEL = 200;
/** A manager's note on an item. Bounded for the same reason. */
export const MAX_EVIDENCE_COMMENT = 2_000;

export type EvidenceRefusal = { reason: string; status: 400 | 403 | 404 | 409 | 413 };

/**
 * The first bytes of a file, as its real type — or null if we do not recognise
 * it.
 *
 * Deliberately NOT exhaustive and deliberately not clever: a type we cannot
 * positively identify is refused. The failure mode of a sniffer that guesses is
 * that it guesses in the uploader's favour.
 *
 * The Office formats and `.xlsx` are ZIP containers, so they share a signature;
 * `expected` disambiguates using the declared type, which is safe because the
 * declared type has already been checked against the allowlist and a ZIP cannot
 * masquerade as a PDF either way.
 */
export function sniffContentType(head: Uint8Array, expected: string): string | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);

  // %PDF-
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  // \x89PNG\r\n\x1a\n
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  // JPEG SOI
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  // RIFF....WEBP
  if (starts(0x52, 0x49, 0x46, 0x46) && [0x57, 0x45, 0x42, 0x50].every((b, i) => head[8 + i] === b))
    return "image/webp";
  // PK\x03\x04 — every OOXML file is a ZIP. Only the three OOXML types may
  // claim it; anything else declaring a ZIP signature is refused below.
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    const ooxml = [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];
    return ooxml.includes(expected) ? expected : null;
  }

  // The text formats have no signature. They are accepted on the declared type
  // alone, which is sound only because they are served as attachments with
  // `nosniff` — a text/* file cannot execute in our origin. Anything binary
  // declaring itself text still fails: a NUL byte in the head rules it out.
  const textish = ["text/csv", "text/plain", "text/markdown"];
  if (textish.includes(expected)) return head.includes(0x00) ? null : expected;

  return null;
}

/** Is this a type we accept at all? */
export function isAllowedContentType(type: string): type is AllowedContentType {
  return Object.hasOwn(ALLOWED_EVIDENCE_TYPES, type);
}

/**
 * §7.1 — why this file may not be uploaded, or null when it may.
 *
 * Called by the upload-token route BEFORE any byte leaves the browser, which is
 * what makes the size limit cheap to enforce rather than something discovered
 * after a 10 MB transfer.
 */
export function uploadBlockedReason(params: {
  contentType: string;
  sizeBytes: number;
  existingCount: number;
}): EvidenceRefusal | null {
  const { contentType, sizeBytes, existingCount } = params;

  if (!isAllowedContentType(contentType)) {
    return {
      reason:
        `That file type is not accepted. Allowed: ` +
        `${Object.values(ALLOWED_EVIDENCE_TYPES).flat().join(", ")}.`,
      status: 400,
    };
  }
  if (sizeBytes <= 0) {
    return { reason: "That file is empty.", status: 400 };
  }
  if (sizeBytes > MAX_EVIDENCE_BYTES) {
    return {
      reason:
        `That file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB. The limit is ` +
        `${MAX_EVIDENCE_BYTES / 1024 / 1024} MB per file.`,
      status: 413,
    };
  }
  if (existingCount >= MAX_EVIDENCE_PER_KPI) {
    return {
      reason:
        `This KPI already has ${existingCount} evidence items, which is the limit of ` +
        `${MAX_EVIDENCE_PER_KPI}. Remove one before adding another.`,
      status: 409,
    };
  }
  return null;
}

/**
 * §7.1 — why this LINK may not be attached, or null when it may.
 *
 * `http(s)` only. `javascript:` is the obvious one; `file:` and `data:` matter
 * just as much, because the person who later clicks this link is the employee's
 * manager or HR, and the link was supplied by someone with an interest in the
 * outcome.
 */
export function linkBlockedReason(params: {
  url: string;
  existingCount: number;
}): EvidenceRefusal | null {
  const { url, existingCount } = params;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { reason: "That does not look like a web address.", status: 400 };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { reason: "Only http:// and https:// links can be attached.", status: 400 };
  }
  if (existingCount >= MAX_EVIDENCE_PER_KPI) {
    return {
      reason:
        `This KPI already has ${existingCount} evidence items, which is the limit of ` +
        `${MAX_EVIDENCE_PER_KPI}. Remove one before adding another.`,
      status: 409,
    };
  }
  return null;
}

/**
 * §7.1 — who may ADD or REMOVE an item: the subject, and only the subject.
 *
 * Not their manager "on their behalf", and not HR. The evidence is the
 * employee's account of their own year; someone else curating it is a different
 * artefact wearing the same name. HR's route past a stuck assessment is the
 * deadline and §5.5's ladder, not editing the record.
 *
 * Removal stays open until the employee SIGNS, not until the manager reviews:
 * the manager reviewing does not end her ability to correct what she submitted,
 * and every change after review is audited (requirement 5).
 */
export function evidenceWriteBlockedReason(params: {
  actor: PmsActor;
  subjectEmployeeId: string;
  employeeSigned: boolean;
}): EvidenceRefusal | null {
  const { actor, subjectEmployeeId, employeeSigned } = params;

  if (actor.employeeId === null || actor.employeeId !== subjectEmployeeId) {
    // 404, never 403 — the same rule the rest of §4.2 follows. "You may not
    // touch this" confirms it exists.
    return { reason: "Evidence not found", status: 404 };
  }
  if (employeeSigned) {
    return {
      reason:
        "You have signed this assessment, so its evidence is part of the signed record (§7.1). " +
        "HR can reopen it if something needs to change.",
      status: 409,
    };
  }
  return null;
}

/**
 * §7.1 — why the employee may not SIGN yet, or null when they may.
 *
 * HR's rule: a rating on every KPI AND at least one evidence item on every KPI.
 * This is the gate the whole feature exists for — without it "required" is a
 * label on a form field rather than a property of the record.
 *
 * Reported as a COUNT and the first offending KPI rather than a bare refusal: a
 * disabled button that will not say what it wants is the thing people file bugs
 * about.
 */
export function signBlockedReason(params: {
  kpis: readonly { id: string; description: string; hasRating: boolean; evidenceCount: number }[];
}): EvidenceRefusal | null {
  const { kpis } = params;
  if (kpis.length === 0) {
    return { reason: "There are no KPIs to assess yet (§5.1).", status: 409 };
  }

  const unrated = kpis.filter((k) => !k.hasRating);
  if (unrated.length > 0) {
    return {
      reason:
        `${unrated.length} of ${kpis.length} KPIs still need a rating — starting with ` +
        `“${unrated[0].description}”.`,
      status: 409,
    };
  }

  const unevidenced = kpis.filter((k) => k.evidenceCount === 0);
  if (unevidenced.length > 0) {
    return {
      reason:
        `${unevidenced.length} of ${kpis.length} KPIs still need evidence — starting with ` +
        `“${unevidenced[0].description}”. Attach a file or a link to each one before signing.`,
      status: 409,
    };
  }
  return null;
}
