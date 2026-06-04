# Recipe: Per-consumer API keys + OpenAPI 3.1 docs

> `/scale-up` → "SaaS feature: programmatic API". Turns the **`withApiAuth` Bearer
> seam** (`lib/api-helpers.ts`, ADR-013) from a single shared-secret gate into a real
> per-consumer, hashed-key, scoped API exposed under the already-rewritten `/api/v1/*`
> prefix, plus a generated OpenAPI 3.1 spec and a Swagger UI page.

This recipe is **opt-in** and `shared`-tier oriented. The base template ships
`withApiAuth(tokenEnv, handler)` — a minimal "match one env var" gate. Apply this when a
fork onboards more than one machine consumer and needs per-key revocation, scopes, and
attribution.

## When to add it

Add this when **any** is true:

- A second service / partner / programmatic client needs to call the app and you need to
  **revoke one** without rotating a shared secret.
- You need **per-consumer attribution** in the audit log (which key did this write).
- You need **scopes** (a read-only integration vs. a read/write one).
- A consumer asks for **API docs** (the OpenAPI spec + Swagger UI satisfy this).

If you only have one trusted caller and one route, the base `withApiAuth("SOME_TOKEN", …)`
shared-secret gate is enough — don't add this.

---

## Part (a): the `ApiKey` model

### Deps

None for the model itself. Hashing uses Node's built-in `node:crypto` (already used by
`lib/api-helpers.ts`).

### File to change: `prisma/schema.prisma`

Add the model. We store **only a SHA-256 hash** of the key — the plaintext is shown once at
creation and never persisted. `scopes` is a string array (`READ`, `WRITE`, or finer like
`projects:read`).

```prisma
// prisma/schema.prisma  — add near the other auth models

model ApiKey {
  id         String    @id @default(cuid())
  name       String                       // human label, e.g. "Zapier integration"
  prefix     String                       // first 8 chars of the plaintext, for display ("rk_live_a1b2…") — NOT a secret
  hashedKey  String    @unique            // SHA-256 hex of the full key — Restricted-adjacent (see SECURITY.md)
  scopes     String[]  @default([])       // e.g. ["READ"] or ["READ","WRITE"]
  lastUsedAt DateTime?
  revokedAt  DateTime?
  createdBy  String?                       // userId of the admin who minted it
  creator    User?     @relation(fields: [createdBy], references: [id], onDelete: SetNull)

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  @@index([hashedKey])
  @@index([revokedAt])
  @@map("api_keys")
}
```

Add the back-relation to `User`:

```prisma
// prisma/schema.prisma  — inside model User, alongside accounts / sessions / auditLogs
  apiKeys   ApiKey[]
```

Then migrate:

```bash
npm run prisma:migrate -- --name add_api_keys
```

> **Audit note.** `ApiKey` is **not** in the audit `EXCLUDE` set, so create/update/delete on
> it are audited automatically — and `hashedKey` is already in `SCRUB_FIELDS`? It is **not**
> by default. Add it: see the SECURITY/scrub step below, or the hash lands in `audit_logs`.

### File to change: `lib/prisma/audit-extension.ts` (+ its test)

`hashedKey` is secret-equivalent. Add it to `SCRUB_FIELDS` so audit snapshots redact it, and
update the membership assertion in the same commit (CLAUDE.md hard rule):

```ts
// lib/prisma/audit-extension.ts  — add to the SCRUB_FIELDS set
  "hashedKey",
```

```ts
// tests/contracts/audit-scrub.test.ts  — add to the asserted membership list
  "hashedKey",
```

> Touching `lib/prisma/audit-extension.ts` is an "Ask before" file — confirm with the
> operator and run `/code-review`.

---

## Part (b): key generation + one-time display

### File to add: `lib/api-keys.ts`

```ts
// lib/api-keys.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

const PREFIX = "rk_live_"; // rotate to rk_test_ for non-prod if you like

/** SHA-256 hex of the full plaintext key. Keys are high-entropy random, so a plain
 *  hash (not bcrypt) is correct here — there is nothing to brute-force. */
export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Constant-time hex compare (both inputs are fixed-length 64-char hex). */
export function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Mint a new key. Returns the plaintext ONCE (caller shows it to the admin and then
 * forgets it) plus the persisted row. Only the hash + a non-secret prefix are stored.
 */
export async function createApiKey(opts: {
  name: string;
  scopes: string[];
  createdBy: string;
}) {
  const secret = randomBytes(24).toString("base64url"); // ~32 chars, URL-safe
  const plaintext = `${PREFIX}${secret}`;
  const hashedKey = hashKey(plaintext);
  const prefix = plaintext.slice(0, 12); // "rk_live_xxxx" — safe to display

  const row = await prisma.apiKey.create({
    data: { name: opts.name, scopes: opts.scopes, createdBy: opts.createdBy, hashedKey, prefix },
  });

  // plaintext is returned to the caller, NOT stored.
  return { plaintext, apiKey: { id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes } };
}

/**
 * Resolve a presented Bearer token to an active key principal, or null.
 * Looks up by hash (indexed, unique), rejects revoked keys, and bumps lastUsedAt.
 */
export async function resolveApiKey(plaintext: string) {
  if (!plaintext.startsWith(PREFIX)) return null;
  const hashedKey = hashKey(plaintext);

  // The hash lookup is itself constant-work (single indexed equality). We still do a
  // constant-time compare on the stored hash to avoid any DB-driver timing leak.
  const row = await prisma.apiKey.findUnique({ where: { hashedKey } });
  if (!row || row.revokedAt) return null;
  if (!safeHexEqual(row.hashedKey, hashedKey)) return null; // defensive; hashes match by construction

  // Fire-and-forget last-used bump (don't block the request on it).
  void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return { id: row.id, name: row.name, scopes: row.scopes, createdBy: row.createdBy };
}
```

### File to add: admin routes to mint / list / revoke keys

`app/api/api-keys/route.ts` (gated `withAdminAuth` — only admins manage keys):

```ts
// app/api/api-keys/route.ts
import { z } from "zod";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { createApiKey } from "@/lib/api-keys";

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(["READ", "WRITE"])).default(["READ"]),
});

export const GET = withAdminAuth(async () => {
  const keys = await prisma.apiKey.findMany({
    // NEVER select hashedKey — it must never leave the DB.
    select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return ok(keys);
});

export const POST = withAdminAuth(async (req, { session }) => {
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) return err("Invalid body", 422);
  const { plaintext, apiKey } = await createApiKey({ ...parsed.data, createdBy: session.user.id });
  // The ONLY time the plaintext is ever returned. The UI must show + copy it now.
  return created({ ...apiKey, key: plaintext });
});
```

`app/api/api-keys/[id]/route.ts` (revoke — soft, sets `revokedAt`):

```ts
// app/api/api-keys/[id]/route.ts
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const DELETE = withAdminAuth(async (_req, { params }) => {
  const { id } = await params;
  const existing = await prisma.apiKey.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return err("Not found", 404);
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return ok({ revoked: true });
});
```

> `ok` / `created` / `err` come from `lib/api-response.ts`. If your fork named them
> differently, adjust the imports — the contract is JSON + status code.

---

## Part (c): upgrade `withApiAuth` to look up hashed keys + enforce scopes

The base `withApiAuth(tokenEnv, handler)` matches one env var. Add a **second** wrapper that
resolves a real `ApiKey` row, attributes the audit to the key, and enforces scopes. Keep the
original for back-compat (it's referenced by ADR-013 and CLAUDE.md).

### File to change: `lib/api-helpers.ts`

> "Ask before" file — confirm with the operator, run `/code-review`. We **add** a wrapper,
> we don't change the existing `withApiAuth` signature.

Add near the existing `withApiAuth`:

```ts
// lib/api-helpers.ts  — add these imports at the top
import { resolveApiKey } from "./api-keys";
// (withAuditContext is already imported)

// add this type alongside InternalHandler
type ApiKeyPrincipal = { id: string; name: string; scopes: string[]; createdBy: string | null };
type ApiKeyHandler = (
  req: NextRequest,
  ctx: RouteContext & { apiKey: ApiKeyPrincipal }
) => Promise<NextResponse>;

/**
 * Per-consumer Bearer auth (the real /api/v1 surface). Resolves the presented token to a
 * hashed ApiKey row (constant-time), rejects revoked keys, enforces required scopes, and
 * attributes audit writes to the key's creator (so audit_logs has a userId to query by).
 *
 * Compose with withRateLimit OUTSIDE this wrapper to throttle the Bearer path:
 *   export const GET = withRateLimit(
 *     withApiKeyAuth({ scopes: ["READ"] }, handler),
 *     { id: "v1-projects", limit: 120, windowMs: 60_000 },
 *   );
 */
export function withApiKeyAuth(
  opts: { scopes?: string[] },
  handler: ApiKeyHandler,
) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return err("Unauthorized", 401);

    const principal = await resolveApiKey(token);
    if (!principal) return err("Unauthorized", 401);

    const required = opts.scopes ?? [];
    if (required.length && !required.every((s) => principal.scopes.includes(s))) {
      return forbidden();
    }

    // Attribute audit writes to the key's creator (a real userId) so the audit row is
    // queryable. The key id travels in userAgent so you can also pin the exact consumer.
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    return withAuditContext(
      { userId: principal.createdBy ?? undefined, ipAddress, userAgent: `apikey:${principal.id}` },
      () => handler(req, { ...ctx, apiKey: principal }),
    );
  };
}
```

### File to add: a `/api/v1` consumer route (example)

The rewrite in `next.config.ts` already maps `/api/v1/:path*` → `/api/:path*`. So a route at
`app/api/v1/projects/route.ts` is reachable at **both** `/api/projects` and `/api/v1/projects`
— mount the machine-facing handler under `app/api/v1/**` to keep the external surface
explicit:

```ts
// app/api/v1/projects/route.ts
import { withApiKeyAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const GET = withRateLimit(
  withApiKeyAuth({ scopes: ["READ"] }, async () => {
    const projects = await prisma.project.findMany({
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return ok(projects);
  }),
  { id: "v1-projects-read", limit: 120, windowMs: 60_000 },
);
```

> `middleware.ts` already lets `/api/v1/*` pass through (ADR-013) so the rewrite resolves
> before the session gate — the Bearer wrapper is the only auth on these routes.

---

## Part (d): OpenAPI 3.1 spec + Swagger UI

### Deps

```bash
npm install @asteasolutions/zod-to-openapi
npm install --save-dev swagger-ui-react @types/swagger-ui-react
```

`@asteasolutions/zod-to-openapi` is the maintained generator for **zod 3.x** (the
template's validation lib, ADR-012). `swagger-ui-react` renders the docs page. Both are
client/build-time — they don't enter the request hot path. (`swagger-ui-react` is large but
loads only on `/api/docs`; keep it a `dynamic(() => …, { ssr: false })` import.)

### File to add: `lib/openapi.ts`

Register your zod schemas (reuse the ones in `lib/validations/`) and build the document:

```ts
// lib/openapi.ts
import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// Bearer API-key security scheme
const bearer = registry.registerComponent("securitySchemes", "ApiKey", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "rk_live_*",
});

// Example: a Project response schema (reuse / import your real zod schemas here)
const ProjectSchema = registry.register(
  "Project",
  z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string().datetime(),
  }).openapi("Project"),
);

registry.registerPath({
  method: "get",
  path: "/api/v1/projects",
  summary: "List projects",
  security: [{ [bearer.name]: ["READ"] }],
  responses: {
    200: {
      description: "Array of projects",
      content: { "application/json": { schema: z.array(ProjectSchema) } },
    },
    401: { description: "Missing or invalid API key" },
    403: { description: "Key lacks the READ scope" },
  },
});

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: { title: "API", version: "1.0.0" },
    servers: [{ url: process.env.AUTH_URL ?? "http://localhost:3000" }],
  });
}
```

### File to add: `app/api/openapi.json/route.ts` (serve the spec)

```ts
// app/api/openapi.json/route.ts
import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/openapi";

// Public spec (no secrets in it). If you'd rather gate it, wrap with withAuth.
export function GET() {
  return NextResponse.json(buildOpenApiDocument());
}
```

> Add `/api/openapi.json` and `/api/docs` to `middleware.ts` `publicPaths` if you want the
> docs reachable without a session — both are non-sensitive. (Adding a public path is an
> "Ask before" item; confirm with the operator.)

### File to add: `app/[locale]/api-docs/page.tsx` (Swagger UI)

```tsx
// app/[locale]/api-docs/page.tsx
"use client";
import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function ApiDocsPage() {
  return <SwaggerUI url="/api/openapi.json" />;
}
```

> The CSP in `next.config.ts` allows `'unsafe-inline'` for style/script, which Swagger UI
> needs — no CSP change required. (If your fork later moves to nonce-CSP per SECURITY.md §16
> row 3, Swagger UI's inline styles will need an exception.)

---

## Env vars

This recipe introduces **no new env vars** — keys live in the DB, not the env. (The base
`withApiAuth(tokenEnv, …)` shared-secret path still uses an env var; this per-consumer path
does not.)

---

## SECURITY.md rows to add

Add to **§1 Data classification**:

| Field | Class | Note |
|---|---|---|
| `api_keys.hashedKey` | **Restricted-adjacent** | SHA-256 of a bearer credential. Irreversible but secret-equivalent if exfiltrated — same posture as `users.passwordHash`. Never selected by any API, never logged, scrubbed in `SCRUB_FIELDS`. |
| `api_keys.prefix` | Internal | First 12 chars (`rk_live_xxxx`) for display only — not enough to authenticate. |
| The minted plaintext key (response of `POST /api/api-keys`) | **Restricted** | Returned exactly once; never persisted in plaintext. The admin UI must surface a copy-and-dismiss flow, never re-fetchable. |

Note in **§3 Authorization**: machine consumers authenticate via `withApiKeyAuth` (hashed,
scoped, revocable) under `/api/v1/*`; audit is attributed to the key's `createdBy`. Note in
**§2** that the Bearer path is throttled by composing `withRateLimit` outside the wrapper.

---

## How to test

1. `npm run prisma:migrate -- --name add_api_keys` then `npm run prisma:generate`.
2. `npm run dev`. As an admin, `POST /api/api-keys` with `{ "name":"test","scopes":["READ"] }`
   → copy the `key` from the response (starts with `rk_live_`).
3. Call the consumer route with it:
   ```bash
   curl -H "Authorization: Bearer rk_live_xxx" http://localhost:3000/api/v1/projects
   ```
   → 200 + JSON. Omit/typo the header → 401. Use a key minted with only `["READ"]` against a
   `WRITE`-scoped route → 403.
4. `DELETE /api/api-keys/<id>` → the same `curl` now returns 401 (revoked).
5. Check `npm run prisma:studio`: `api_keys.lastUsedAt` bumped; `audit_logs` has rows for the
   consumer's writes attributed to the key creator's `userId`; `hashedKey` shows `[redacted]`
   in any audit snapshot.
6. Open `/<locale>/api-docs` → Swagger UI renders from `/api/openapi.json`. `npm test` (the
   `audit-scrub` contract now asserts `hashedKey` membership).

---

## Rollback

- Remove `app/api/v1/**` consumer routes, `app/api/api-keys/**`, `app/[locale]/api-docs`,
  `app/api/openapi.json`, `lib/api-keys.ts`, `lib/openapi.ts`, and the `withApiKeyAuth`
  wrapper from `lib/api-helpers.ts`.
- `npm uninstall @asteasolutions/zod-to-openapi swagger-ui-react @types/swagger-ui-react`.
- Drop the `ApiKey` model + the `User.apiKeys` relation and migrate (a destructive migration —
  keep it forward-compatible per CLAUDE.md "don't drop columns the running version reads"; do
  it in a deploy where no code references `api_keys`).
- Leave `hashedKey` in `SCRUB_FIELDS` (harmless) or remove it from the set **and** its test
  assertion in the same commit.
- The base `withApiAuth(tokenEnv, …)` shared-secret seam is untouched and keeps working.
