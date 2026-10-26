/**
 * The shell for pages an employee opens without an account.
 *
 * Deliberately empty of chrome. The dashboard layout beside it carries a
 * sidebar, a user menu and a sign-out control — every one of which is wrong on a
 * surface where there is no account to sign out of, and two of which would leak
 * the existence of the HR "private door" (§5.2) onto a page a QR code points at.
 *
 * Since ADR-075 the only page in it is ADR-070's reply link (`/reply/[token]`);
 * employees ask questions in Siraaj.
 */
export default function HiveEmployeeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
