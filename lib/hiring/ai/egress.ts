import { checkBaseUrl, isBlockedHost } from "@/lib/validations/hiring/ai-egress";

/**
 * Right before every provider call: the stored base URL is re-checked AND its
 * host resolved, so a name that resolves to 169.254.169.254 (or rebinds to a
 * private address) is refused. Fails closed.
 */
export async function assertEgressAllowed(baseUrl: string): Promise<void> {
  const reason = checkBaseUrl(baseUrl);
  if (reason) throw new Error(`AI egress blocked: ${reason}`);
  const { lookup } = await import("node:dns/promises");
  let addrs: { address: string }[];
  try {
    addrs = await lookup(new URL(baseUrl).hostname, { all: true });
  } catch {
    throw new Error("AI egress blocked: the base URL host did not resolve");
  }
  if (addrs.some((a) => isBlockedHost(a.address))) {
    throw new Error("AI egress blocked: the base URL resolves to a private or metadata address");
  }
}
