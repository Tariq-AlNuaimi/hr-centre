import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/authz";
import { AppShell } from "@/components/layout/AppShell";

// Authenticated app surface. Middleware is the first auth gate; requireSession
// is defense-in-depth and gives us the typed session for the shell.
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireSession(locale);

  const org = session.user.orgId
    ? await prisma.organization.findUnique({
        where: { id: session.user.orgId },
        select: { name: true },
      })
    : null;

  return (
    <AppShell session={session} orgName={org?.name ?? "Rihal"}>
      {children}
    </AppShell>
  );
}
