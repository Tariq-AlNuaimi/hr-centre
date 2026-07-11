# Recipe: Outbound webhooks (signed, retried)

> `/scale-up` → "SaaS feature: outbound webhooks". Lets a fork notify external systems
> when entities change, with HMAC-SHA256 signatures, timestamped anti-replay, and
> retry/backoff. Pairs with the Inngest `/scale-up` item for backgrounded delivery.

This recipe is **opt-in**. The base template emits no outbound traffic. Apply it when an
external system needs to react to events in this app (e.g. "a project was created").

## When to add it

Add this when **any** is true:

- A partner / internal service needs near-real-time notification of changes here.
- You're replacing polling (a consumer hitting `GET /api/v1/...` on a timer) with push.
- You need a delivery **audit trail** (who got notified, did it succeed, retries).

If only _your own_ UI needs live updates, use the **Pusher** realtime `/scale-up` item
instead — webhooks are for _external_ consumers.

## Deps

None required — signing uses `node:crypto`, delivery uses the built-in `fetch`.

**Strongly recommended:** background the delivery with **Inngest** (the "Background
processing" `/scale-up` item, free 50k steps/mo). Synchronous delivery inside a request
blocks the user's response on a slow/hung receiver and dies with the serverless function.
This recipe ships a synchronous emitter that works today, with the exact Inngest seam
marked so you can move delivery off the request path.

---

## Part (a): the models

### File to change: `prisma/schema.prisma`

```prisma
// prisma/schema.prisma  — add these models

model Webhook {
  id         String            @id @default(cuid())
  url        String                              // receiver endpoint (https only — validate)
  secret     String                              // HMAC signing key — Restricted (see SECURITY.md)
  events     String[]          @default([])      // subscribed event names, e.g. ["project.created"]
  active     Boolean           @default(true)
  createdBy  String?
  creator    User?             @relation(fields: [createdBy], references: [id], onDelete: SetNull)

  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt

  deliveries WebhookDelivery[]

  @@index([active])
  @@map("webhooks")
}

model WebhookDelivery {
  id           String   @id @default(cuid())
  webhookId    String
  webhook      Webhook  @relation(fields: [webhookId], references: [id], onDelete: Cascade)
  event        String
  payload      Json                              // the body we signed + sent
  status       String   @default("PENDING")      // PENDING | SUCCESS | FAILED
  attempts     Int      @default(0)
  responseCode Int?
  error        String?
  lastAttempt  DateTime?
  createdAt    DateTime @default(now())

  @@index([webhookId])
  @@index([status])
  @@map("webhook_deliveries")
}
```

Add the back-relation to `User`:

```prisma
// inside model User
  webhooks  Webhook[]
```

Then:

```bash
npm run prisma:migrate -- --name add_webhooks
```

### File to change: `lib/prisma/audit-extension.ts` (+ its test)

`Webhook.secret` is the HMAC key. `secret` is **already** in `SCRUB_FIELDS`, so audit
snapshots of `Webhook` redact it automatically — no scrub change needed. (Verify
`tests/contracts/audit-scrub.test.ts` still asserts `"secret"`; it does in the base.)

> Do **not** add `Webhook` / `WebhookDelivery` to the audit `EXCLUDE` set — but note that
> `WebhookDelivery.payload` snapshots whatever entity triggered the event. If that entity
> holds Restricted/Confidential fields, the delivery row (and its audit) inherits the class —
> same rule as `audit_logs.before/after`. Keep payloads minimal (ids + a few safe fields),
> not full entity dumps.

---

## Part (b): the emitter

### File to add: `lib/webhooks.ts`

```ts
// lib/webhooks.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [0, 1_000, 5_000, 30_000, 120_000]; // per-attempt delay (synchronous path uses the gap loosely)

/**
 * Canonical signed string: `${timestamp}.${rawBody}`. The receiver recomputes the same
 * HMAC and rejects if the timestamp is too old (replay defense). Mirrors the Stripe scheme
 * so receiver libraries are familiar.
 */
function sign(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * Verify an inbound signature (exported so a fork that ALSO receives webhooks — or its
 * tests — can reuse the exact check). Provided here for completeness; the receiver snippet
 * below is the canonical consumer-side version.
 */
export function verifySignature(opts: {
  secret: string;
  signatureHeader: string; // "t=<ts>,v1=<hex>"
  rawBody: string;
  toleranceSec?: number;
}): boolean {
  const parts = Object.fromEntries(opts.signatureHeader.split(",").map((p) => p.split("=")));
  const ts = Number(parts.t);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > (opts.toleranceSec ?? 300)) return false;
  const expected = sign(opts.secret, ts, opts.rawBody);
  const got = parts.v1 ?? "";
  if (expected.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

/** POST one delivery with the signed headers. Returns the HTTP status or throws on network error. */
async function postOnce(url: string, secret: string, rawBody: string): Promise<number> {
  const ts = Math.floor(Date.now() / 1000);
  const signature = sign(secret, ts, rawBody);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": String(ts),
      // "t=<ts>,v1=<hex>" — timestamp travels in the signature header to prevent replay.
      "x-signature": `t=${ts},v1=${signature}`,
    },
    body: rawBody,
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}

/**
 * Emit an event to every active webhook subscribed to it. Creates a WebhookDelivery row per
 * target, attempts delivery with backoff, and records the outcome.
 *
 * ⚠️ Synchronous path: this awaits delivery inline. For production, move the per-delivery
 * loop into an Inngest function (see the seam below) so a slow receiver can't block the
 * request or be killed when the serverless function returns.
 */
export async function emitEvent(event: string, payload: Record<string, unknown>): Promise<void> {
  const hooks = await prisma.webhook.findMany({ where: { active: true, events: { has: event } } });
  if (hooks.length === 0) return;

  const rawBody = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });

  await Promise.all(
    hooks.map(async (hook) => {
      const delivery = await prisma.webhookDelivery.create({
        data: { webhookId: hook.id, event, payload: payload as object },
      });
      await deliver(delivery.id, hook.url, hook.secret, rawBody);
    }),
  );
}

/** Attempt delivery with bounded retries + backoff, updating the delivery row each time. */
export async function deliver(
  deliveryId: string,
  url: string,
  secret: string,
  rawBody: string,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const status = await postOnce(url, secret, rawBody);
      const okStatus = status >= 200 && status < 300;
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: attempt,
          responseCode: status,
          status: okStatus ? "SUCCESS" : attempt === MAX_ATTEMPTS ? "FAILED" : "PENDING",
          lastAttempt: new Date(),
          error: okStatus ? null : `HTTP ${status}`,
        },
      });
      if (okStatus) return;
    } catch (e) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: attempt,
          status: attempt === MAX_ATTEMPTS ? "FAILED" : "PENDING",
          lastAttempt: new Date(),
          error: e instanceof Error ? e.message : "network error",
        },
      });
    }
    // CAUTION: this in-request sleep is for local/dev only. On Vercel the
    // function will be KILLED at its timeout mid-retry, silently truncating
    // delivery. In production, deliver via the Inngest seam below (one attempt
    // per step, Inngest owns the backoff) -- do NOT ship this synchronous loop.
    if (attempt < MAX_ATTEMPTS)
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt] ?? 30_000));
  }
}
```

### Inngest seam (recommended for production)

When you add Inngest (`/scale-up` → "Background processing without blocking"), replace the
synchronous loop in `emitEvent` with an event send, and run `deliver` inside a step with
native retry/backoff:

```ts
// emitEvent: instead of awaiting deliver(...), enqueue:
//   await inngest.send({ name: "webhook/deliver", data: { deliveryId, url, secret, rawBody } });
//
// inngest/functions.ts:
// export const deliverWebhook = inngest.createFunction(
//   { id: "deliver-webhook", retries: 4 },                       // Inngest owns backoff
//   { event: "webhook/deliver" },
//   async ({ event, step }) => {
//     await step.run("post", () => deliver(event.data.deliveryId, event.data.url, event.data.secret, event.data.rawBody));
//   },
// );
```

This takes delivery off the request path entirely — the user's mutation returns immediately
and Inngest handles retries durably.

---

## Emitting from a service / route

Call `emitEvent` after a successful write. Example: on project create. **Emit after the
write commits, and never let a webhook failure roll back the user's action** — `emitEvent`
swallows per-delivery errors into delivery rows, so it won't throw on a bad receiver.

```ts
// app/api/projects/route.ts  — inside the existing withEditorAuth POST handler
import { emitEvent } from "@/lib/webhooks";

export const POST = withEditorAuth(async (req) => {
  const parsed = CreateProjectSchema.safeParse(await req.json());
  if (!parsed.success) return err("Invalid body", 422);

  const project = await prisma.project.create({ data: parsed.data });

  // Fire-and-forget is fine once delivery is backgrounded (Inngest). On the synchronous
  // path, await it so deliveries are attempted before the function returns.
  await emitEvent("project.created", { id: project.id, name: project.name });

  return created(project);
});
```

> Keep the payload **minimal and non-sensitive** (ids + a couple of safe fields). The
> receiver can call back `GET /api/v1/projects/<id>` with its API key for the full record.

### Managing webhooks (admin routes)

Mint/list/delete webhooks via `withAdminAuth` routes, identical in shape to the API-keys
admin routes in recipe 2. Generate `secret` with `randomBytes(32).toString("base64url")`,
return it once on create (same one-time-display discipline — it's the HMAC key), and
**never select `secret`** in the list route.

---

## Part: receiver verification snippet (give this to the consumer)

The receiving service verifies the signature and rejects stale/forged deliveries. Node
example (Express-style; the consumer must read the **raw** body, not parsed JSON):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody: string, signatureHeader: string, secret: string): boolean {
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  const ts = Number(parts.t);
  // Reject deliveries older than 5 minutes (replay defense).
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const got = Buffer.from(parts.v1 ?? "", "utf8");
  const exp = Buffer.from(expected, "utf8");
  return got.length === exp.length && timingSafeEqual(got, exp);
}

// handler:
//   const raw = await readRawBody(req);              // do NOT use parsed JSON
//   if (!verify(raw, req.headers["x-signature"], WEBHOOK_SECRET)) return res.status(401).end();
//   const { event, data } = JSON.parse(raw);
//   res.status(200).end();  // 2xx = ack; anything else triggers our retry
```

---

## Env vars

None on this app's side — secrets live per-`Webhook` row in the DB. The **receiver** holds
its copy of the secret in _its_ env.

---

## SECURITY.md rows to add

Add to **§1 Data classification**:

| Field                        | Class          | Note                                                                                                                                                                |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhooks.secret`            | **Restricted** | HMAC-SHA256 signing key. Secret-equivalent — never selected by any API, never logged. Already covered by `SCRUB_FIELDS` (`"secret"`), so audit snapshots redact it. |
| `webhooks.url`               | Internal       | Receiver endpoint.                                                                                                                                                  |
| `webhook_deliveries.payload` | inherits       | Snapshots the triggering entity — same class as that entity. Keep payloads minimal.                                                                                 |

Note in **§8 (outbound network)** / threat model: this app now makes **outbound HTTPS
requests** to operator-configured URLs. Validate `url` is `https://` on create, and consider
an allowlist if the receiver set is fixed (SSRF: don't let an admin point a webhook at an
internal address — block private/link-local ranges if that's in your threat model).

---

## How to test

1. `npm run prisma:migrate -- --name add_webhooks` then `npm run prisma:generate`.
2. Start a receiver: `npx http-echo-server 4000` or a https://webhook.site URL. Create a
   `Webhook` row (`url` = that, `events` = `["project.created"]`, a generated `secret`).
3. `npm run dev`, create a project via the UI/API → the receiver gets a POST with
   `x-signature: t=<ts>,v1=<hex>`. `npm run prisma:studio` → a `webhook_deliveries` row with
   `status=SUCCESS`, `attempts=1`.
4. Point a webhook at a URL that 500s → confirm the row goes through retries and ends
   `FAILED` after `MAX_ATTEMPTS`, with `error` recorded.
5. Run the receiver verify snippet against a captured delivery → passes; tamper one byte of
   the body or backdate the timestamp > 5 min → rejects.
6. Confirm a `Webhook` audit snapshot shows `secret: "[redacted]"`. `npm run lint` / `npm test`.

---

## Rollback

- Remove `lib/webhooks.ts`, the `emitEvent` call sites, and any webhook admin routes.
- Drop the `Webhook` / `WebhookDelivery` models + the `User.webhooks` relation and migrate
  (forward-compatible — do it in a deploy where no code references the tables).
- If you added Inngest only for this, see the Inngest `/scale-up` rollback.
- No env vars to unset. The base template emits no outbound traffic again.
