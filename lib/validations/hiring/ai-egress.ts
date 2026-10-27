/**
 * AI egress rules (Interview Hub `lib/validations/settings-ai.ts` +
 * `assertEgressAllowed`). The provider base URL must be https and must not be
 * loopback, private, link-local, cloud-metadata, CGNAT or a numeric-obfuscated
 * host — checked when it is saved AND, after DNS resolution, before every call
 * (a name that resolves to 169.254.169.254 is still the metadata service).
 */

export function isBlockedHost(hostname: string): boolean {
  const h = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata" || h === "metadata.google.internal") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1" || h === "::") return true;
  if (/^f[cd][0-9a-f]*:/.test(h) || /^fe[89ab][0-9a-f]*:/.test(h)) return true;
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const v4 = mapped ? mapped[1] : h;
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return blockedV4(Number(m[1]), Number(m[2]));
  // Decimal / hex / short-form IPv4 spellings (2130706433, 0x7f.1) — never a real provider host.
  return /^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+))*$/.test(h);
}

function blockedV4(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 127 ||
    a === 10 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Why a base URL is refused, or null when it is acceptable. */
export function checkBaseUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "must be a valid URL";
  }
  if (u.protocol !== "https:") return "must use https://";
  if (isBlockedHost(u.hostname))
    return "host is not allowed (loopback, private, link-local or cloud-metadata address)";
  return null;
}
