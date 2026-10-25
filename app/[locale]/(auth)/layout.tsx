import { brand } from "@/brand.config";

/**
 * Split-screen auth shell: a branded panel beside the form. The panel carries
 * the brand mark + value line (white-labelled from brand.config); it collapses
 * on small screens so the form stays front-and-centre on mobile.
 *
 * SOLID `bg-primary`, and every foreground at full opacity, for WCAG AA.
 * This used to be `bg-gradient-to-br from-primary to-primary/80` with the
 * supporting copy at /80 and /60. An axe pass could not score it — a gradient
 * background makes contrast indeterminate, so both lines came back `incomplete`
 * rather than as violations, which is how they survived. Measured by sampling
 * the rendered pixels, the worst case was 3.17:1 for the value line and 2.26:1
 * for the copyright against a 4.5:1 requirement; the gradient's `/80` end fades
 * toward the page background, so the panel is LIGHTEST exactly where the
 * smallest text sits. Raising the opacities alone does not fix it (white at /80
 * on solid primary is 3.60:1) — the fade and the alpha both had to go.
 *
 * White on solid `--primary` (#0f766e, platform teal) is 5.47:1, which clears AA for normal
 * text. Hierarchy is carried by size and weight instead of transparency, which
 * is what the brand contract asks for anyway: "ONE accent, solid — no gradient
 * on product surfaces". Any fork changing `brand.colors.primary` to a lighter
 * hue must re-check this panel.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="auth-brand-panel flex flex-1 flex-col justify-between bg-primary p-12 text-primary-foreground">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex size-9 items-center justify-center rounded-md bg-primary-foreground/15 text-lg font-bold text-primary-foreground"
          >
            {brand.monogram}
          </span>
          <span className="text-lg font-bold text-primary-foreground">{brand.appName}</span>
        </div>

        <div className="max-w-[440px]">
          {/* h2, not h1: the form card's title (login/forgot/reset) is the page's
              sole <h1>. This brand-panel heading is secondary chrome. */}
          <h2 className="mb-3 text-h2 font-bold text-primary-foreground">{brand.appName}</h2>
          <p className="m-0 text-base text-primary-foreground">{brand.description}</p>
        </div>

        <p className="m-0 text-sm text-primary-foreground">© {brand.appName}</p>
      </aside>

      <main className="flex flex-1 items-center justify-center bg-background p-6">{children}</main>
    </div>
  );
}
