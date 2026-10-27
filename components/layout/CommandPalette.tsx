"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { User, Lightbulb, LogOut, Search, UserRound } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";
import { paletteItems } from "@/lib/nav/resolve";
import { navIcon, useLocaleHref, useNavContext, useNavLabel } from "./use-nav-context";

type PersonHit = { id: string; name: string; email: string | null; jobTitle?: string | null };

/** Debounce a value (people search waits for the typing to pause). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// Custom event the header search button dispatches to open the palette without
// a shared context (keeps the trigger decoupled from the modal mount point).
export const OPEN_COMMAND_PALETTE = "open-command-palette";

type Command = {
  key: string;
  label: string;
  group: "people" | "navigate" | "actions";
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
  keywords?: string;
};

/**
 * ⌘K / Ctrl+K command palette + global search. Mounted once in AppShell; opens
 * on the shortcut OR an OPEN_COMMAND_PALETTE window event (the header button).
 * Searches every destination in the ONE nav config (lib/nav/config.ts — the
 * same entries and tabs the sidebar shows this viewer), people by name / email /
 * employee ID (the directory API, so scoping is the server's), and quick actions. Fully
 * keyboard-driven (↑/↓ to move, Enter to run, Esc to close).
 */
export function CommandPalette() {
  const t = useTranslations("chrome");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const { isDark, setMode } = useTheme();
  const ctx = useNavContext();
  const navLabel = useNavLabel();
  const localeHref = useLocaleHref();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback(
    (path: string) => {
      router.push(path);
      close();
    },
    [router, close],
  );

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      ...paletteItems(ctx).map((item) => {
        const label = navLabel(item);
        const parent = item.parent ? navLabel(item.parent) : undefined;
        return {
          key: `nav-${item.key}`,
          label,
          hint: parent,
          keywords: parent,
          group: "navigate" as const,
          icon: navIcon(item.icon),
          run: () => go(localeHref(item.href)),
        };
      }),
      {
        key: "profile",
        label: tNav("profile"),
        group: "navigate",
        icon: <User className="h-4 w-4" />,
        run: () => go(`/${locale}/settings/profile`),
      },
    ];
    const actions: Command[] = [
      {
        key: "toggle-theme",
        label: t("actionToggleTheme"),
        group: "actions",
        icon: <Lightbulb className="h-4 w-4" />,
        run: () => {
          setMode(isDark ? "light" : "dark");
          close();
        },
      },
      {
        key: "logout",
        label: t("actionLogout"),
        group: "actions",
        icon: <LogOut className="h-4 w-4" />,
        run: () => signOut({ callbackUrl: `/${locale}/login` }),
      },
    ];
    return [...nav, ...actions];
  }, [ctx, navLabel, localeHref, tNav, t, locale, go, setMode, isDark, close]);

  // People: the directory API (scoped server-side to whom this viewer may see),
  // at most 6 hits, once the query has 2+ characters and typing has paused.
  const personQuery = useDebounced(query.trim(), 250);
  const people = useQuery({
    queryKey: ["palette", "people", personQuery],
    queryFn: ({ signal }) =>
      apiClient.get<{ data: PersonHit[] }>(
        `/api/employees?pageSize=6&search=${encodeURIComponent(personQuery)}`,
        { signal },
      ),
    enabled: open && personQuery.length >= 2,
    staleTime: 30_000,
    retry: false,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const personHits: Command[] =
      q.length >= 2
        ? (people.data?.data ?? []).map((p) => ({
            key: `person-${p.id}`,
            label: p.name,
            hint: p.jobTitle ?? p.email ?? undefined,
            group: "people" as const,
            icon: <UserRound className="h-4 w-4" />,
            run: () => go(`/${locale}/people/${p.id}`),
          }))
        : [];
    const matches = q
      ? commands.filter(
          (c) => c.label.toLowerCase().includes(q) || c.keywords?.toLowerCase().includes(q),
        )
      : commands;
    return [...personHits, ...matches];
  }, [commands, query, people.data, go, locale]);

  // Clamp during render (not an effect) so the highlight stays in range as the
  // filtered list shrinks — no cascading-render setState.
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));

  // Global open shortcut + the header-button event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen);
    };
  }, []);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[activeIndex]?.run();
    }
  };

  const groups: { id: Command["group"]; label: string }[] = [
    { id: "people", label: t("groupPeople") },
    { id: "navigate", label: t("groupNavigate") },
    { id: "actions", label: t("groupActions") },
  ];

  // A stable, flat index across groups so ↑/↓ highlight maps to `filtered`.
  let runningIndex = -1;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent hideClose className="max-w-[560px] gap-0 overflow-hidden p-0">
        {/* Radix requires a labelled title for the dialog; the palette is
            visually title-less, so it's screen-reader-only. */}
        <DialogTitle className="sr-only">{t("commandPlaceholder")}</DialogTitle>

        <div>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              // Keydown lives on the native input (which always holds focus in
              // this search-first palette) rather than a static wrapper div, so
              // ↑/↓/Enter navigation carries no non-interactive-element handler.
              onKeyDown={onListKeyDown}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- command palette is a search-first modal; the APG dialog pattern moves focus to the search input on open
              autoFocus
              placeholder={t("commandPlaceholder")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              className="h-12 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="max-h-90 overflow-y-auto p-2">
            {filtered.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {people.isFetching ? t("searchingPeople") : t("noResults")}
              </div>
            )}

            {groups.map((g) => {
              const items = filtered.filter((c) => c.group === g.id);
              if (items.length === 0) return null;
              return (
                <div key={g.id} className="mb-2">
                  <div className="px-3 py-1 text-xs uppercase tracking-[0.04em] text-muted-foreground">
                    {g.label}
                  </div>
                  {items.map((c) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        // Roving focus stays on the input (combobox pattern): the
                        // rows are pointer targets, not tab stops, so ↑/↓/Enter on
                        // the focused input always drives selection. Without this,
                        // a Tab into a row would strand arrow-key navigation.
                        tabIndex={-1}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => c.run()}
                        className={cn(
                          "flex w-full appearance-none items-center gap-3 rounded-md px-3 py-3 text-start text-sm text-foreground outline-none",
                          isActive ? "bg-muted" : "bg-transparent",
                        )}
                      >
                        <span className="inline-flex text-muted-foreground">{c.icon}</span>
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {c.hint ? (
                          <span className="shrink-0 text-xs text-muted-foreground">{c.hint}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
