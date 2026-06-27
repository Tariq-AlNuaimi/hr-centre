import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";

// Server-side gating helpers (UI-SPEC E: "Role-gating enforced server-side, not
// just hidden nav"). Pages call these; middleware is the first gate, these are
// defense-in-depth + the role check.

export async function requireSession(locale: string): Promise<Session> {
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);
  return session;
}

export async function requireAdmin(locale: string): Promise<Session> {
  const session = await requireSession(locale);
  if (session.user.role !== "HR_ADMIN") redirect(`/${locale}/app`);
  return session;
}

export function isAdmin(session: Session | null): boolean {
  return session?.user.role === "HR_ADMIN";
}
