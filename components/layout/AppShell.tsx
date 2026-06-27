import { getTranslations } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import type { Session } from "next-auth";
import { Link } from "@/i18n/navigation";
import { Wordmark } from "@/components/brand/Wordmark";
import { SidebarNav } from "./SidebarNav";
import { MobileSidebar } from "./MobileSidebar";
import { LocaleToggle } from "./LocaleToggle";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

// The manager/admin app shell (UI-SPEC Part D): persistent left nav (collapsing
// to a drawer on mobile), a top bar with org + EN/AR + theme + user, and a
// 1200px content column. RTL mirrors the whole layout via logical properties.
export async function AppShell({
  session,
  orgName,
  children,
}: {
  session: Session;
  orgName: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations("shell");
  const tNav = await getTranslations("nav");
  const isAdmin = session.user.role === "HR_ADMIN";
  const roleLabel = isAdmin ? t("roleHrAdmin") : t("roleHiringManager");

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/app" aria-label="Rihal Aptitude">
            <Wordmark />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav isAdmin={isAdmin} />
        </div>
        <div className="border-t border-sidebar-border p-4">
          <Link
            href="/methodology"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-accent hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {tNav("methodology")}
          </Link>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
          <MobileSidebar isAdmin={isAdmin} />
          <div className="lg:hidden">
            <Wordmark showText={false} />
          </div>
          <span className="truncate font-display text-sm font-semibold text-foreground">
            {orgName}
          </span>
          <div className="ms-auto flex items-center gap-1">
            <LocaleToggle />
            <ThemeToggle />
            <UserMenu
              name={session.user.name ?? session.user.email}
              email={session.user.email}
              roleLabel={roleLabel}
            />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1200px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
