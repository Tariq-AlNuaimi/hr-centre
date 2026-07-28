import { AsyncLocalStorage } from "node:async_hooks";

export interface AuditContext {
  userId?: string;
  /**
   * Immutable actor label written onto every audit row alongside `userId`.
   * The FK is `onDelete: SetNull`, so attribution that depends on the User row
   * still existing is erasable by deleting that user — this is not.
   * Confidential (SECURITY.md §1).
   */
  actorEmail?: string;
  ipAddress?: string;
  userAgent?: string;
}

export const auditStorage = new AsyncLocalStorage<AuditContext>();

// ipAddress / userAgent are header-derived (client-influenced). Cap their length
// before they reach the DB so a request with a multi-kilobyte User-Agent (or a
// crafted x-forwarded-for chain) can't bloat audit_logs row-by-row. An IPv6
// address with zone id fits in 64; real User-Agents are well under 512.
const MAX_IP_LEN = 64;
const MAX_UA_LEN = 512;

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export function withAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  const bounded: AuditContext = {
    ...ctx,
    ipAddress: truncate(ctx.ipAddress, MAX_IP_LEN),
    userAgent: truncate(ctx.userAgent, MAX_UA_LEN),
  };
  return auditStorage.run(bounded, fn);
}

export function getAuditContext(): AuditContext {
  return auditStorage.getStore() ?? {};
}
