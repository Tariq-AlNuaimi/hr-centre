import { cva } from "class-variance-authority";

/**
 * Button styling, deliberately OUTSIDE the "use client" boundary.
 *
 * `buttonVariants` is a pure function of its arguments — it returns a class
 * string and touches nothing client-only. It lived in `button.tsx` by
 * colocation, which made it a CLIENT export, and Next 16 refuses a call to a
 * client function from the server: a React Server Component that styled a
 * `<Link>` as a button crashed at render with "Attempted to call
 * buttonVariants() from the server". Typecheck, lint, and the production build
 * all passed it; only loading the page found it.
 *
 * `button.tsx` re-exports this, so every existing import is unchanged.
 */
export const buttonVariants = cva(
  // `appearance-none` resets the native <button> UA chrome (outset border /
  // system appearance). Tailwind Preflight is intentionally OFF during the
  // AntD coexistence slice (C1), so its global border/appearance reset isn't
  // applied — every native-element components/ui/* primitive must compensate
  // locally until C4 enables Preflight. (senior-review 2026-07-02)
  "appearance-none inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        /*
          Hover DARKENS rather than fading. `hover:opacity-90` was the original,
          and an axe run at 2026-08-26 measured what it costs: `--brand-primary`
          (#0165ff) carries white at 4.88:1 and passes AA, but at 90% opacity over
          a light surface it composites to #1a74ff — **4.21:1, below the 4.5:1
          floor**. So the button met AA at rest and failed it under the pointer,
          on every primary button in the product.

`--primary-hover` darkens the SURFACE instead. Not `--primary-emphasis`, which
          was the obvious-looking reuse and is wrong: that token is brand-as-TEXT
          and its dark override lightens to royal-300, so a hovered button would
          put white on pale blue at 2.41:1 — worse than the bug. Measured, not
          assumed. Darkening works in both themes at once because `bg-primary` is
          the same royal in each; only text tokens flip. White now reads at 6.88:1
          hovered, so the state is MORE legible than at rest.

          It is also a better hover: fading a solid accent reads as the control
          becoming less available, which is the opposite of what hovering means.
        */
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "bg-muted text-foreground hover:bg-muted/70",
        outline: "border border-input bg-transparent text-foreground hover:bg-muted",
        ghost: "bg-transparent text-foreground hover:bg-muted",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "bg-transparent text-primary-emphasis underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-4",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
