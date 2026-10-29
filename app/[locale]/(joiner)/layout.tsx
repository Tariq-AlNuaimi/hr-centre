/**
 * P2-4 — the joiner's public surface (ADR-093): no dashboard shell, no
 * navigation, nothing that assumes an account.
 */
export default function JoinerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
