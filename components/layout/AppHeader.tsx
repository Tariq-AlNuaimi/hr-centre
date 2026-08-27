"use client";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { User, LogOut, Sun, Moon, Globe, Search } from "lucide-react";
import { OrgSwitcher } from "./OrgSwitcher";
import { NotificationsMenu } from "./NotificationsMenu";
import { OPEN_COMMAND_PALETTE } from "./CommandPalette";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "./ThemeProvider";
import { hasMultipleLocales, localePrefixRegex, nextLocale } from "@/i18n/config";

// Native names for the locales we ship; falls back to the uppercased code so an
// unmapped locale still gets a sensible switcher label.
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  ar: "العربية",
};

export function AppHeader() {
  const t = useTranslations("nav");
  const tTheme = useTranslations("theme");
  const tChrome = useTranslations("chrome");
  const { data: session } = useSession();
  const { isDark, setMode } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale();

  const target = nextLocale(currentLocale);
  const switchLocale = () => {
    const newPath = pathname.replace(localePrefixRegex, `/${target}`);
    router.push(newPath);
  };

  const displayName = session?.user?.name ?? session?.user?.email;

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b border-border bg-card px-4 sm:px-6">
      {/* Absorbs the width pressure instead of the controls on the right: it has
          a label that can truncate, and they do not. */}
      <div className="min-w-0 flex-1">
        <OrgSwitcher />
      </div>

      {/*
        `shrink-0`, NOT `min-w-0`. The first attempt put `min-w-0` here so the
        header could fit at 375px, and it worked by letting these icon buttons
        squeeze: the notifications and theme controls measured 16px WIDE by 36
        tall — the icon with every scrap of padding crushed out of it, and a touch
        target well under the 24px WCAG 2.2 floor. The row that should absorb the
        pressure is the workspace switcher on the left, which has text to truncate;
        these are fixed-size controls and must keep their size.
      */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <Button
          variant="outline"
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
          aria-label={tChrome("openCommand")}
          className="justify-start gap-2 px-3 text-muted-foreground"
        >
          <Search className="h-4 w-4" />
          <span className="header-search-label">{tChrome("search")}</span>
          <kbd className="header-search-kbd">⌘K</kbd>
        </Button>

        <NotificationsMenu />

        {hasMultipleLocales && (
          <Button
            variant="ghost"
            onClick={switchLocale}
            title={LOCALE_LABELS[target] ?? target.toUpperCase()}
            className="gap-2"
          >
            <Globe className="h-4 w-4" />
            {target.toUpperCase()}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMode(isDark ? "light" : "dark")}
          title={isDark ? tTheme("light") : tTheme("dark")}
          aria-label={tTheme("toggle")}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              /*
                The label has to be here because the visible one is hidden below
                640px (just below). Hiding it was the right call for the layout and
                it left this button with an avatar icon and NO accessible name —
                axe scores that `button-name`, critical, and it was introduced by
                the very fix that solved the overflow. A visual change that removes
                the only text in a control is an accessibility change too.
              */
              aria-label={displayName ?? tChrome("account")}
              className="flex items-center gap-2 rounded-md px-1 py-1 text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar>
                {session?.user?.image && (
                  <AvatarImage src={session.user.image} alt={displayName ?? ""} />
                )}
                <AvatarFallback>
                  <User className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              {/*
                Hidden below 640px — the avatar carries the identity there, and the
                name is the first thing in the menu this button opens, so nothing is
                lost. Measured: at 375px the header's right-hand cluster ran to
                436px against a 375px viewport, and this label plus its gap was the
                61px of it. The search label and ⌘K hint already collapse at 575px
                (app/globals.css); this was the piece that did not.
              */}
              <span className="hidden text-sm sm:inline">{displayName}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push(`/${currentLocale}/settings/profile`)}>
              <User />
              {t("profile")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut({ callbackUrl: `/${currentLocale}/login` })}>
              <LogOut />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
