# Recipe: App-layer column encryption (AES-256-GCM)

> `/scale-up` → shared-tier security checklist item **#5** (SECURITY.md §16).
> Adds encryption-at-rest for **Restricted** columns beyond what `SCRUB_FIELDS`
> covers. `SCRUB_FIELDS` only redacts values in audit/Sentry **payloads** — it does
> **nothing** for the row itself at rest. A Restricted column (salary, API token,
> national ID, health flag) needs real encryption (SECURITY.md §4 explicitly calls
> for "pgcrypto or app-layer AES-256-GCM").

## When to add it

Add this the moment a fork introduces a **Restricted** column that is **not** an
irreversible hash (passwords stay bcrypt — don't encrypt those). Examples: a stored
third-party API token, a salary figure, a government ID. This is an **ADR-001
migration trigger** ("Restricted column → encryption + its own ADR") — run `/adr`.

**Tradeoff to accept up front: encrypted columns are not queryable.** You cannot
`WHERE`, `ORDER BY`, `LIKE`, or index on the plaintext — the DB only sees ciphertext.
Keep anything you must search/sort/join on out of the encrypted set (or store a
separate blind-index/hash for equality lookups, which is its own design). Don't
encrypt a column you filter on.

## Deps

None — Node's built-in `node:crypto` provides AES-256-GCM.

## Env var — the key

```bash
# 32 bytes, base64. Generate once: openssl rand -base64 32
FIELD_ENCRYPTION_KEY="<base64-32-bytes>"
```

Set in `.env`, `.env.example` (shape only), and the Vercel project env (Production +
Preview — they may differ if you don't want preview deployments to decrypt prod data;
typically they share). **Restricted.** Losing it = the encrypted columns are
unrecoverable. Rotating it requires re-encrypting (see "Key rotation").

## New file — `lib/crypto-field.ts`

```ts
// lib/crypto-field.ts — AES-256-GCM field encryption (recipe shared-security/5).
//
// Format of a stored value:  v1:<keyId>:<iv_b64>:<tag_b64>:<ciphertext_b64>
// - "v1" lets us evolve the scheme; <keyId> supports key rotation (see below).
// - Random 12-byte IV per encryption (GCM standard). Auth tag detects tampering.
// The plaintext NEVER touches logs. The key comes from FIELD_ENCRYPTION_KEY.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION = "v1";

// Map of keyId -> 32-byte Buffer. Default key id "0" is FIELD_ENCRYPTION_KEY.
// Add FIELD_ENCRYPTION_KEY_PREV (etc.) to decrypt old data during rotation.
function loadKeys(): Record<string, Buffer> {
  const keys: Record<string, Buffer> = {};
  const primary = process.env.FIELD_ENCRYPTION_KEY;
  if (primary) keys["0"] = Buffer.from(primary, "base64");
  const prev = process.env.FIELD_ENCRYPTION_KEY_PREV;
  if (prev) keys["prev"] = Buffer.from(prev, "base64");
  return keys;
}

const KEYS = loadKeys();
const PRIMARY_KEY_ID = "0";

function keyFor(id: string): Buffer {
  const k = KEYS[id];
  if (!k || k.length !== 32) {
    throw new Error(`FIELD_ENCRYPTION_KEY (id=${id}) missing or not 32 bytes`);
  }
  return k;
}

/** Encrypt a UTF-8 string with the primary key. Returns the tagged envelope. */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFor(PRIMARY_KEY_ID), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    PRIMARY_KEY_ID,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/** Decrypt an envelope produced by encryptField. Throws if tampered or wrong key. */
export function decryptField(envelope: string): string {
  const [version, keyId, ivB64, tagB64, ctB64] = envelope.split(":");
  if (version !== VERSION) throw new Error(`Unknown field-encryption version: ${version}`);
  const decipher = createDecipheriv(ALGO, keyFor(keyId), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString(
    "utf8",
  );
}

/** True if a stored value looks like our envelope (lets reads tolerate legacy plaintext). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}
```

## Schema — store ciphertext as a `String`

The encrypted column is just a `String?` (it holds the envelope text). Example: a
`Vendor.apiToken`:

```prisma
model Vendor {
  id        String   @id @default(cuid())
  name      String
  apiToken  String?  // RESTRICTED — AES-256-GCM envelope (recipe shared-security/5)
  // ...
}
```

`npm run prisma:migrate -- --name add_vendor_apitoken` then `:generate`.

> If you also adopt recipe 2 (MFA), `User.mfaSecret` is the canonical example — wrap
> it with the same extension below so it's encrypted at rest, not just scrubbed from
> audit payloads.

## Transparent encrypt-on-write / decrypt-on-read — a Prisma `$extends`

Add a client extension that intercepts `create`/`update` to encrypt the configured
fields, and a `result` computed field (or a query-result post-process) to decrypt on
read. Because the template's `lib/prisma.ts` composes extensions, add this as the
**innermost** extension (closest to the base client) so audit/soft-delete see the
already-correct shape.

```ts
// lib/prisma/encryption-extension.ts (recipe shared-security/5)
import { Prisma } from "../../generated/prisma/client";
import { encryptField, decryptField, isEncrypted } from "../crypto-field";

// Per-model list of Restricted fields to encrypt at rest. EXTEND this when you add
// an encrypted column (and add a SECURITY.md §1 Restricted row in the same commit).
const ENCRYPTED_FIELDS: Record<string, string[]> = {
  Vendor: ["apiToken"],
  // User: ["mfaSecret"],   // if recipe 2 is also applied
};

function encryptArgs(model: string, data: Record<string, unknown> | undefined) {
  const fields = ENCRYPTED_FIELDS[model];
  if (!data || !fields) return data;
  for (const f of fields) {
    const v = data[f];
    if (typeof v === "string" && v.length > 0 && !isEncrypted(v)) {
      data[f] = encryptField(v);
    }
  }
  return data;
}

function decryptRecord(model: string, rec: unknown) {
  const fields = ENCRYPTED_FIELDS[model];
  if (!rec || !fields || typeof rec !== "object") return rec;
  const obj = rec as Record<string, unknown>;
  for (const f of fields) {
    const v = obj[f];
    if (isEncrypted(v as string)) {
      try {
        obj[f] = decryptField(v as string);
      } catch {
        // Tampered / wrong key — surface as null rather than leak ciphertext.
        obj[f] = null;
      }
    }
  }
  return obj;
}

export const encryptionExtension = Prisma.defineExtension((client) =>
  client.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          args.data = encryptArgs(model, args.data as Record<string, unknown>) as never;
          const res = await query(args);
          return decryptRecord(model, res);
        },
        async update({ model, args, query }) {
          args.data = encryptArgs(model, args.data as Record<string, unknown>) as never;
          const res = await query(args);
          return decryptRecord(model, res);
        },
        async findUnique({ model, args, query }) {
          return decryptRecord(model, await query(args));
        },
        async findFirst({ model, args, query }) {
          return decryptRecord(model, await query(args));
        },
        async findMany({ model, args, query }) {
          const rows = (await query(args)) as unknown[];
          return rows.map((r) => decryptRecord(model, r));
        },
      },
    },
  }),
);
```

Wire it into `lib/prisma.ts` as the **innermost** extension (apply it first, so the
data is ciphertext by the time audit snapshots it — defense in depth: even the audit
row stores ciphertext, not plaintext):

```ts
// lib/prisma.ts
import { encryptionExtension } from "./prisma/encryption-extension";

function createExtendedClient() {
  const base = createBaseClient();
  return base
    .$extends(encryptionExtension) // innermost: encrypt before audit sees it
    .$extends(softDeleteExtension)
    .$extends(auditExtension);
}
```

> **Ordering note + interaction with audit:** with encryption innermost, the audit
> extension's `before` snapshot (a separate `findUnique`) and `after` (the op result)
> both pass through the decrypt path on read — meaning `audit_logs` could capture
> _plaintext_ in `after`/`changes` for an encrypted field. To prevent that, add the
> encrypted field names to `SCRUB_FIELDS` too (they're Restricted anyway), OR
> exclude them from the model in `ENCRYPTED_FIELDS`'s decrypt-on-read for the audit
> path. The simplest correct choice: **add each encrypted field name to
> `SCRUB_FIELDS`** (and the scrub contract test) so audit/Sentry redact them
> regardless. This satisfies the CLAUDE.md "Adding a Restricted column → extend
> SCRUB_FIELDS" rule in one move.

## Excel export caveat

Per the CLAUDE.md hard rule, **`SCRUB_FIELDS` does NOT protect export output.** If a
column is both encrypted and exported, the read path decrypts it — so an Excel export
column list that includes an encrypted field will emit **plaintext**. Audit your
`toExcel` column lists per route and exclude Restricted/encrypted fields.

## Files to change in a fork

| File                                  | Change                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| `lib/crypto-field.ts`                 | **New** — AES-256-GCM primitives                                    |
| `lib/prisma/encryption-extension.ts`  | **New** — transparent encrypt/decrypt                               |
| `lib/prisma.ts`                       | Add `encryptionExtension` innermost; **Ask-before file**            |
| `lib/prisma/audit-extension.ts`       | Add encrypted field names to `SCRUB_FIELDS`; **Ask-before file**    |
| `tests/contracts/audit-scrub.test.ts` | Add those names to the membership assertion                         |
| `prisma/schema.prisma` + migration    | The encrypted `String?` column(s)                                   |
| `docs/decisions/ADR-0XX-*.md`         | **New** — run `/adr` (ADR-001 migration trigger)                    |
| `.env.example`                        | `FIELD_ENCRYPTION_KEY` (+ `FIELD_ENCRYPTION_KEY_PREV` for rotation) |
| `SECURITY.md`                         | §1 + §4 rows below                                                  |

> Touches `lib/prisma/*` and an "Ask before" boundary — run `/code-review`, `/ship`.

## Key rotation

The envelope carries a `keyId`, so rotation is gradual:

1. Generate a new key. Move the current `FIELD_ENCRYPTION_KEY` value to
   `FIELD_ENCRYPTION_KEY_PREV` and add it to `KEYS` under id `"prev"` (the loader
   already does this); set the new key as `FIELD_ENCRYPTION_KEY` (id `"0"`).
   _(Adjust `PRIMARY_KEY_ID`/key-id mapping so new writes use the new key while old
   ciphertext with the prior `keyId` still decrypts.)_
2. Run a one-off re-encrypt job: `findMany` each model with encrypted fields (decrypts
   via `prev`), then `update` each row (re-encrypts via the primary) — the extension
   handles both directions transparently.
3. Once every row is re-encrypted, drop `FIELD_ENCRYPTION_KEY_PREV` from the env.
4. Record the rotation in **SECURITY.md §6 rotation log**.

## Env vars

```bash
FIELD_ENCRYPTION_KEY="<base64 32 bytes>"          # Restricted
FIELD_ENCRYPTION_KEY_PREV="<old base64 key>"      # Restricted, only during rotation
```

## How to test

1. Set `FIELD_ENCRYPTION_KEY`, `prisma:migrate`, create a `Vendor` with an
   `apiToken`. Query the raw DB (`psql` / Neon console): the column holds
   `v1:0:...:...:...` ciphertext — **not** the plaintext.
2. Read the vendor through `prisma.vendor.findUnique` → `apiToken` is the original
   plaintext (transparent decrypt). `findMany` decrypts each row.
3. **Tamper check:** flip a character in the stored ciphertext via raw SQL, then read
   through Prisma → the field comes back `null` (GCM auth-tag rejects it), not a
   garbage/partial value.
4. **Audit:** update the vendor and inspect `audit_logs` — the encrypted field shows
   `[redacted]` (because you added it to `SCRUB_FIELDS`), never plaintext.
5. `npm test` (scrub contract asserts the new field is in `SCRUB_FIELDS`) and `/ship`.

## Rollback

> Rollback is only safe **if no encrypted data must be retained**, or after you
> decrypt-in-place first.

1. (If keeping data) run a job that `findMany`s + re-`update`s each row through a
   client **without** the extension, writing back the decrypted plaintext — then the
   column is plain again.
2. Remove `encryptionExtension` from `lib/prisma.ts`.
3. Delete `lib/prisma/encryption-extension.ts` and `lib/crypto-field.ts`.
4. Remove the field names from `SCRUB_FIELDS` + the scrub test (only if they're no
   longer Restricted — usually they still are; leave them).
5. Remove `FIELD_ENCRYPTION_KEY*` from env. **Do not delete the key before
   decrypting** — the data is unrecoverable without it.

## SECURITY.md rows to add

**§1 Data classification** — add each encrypted column (e.g. `vendors.apiToken`) to
the **Restricted** row, noting "AES-256-GCM at rest (recipe shared-security/5)".

**§4 Encryption** — change the "Column encryption of Restricted fields" row from
"⚠️ None" to: "🟢 App-layer AES-256-GCM via `lib/crypto-field.ts` +
`encryptionExtension` (recipe shared-security/5). Key in `FIELD_ENCRYPTION_KEY`
(Restricted). Encrypted columns are **not queryable** — keep searchable fields out of
the encrypted set."

**§6 Secrets** — add `FIELD_ENCRYPTION_KEY` (Restricted; `openssl rand -base64 32`;
rotation re-encrypts — see recipe). **§16 row 5** → done.
