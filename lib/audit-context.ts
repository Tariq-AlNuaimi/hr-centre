import { AsyncLocalStorage } from "node:async_hooks";

export interface AuditContext {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export const auditStorage = new AsyncLocalStorage<AuditContext>();

export function withAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return auditStorage.run(ctx, fn);
}

export function getAuditContext(): AuditContext {
  return auditStorage.getStore() ?? {};
}
