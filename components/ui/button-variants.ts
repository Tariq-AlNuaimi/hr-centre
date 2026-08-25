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
        default: "bg-primary text-primary-foreground hover:opacity-90",
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
