import { brand } from "@/brand.config";

/**
 * Split-screen auth shell: a branded panel beside the form. The panel carries
 * the brand gradient + mark + value line (white-labelled from brand.config); it
 * collapses on small screens so the form stays front-and-centre on mobile.
 * Tokens only — gradient is the primary token faded (no raw hex).
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="auth-brand-panel flex flex-1 flex-col justify-between bg-gradient-to-br from-primary to-primary/80 p-12 text-primary-foreground">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex size-9 items-center justify-center rounded-md bg-primary-foreground/15 text-lg font-bold text-primary-foreground"
          >
            {brand.monogram}
          </span>
          <span className="text-lg font-bold text-primary-foreground">
            {brand.appName}
          </span>
        </div>

        <div className="max-w-[440px]">
          {/* h2, not h1: the form card's title (login/forgot/reset) is the page's
              sole <h1>. This brand-panel heading is secondary chrome. */}
          <h2 className="mb-3 text-h2 font-bold text-primary-foreground">
            {brand.appName}
          </h2>
          <p className="m-0 text-base text-primary-foreground/80">
            {brand.description}
          </p>
        </div>

        <p className="m-0 text-sm text-primary-foreground/60">
          © {brand.appName}
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center bg-background p-6">
        {children}
      </main>
    </div>
  );
}
