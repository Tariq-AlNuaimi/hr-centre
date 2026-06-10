// Shared host-safety check for operator-supplied URLs (ADR-016).
//
// Used by both the assessment target URL and the OpenAI-compatible provider base
// URL. Blocking loopback / link-local / private ranges is defence-in-depth against
// SSRF and accidental credential exfiltration to internal hosts (the provider base
// URL is sent a Bearer API key).

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local (cloud metadata)
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // 172.16.0.0/12
  return false;
}

/** True when `url` is a syntactically valid public http(s) URL. */
export function isSafePublicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return !isPrivateHost(u.hostname);
  } catch {
    return false;
  }
}
