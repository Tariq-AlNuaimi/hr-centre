# /scale-up recipes — self-hosted sidecar services

Two capabilities the prototype rail lacks, added the serverless-correct way: a
**self-hosted sidecar** the Next app calls over HTTP, not an in-process dependency.
Both are `/scale-up` items (suggest-only; add on the trigger below). Fold these into the
`/scale-up` recipe table when convenient. Each is an Ask-before change (new external
service) — run `/blueprint` and log the build-vs-buy decision (ADR-032) before wiring.

---

## Recipe: PDF export (Stirling-PDF sidecar)

**When to add it:** a fork needs downloadable PDFs. PDF is intentionally absent from
`lib/export.ts` ("pdfkit fragile in serverless"); Excel export already exists there.

**Why a sidecar:** Stirling-PDF is MIT-core, **Java** — it can never be an in-process npm
dep. Running it as a container the Next route calls over HTTP is the correct serverless
answer (and dodges the fragile-pdfkit problem entirely).

**Shape:**

1. Deploy the container (Railway/Fly/any Docker host), private to the app's network:
   `docker run -p 8080:8080 stirlingtools/stirling-pdf:latest`
2. Add `STIRLING_URL` + a shared secret to env (Restricted; SECURITY.md §1).
3. A Next route builds the document (HTML/DOCX) and POSTs it to Stirling's REST API,
   streaming the returned PDF back — guarded by an auth wrapper (`withInternalAuth` shape)
   and never exposing the sidecar publicly.

```ts
// lib/pdf/client.ts — thin HTTP client; NO in-process PDF engine (ADR build-vs-buy entry exists)
export async function htmlToPdf(html: string): Promise<Buffer> {
  const res = await fetch(`${process.env.STIRLING_URL}/api/v1/convert/html/pdf`, {
    method: "POST",
    headers: { "X-API-Key": process.env.STIRLING_SECRET! },
    body: (() => {
      const f = new FormData();
      f.append("fileInput", new Blob([html]), "in.html");
      return f;
    })(),
  });
  if (!res.ok) throw new Error(`stirling ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
```

**Security/cost:** PDFs may carry Restricted/PII — keep the sidecar in the same private
network/VPC, never a public hosted instance; gate the route; audit the export like any
Restricted egress. ~$5–10/mo always-on container. License: MIT core (proprietary carve-outs
in the engine dir you won't use).

---

## Recipe: scraping-as-data-source (crawl4ai sidecar)

**When to add it:** a fork needs to ingest an external web page into a Postgres table
(clean Markdown / structured extraction). The rail has no scraping primitive today.

**Why a sidecar:** crawl4ai is Apache-2.0, **Python + Chromium** — heavy, not an in-process
Node dep. Run its Dockerized FastAPI service and call it over HTTP.

**Shape:**

1. `docker run -p 11235:11235 unclecode/crawl4ai:latest` (private network; it ships JWT auth
   — enable it).
2. A Next route (behind an auth wrapper **+ `withRateLimit` composed OUTSIDE the auth
   wrapper**) calls the crawl endpoint, then persists the normalized result via Prisma.

```ts
// lib/crawl/client.ts — fetch + normalize; route MUST allowlist the URL (see SSRF below)
export async function crawlToMarkdown(url: string): Promise<string> {
  const res = await fetch(`${process.env.CRAWL4AI_URL}/crawl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CRAWL4AI_TOKEN}`,
    },
    body: JSON.stringify({ urls: [url] }),
  });
  if (!res.ok) throw new Error(`crawl4ai ${res.status}`);
  return (await res.json()).results?.[0]?.markdown ?? "";
}
```

**⚠️ Security — SSRF is the headline risk (OWASP A10):** the crawler fetches
operator-supplied URLs, so without an allowlist it becomes an internal-network probe.
Mandatory: validate the URL with zod at the boundary, **allowlist schemes/hosts**
(reject private/link-local IPs and internal hostnames), run the sidecar network-isolated
from internal services, and `withRateLimit` the route. Never pass a raw user URL through
unfiltered.

**Cost:** one always-on container (Chromium is memory-hungry). License: Apache-2.0 (clean).

---

_Both drafted 2026-07-10 alongside the shadcn + chrome-devtools MCP wiring. Next: fold
into `.claude/skills/scale-up/SKILL.md`'s recipe table and add the `/blueprint` + ledger
entries when a fork actually needs them._
