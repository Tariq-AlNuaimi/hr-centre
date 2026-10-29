/**
 * What a stored file IS, from its first bytes — never what the browser claimed
 * (ADR-098; shared by the core document store and Hiring's package evidence).
 */
export const DOC_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export function sniffType(bytes: Uint8Array): DocType | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}
