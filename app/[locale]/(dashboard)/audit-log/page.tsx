// Server component: gate the audit-log shell to ADMIN on the server (SR-L3).
// The GET /api/audit-log endpoint already wraps with withAdminAuth, so a
// non-admin could never read the data -- but without this gate the page chrome
// (filters, empty table) still renders for them before the failing fetch. The
// dashboard home (page.tsx) gates the same way; this matches that pattern.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AuditLogClient from "./AuditLogClient";

export default async function AuditLogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    // Send non-admins back to the locale-prefixed dashboard root (mirrors
    // app/page.tsx's redirect; the prefix avoids a middleware re-loop).
    redirect(`/${locale}`);
  }
  return <AuditLogClient />;
}
