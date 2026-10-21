import { del, issueSignedToken, presignUrl } from "@vercel/blob";

/**
 * The ONLY module that talks to blob storage.
 *
 * It exists so that `access: "private"` is written once. The `/scale-up`
 * recipe this replaces hardcoded `access: "public"`, which for performance
 * evidence would mint a permanent unauthenticated handle to a Confidential
 * record (SECURITY.md §1) — and a public URL cannot be un-published once it
 * has been copied. Centralising the call means no later caller gets to choose.
 *
 * Nothing here decides WHO may read: `canViewEmployee` does that in the route,
 * before any function in this file runs. A signed URL is the last step of an
 * authorised read, never the authorisation itself.
 *
 * Build-vs-buy: `docs/build-vs-buy-ledger.md`, 2026-10-20.
 */

/** Short. A forwarded link should die long before anyone can use it. */
export const SIGNED_URL_TTL_SECONDS = 300;

/** The env var Vercel injects when a Blob store is attached to the project. */
const TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "File storage is not configured for this environment, so evidence files cannot be " +
        "uploaded or opened. Create a Blob store on the Vercel project — it sets " +
        "BLOB_READ_WRITE_TOKEN automatically — and redeploy. Links work without it.",
    );
    this.name = "StorageNotConfiguredError";
  }
}

/**
 * Is storage usable at all?
 *
 * Checked explicitly so the UI can say "files are unavailable, links still
 * work" instead of failing an upload with a stack trace. A feature that half
 * works and says which half beats one that merely looks broken — and on this
 * rail the store is created by a human in a dashboard, so "not yet configured"
 * is an ordinary state rather than an error.
 */
export function isStorageConfigured(): boolean {
  return (process.env[TOKEN_ENV] ?? "").length > 0;
}

function requireToken(): string {
  const token = process.env[TOKEN_ENV];
  if (!token) throw new StorageNotConfiguredError();
  return token;
}

/**
 * Where one employee's evidence lives.
 *
 * `unique` comes from `crypto.randomUUID()` at the call site, so two files of
 * the same name on one KPI cannot collide. Unguessability is not the control —
 * the store is private and every read is checked — but a pathname that reaches
 * a log should not also be a map of the record it belongs to.
 */
export function evidencePrefix(participantId: string, kpiId: string): string {
  return `year-end/${participantId}/${kpiId}/`;
}

/**
 * Is the pathname the CLIENT asked to write to one this employee may write to?
 *
 * This matters more than it looks. In Vercel's client-upload protocol the
 * browser proposes the pathname and the server only approves a token for it —
 * so without this check an employee could request a token for
 * `year-end/<someone-else's-participant>/…` and write into another person's
 * evidence. The server authorised a KPI; it must therefore pin the location to
 * that KPI rather than accept whatever came with the request.
 *
 * Combined with `addRandomSuffix: true` at the call site, two uploads cannot
 * collide or overwrite each other either.
 */
export function isWithinEvidencePrefix(params: {
  pathname: string;
  participantId: string;
  kpiId: string;
}): boolean {
  const prefix = evidencePrefix(params.participantId, params.kpiId);
  if (!params.pathname.startsWith(prefix)) return false;
  const rest = params.pathname.slice(prefix.length);
  // One segment, no traversal, and a name we are willing to put on disk.
  return rest.length > 0 && rest.length <= 160 && /^[a-zA-Z0-9._-]+$/.test(rest);
}

/**
 * One token, many pathnames — read-only, expiring in `SIGNED_URL_TTL_SECONDS`.
 *
 * `issueSignedToken` calls the Blob control API, so it is the slow half: a
 * route serving a KPI's worth of evidence issues ONE token and presigns each
 * pathname against it. `presignUrl` itself is local.
 *
 * The shapes here were read off the package's own types rather than its prose
 * docs, which describe an older signature: the token comes FIRST, `validUntil`
 * is epoch milliseconds rather than a `Date`, the operation list is
 * `operations`, and `presignUrl` returns `{ presignedUrl }` rather than a bare
 * string. Guessing any one of those compiles into a runtime failure on a path
 * this container cannot exercise.
 */
export async function signedReadUrls(pathnames: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (pathnames.length === 0) return out;

  const validUntil = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
  const signed = await issueSignedToken({
    token: requireToken(),
    // `get` ONLY. A token that could also put or delete would turn a read
    // route into a write one for anyone who intercepted the URL.
    operations: ["get"],
    validUntil,
  });

  for (const pathname of pathnames) {
    const { presignedUrl } = await presignUrl(signed, {
      pathname,
      operation: "get",
      access: "private",
      validUntil,
    });
    out.set(pathname, presignedUrl);
  }
  return out;
}

/** The single-pathname form, for opening one item. */
export async function signedReadUrl(pathname: string): Promise<string> {
  const urls = await signedReadUrls([pathname]);
  const url = urls.get(pathname);
  if (!url) throw new Error(`Could not sign a URL for ${pathname}`);
  return url;
}

/**
 * Read back the first bytes of a stored file, plus its TRUE size.
 *
 * Exists so the one caller that verifies an upload does not also have to own a
 * signed read, a Range request, a response-status check and the parsing of a
 * `Content-Range` header — all of which are storage's business, not §7.1's.
 *
 * `null` means "could not be read", deliberately collapsing every cause: a
 * refused signature, a propagation delay, a network error. The caller's correct
 * response is the same in each case and must not be to carry on, because an
 * error document read as the file would sniff as a mismatch for every binary
 * type (deleting a file the employee legitimately uploaded) and PASS for every
 * text one.
 *
 * 64 bytes is enough for every signature on the allowlist, and bounds this to
 * a constant read regardless of the file's size.
 */
export async function readStoredHead(
  pathname: string,
): Promise<{ bytes: Uint8Array; sizeBytes: number } | null> {
  try {
    const res = await fetch(await signedReadUrl(pathname), {
      headers: { Range: "bytes=0-63" },
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // `bytes 0-63/12345` — the total after the slash is the stored length, which
    // is the only trustworthy size here: everything else was claimed by the
    // browser. A store that reports no range leaves the caller its fallback.
    const total = Number(res.headers.get("content-range")?.split("/")[1]);
    return { bytes, sizeBytes: Number.isFinite(total) && total > 0 ? total : bytes.byteLength };
  } catch {
    return null;
  }
}

/** Remove the bytes. The row is soft-deleted separately and keeps the record. */
export async function deleteStoredFile(pathname: string): Promise<void> {
  await del(pathname, { token: requireToken() });
}
