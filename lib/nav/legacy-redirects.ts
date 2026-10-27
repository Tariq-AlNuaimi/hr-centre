/**
 * Old page URLs that moved, mapped to their new homes (next.config.ts
 * `redirects()`). The HR tickets screens left `/hive/*` in UX P1
 * (docs/blueprints/ux-p1-nav.md AC-6.1); the public reply link and the
 * `/api/hive/*` routes did not move and are deliberately absent.
 * Order matters: Next applies the first match.
 */
const MOVES: ReadonlyArray<[from: string, to: string]> = [
  ["/hive/escalations/:id", "/tickets/:id"],
  ["/hive/escalations", "/tickets"],
  ["/hive/reports", "/tickets/reports"],
  ["/hive/settings", "/tickets/setup/settings"],
  ["/hive/email-template", "/tickets/setup/email-template"],
  ["/hive/pairs", "/tickets/setup/pairs"],
  ["/hive/rotation", "/tickets/setup/rotation"],
  ["/hive/discounts", "/tickets/setup/discounts"],
  ["/hive/providers", "/tickets/setup/providers"],
  ["/hive/org-details", "/tickets/setup/org-details"],
  ["/hive", "/tickets/setup"],
];

export type Redirect = { source: string; destination: string; permanent: true };

export function legacyRedirects(): Redirect[] {
  // Any two-letter locale: next.config cannot resolve the `@/` alias that
  // i18n/config uses, and a redirect for a locale the app does not serve just
  // lands on next-intl's own not-found.
  const localePart = "/:locale([a-z]{2})";
  return MOVES.flatMap(([from, to]) => [
    { source: `${localePart}${from}`, destination: `/:locale${to}`, permanent: true as const },
    { source: from, destination: to, permanent: true as const },
  ]);
}
