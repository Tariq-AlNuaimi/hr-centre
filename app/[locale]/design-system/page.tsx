"use client";

// Manzil · Design System — the branded design-system showcase (blueprint:
// docs/blueprints/design-system-showcase.md). A full-bleed, on-stack rendering of
// the Rihal Design System: it IS the running design system, not a picture of it.
// Every value shown as text is READ from the token source (brand.config.ts), so
// nothing drifts. Full-bleed by design — it lives outside the (dashboard) group,
// so no AppShell; it brings its own top bar + section nav + theme toggle. Copy is
// hardcoded (a dev/design reference, exempt from next-intl — same carve-out as
// /style-guide); everything it demonstrates flows through tokens + shared
// components. Sections live in ./sections + ./panels (kept small per file).

import { useEffect, useState } from "react";
import { brand } from "@/brand.config";
import { useTheme } from "@/components/layout/ThemeProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { AiMark } from "@/components/shared/ai";
import {
  Eyebrow,
  NetworkMotif,
  ContractReviewCard,
  WhySection,
  ColorSection,
  TypeSection,
} from "./sections";
import { ComponentsSection, AiPatternsSection, AdoptionSection } from "./panels";

const NAV_LINK =
  "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground";

export default function DesignSystemShowcase() {
  const { isDark, setMode } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3.5 border-b border-border bg-background/80 px-5 backdrop-blur sm:px-8">
        <span className="text-sm font-bold tracking-tight text-foreground">{brand.appName}</span>
        <span className="h-5 w-px bg-border" />
        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Manzil · Design System
        </span>
        <div className="ms-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-muted px-3 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-primary-emphasis">
              <AiMark size={16} className="bg-transparent" />
            </span>
            Ask anything
            <kbd className="rounded border border-border px-1 font-mono text-xs leading-4">⌘K</kbd>
          </button>
          <div className="inline-flex rounded-full border border-border bg-muted p-0.5">
            {(["light", "dark"] as const).map((t) => {
              const active = t === "dark" ? isDark : !isDark;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setMode(t)}
                  className={
                    "rounded-full px-3 py-1 text-xs font-semibold capitalize " +
                    (active ? "bg-primary text-primary-foreground" : "text-foreground")
                  }
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ── Section nav ── */}
      <nav className="sticky top-14 z-20 flex gap-1 overflow-x-auto border-b border-border bg-background/80 px-5 py-2 backdrop-blur sm:px-8">
        <a href="#foundations" className={NAV_LINK}>
          Foundations
        </a>
        <a href="#components" className={NAV_LINK}>
          Components
        </a>
        <a
          href="#ai"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary-emphasis"
        >
          ✦ AI patterns
        </a>
        <a href="#adopt" className={NAV_LINK}>
          Adoption
        </a>
      </nav>

      {/* ── Living hero ── */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="mx-auto grid max-w-[1120px] items-center gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          <NetworkMotif />
          <div className="relative">
            <div className="mb-4 inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <Eyebrow>One operating fabric for every Rihal tool</Eyebrow>
            </div>
            <h1
              className="m-0 font-bold tracking-tight text-foreground"
              style={{ fontSize: "clamp(34px, 5vw, 56px)", lineHeight: 1.02 }}
            >
              Every app,
              <br />
              one intelligent
              <br />
              surface.
            </h1>
            <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
              Calm, dense, operational — built on Tailwind v4, shadcn/ui and the shared primitives.
              One accent, honest states, and AI woven into the surface, not bolted on. This is the
              contract the template ships and every portal adopts.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Button onClick={() => setPaletteOpen(true)}>✦ Try the command bar</Button>
              <a href="#ai" className={buttonVariants({ variant: "outline" })}>
                See the AI patterns
              </a>
            </div>
          </div>
          <div className="relative">
            <ContractReviewCard />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1120px] px-5 pt-14 pb-24 sm:px-8">
        <WhySection />
        <div id="foundations" className="scroll-mt-32" />
        <ColorSection />
        <TypeSection />
        <div id="components" className="scroll-mt-32" />
        <ComponentsSection />
        <div id="ai" className="scroll-mt-32" />
        <AiPatternsSection />
        <div id="adopt" className="scroll-mt-32" />
        <AdoptionSection />
      </main>

      {/* ── Command palette overlay ── */}
      {paletteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm"
          style={{ paddingTop: "14vh" }}
        >
          <button
            type="button"
            aria-label="Close command palette"
            className="absolute inset-0 cursor-default"
            onClick={() => setPaletteOpen(false)}
          />
          <div
            className="relative w-[min(560px,92vw)] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
              <AiMark size={18} className="bg-transparent" />
              <span className="flex-1 text-sm text-muted-foreground">
                Ask anything, or jump to…
              </span>
              <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                esc
              </kbd>
            </div>
            <div className="p-1.5">
              {[
                { icon: "✦", label: "Summarise open approvals for RHL", tag: "AI", brand: true },
                { icon: "↗", label: "Go to Candidates" },
                { icon: "＋", label: "New contract" },
                {
                  icon: "◐",
                  label: "Toggle dark mode",
                  onClick: () => setMode(isDark ? "light" : "dark"),
                },
              ].map((it) => (
                <button
                  key={it.label}
                  type="button"
                  onClick={() => {
                    it.onClick?.();
                    setPaletteOpen(false);
                  }}
                  className={
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-start text-sm " +
                    (it.brand
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted")
                  }
                >
                  <span className={it.brand ? "text-primary-emphasis" : ""}>{it.icon}</span>
                  {it.label}
                  {it.tag ? (
                    <span className="ms-auto text-xs text-muted-foreground">{it.tag}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
