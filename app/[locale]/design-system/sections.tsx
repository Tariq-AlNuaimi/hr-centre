// Presentational pieces of the Manzil design-system showcase (see page.tsx +
// docs/blueprints/design-system-showcase.md). Split out of the route so no single
// file blows the complexity budget; markup is unchanged. All values shown as text
// are READ from the token source (brand.config.ts).
import * as React from "react";
import { brand } from "@/brand.config";
import { Badge } from "@/components/ui/badge";
import { AiMark } from "@/components/shared/ai";

// One number drives every confidence read on the page (bar + label + chip).
export const CONFIDENCE = 0.86;
const RECOMMENDATION =
  "Replace with a mutual renewal clause requiring the written consent of both parties.";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-bold uppercase tracking-[0.14em] text-primary-emphasis">
      {children}
    </div>
  );
}

export function SectionHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-2.5 mb-2 text-h2 font-bold tracking-tight text-foreground">{title}</h2>
      {children ? (
        <p className="m-0 max-w-[64ch] text-base text-muted-foreground">{children}</p>
      ) : null}
    </div>
  );
}

// A network motif echoing the "one operating fabric" idea. Decorative.
export function NetworkMotif() {
  return (
    <svg
      viewBox="0 0 400 360"
      aria-hidden
      className="pointer-events-none absolute -end-8 -top-6 h-[360px] w-[400px] max-w-[46vw] text-primary opacity-80"
    >
      <g stroke="currentColor" strokeWidth={2} opacity={0.28}>
        <line x1="150" y1="70" x2="250" y2="60" />
        <line x1="250" y1="60" x2="300" y2="150" />
        <line x1="150" y1="70" x2="180" y2="180" />
        <line x1="180" y1="180" x2="300" y2="150" />
        <line x1="180" y1="180" x2="120" y2="250" />
        <line x1="180" y1="180" x2="270" y2="250" />
        <line x1="300" y1="150" x2="270" y2="250" />
      </g>
      <g fill="currentColor">
        {[
          [250, 60, 18],
          [150, 70, 11],
          [300, 150, 9],
          [180, 180, 20],
          [120, 250, 13],
          [270, 250, 24],
        ].map(([cx, cy, r], i) => (
          <circle key={i} cx={cx} cy={cy} r={r} opacity={0.55} />
        ))}
      </g>
    </svg>
  );
}

// The hero's live AI contract-review card — an advisory frame with a confidence
// bar bound to the SAME number as its label (never a fake "streaming" claim).
export function ContractReviewCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <AiMark size={26} />
        <span className="text-sm font-semibold text-foreground">AI contract review</span>
        <Badge variant="outline" className="ms-auto">
          Advisory
        </Badge>
      </div>
      <div className="p-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Term &amp; Renewal</span>
          <Badge variant="warning">Medium risk</Badge>
          <span className="ms-auto font-mono text-xs text-muted-foreground">Clause 3</span>
        </div>
        <div className="mb-3 rounded-md bg-muted p-2.5 font-mono text-xs leading-relaxed text-muted-foreground">
          “…shall automatically renew for successive periods of twelve (12) months…”
        </div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recommendation
        </div>
        <p className="m-0 mb-3.5 text-sm leading-relaxed text-foreground">{RECOMMENDATION}</p>
        <div className="mb-3.5 flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">Confidence</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round(CONFIDENCE * 100)}%` }}
              role="progressbar"
              aria-valuenow={Math.round(CONFIDENCE * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="AI confidence"
            />
          </div>
          <span className="font-mono text-xs text-primary-emphasis">{CONFIDENCE.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

export function WhySection() {
  return (
    <section className="mb-16">
      <SectionHead eyebrow="00 · Why this exists" title="Three apps, three accidental systems">
        The brand was never folded into the shared template, so every app re-derived it — or
        didn&apos;t. We converge on one contract.
      </SectionHead>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            mark: "bg-indigo-500",
            title: "The template",
            body: "Generic indigo on neutral grays. No Rihal brand baked in.",
          },
          {
            mark: "bg-primary",
            title: "HR Hub",
            body: "Re-derived the brand with a gradient + navy shell (AntD era). On-brand but bolted on.",
          },
          {
            mark: "bg-foreground",
            title: "Legal Ops / Staffing",
            body: "Full-dark hand-rolled CSS; Staffing went serif. Both drifted.",
          },
        ].map((c) => (
          <div key={c.title} className="rounded-lg border border-border bg-card p-4.5 shadow-sm">
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className={"h-5 w-5 rounded-md " + c.mark} />
              <span className="text-sm font-semibold text-foreground">{c.title}</span>
            </div>
            <p className="m-0 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

type Swatch = { name: string; sub: string; fill?: string; className?: string };

export function ColorSection() {
  // Fills + labels READ from the token source (no hand-typed hex).
  const swatches: Swatch[] = [
    { name: "Primary", sub: brand.colors.primary, fill: brand.colors.primary },
    {
      name: "Brand-as-text",
      sub: brand.colors.primaryEmphasis.light,
      fill: brand.colors.primaryEmphasis.light,
    },
    { name: "Brand soft", sub: "tint", className: "bg-primary/10" },
    { name: "Ink", sub: "--foreground", className: "bg-foreground" },
    { name: "Muted", sub: "--muted", className: "bg-muted-foreground" },
  ];
  return (
    <section className="mb-14">
      <SectionHead eyebrow="01 · Color" title="One accent, quiet neutrals">
        Royal <code className="font-mono text-sm text-foreground">{brand.colors.primary}</code> is
        the only brand color — actions, active state, focus, links. No gradients: in operational
        tools the accent points, it doesn&apos;t decorate. Dark mode is a single{" "}
        <code className="font-mono text-sm text-foreground">[data-theme]</code> swap — flip it in
        the top bar.
      </SectionHead>
      <div className="mb-3.5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {swatches.map((s) => (
          <div
            key={s.name}
            className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
          >
            <div
              className={"h-[70px] w-full " + (s.className ?? "")}
              style={s.fill ? { backgroundColor: s.fill } : undefined}
              aria-hidden
            />
            <div className="px-3 py-2.5">
              <div className="text-sm font-semibold text-foreground">{s.name}</div>
              <div className="font-mono text-xs text-muted-foreground">{s.sub}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Badge variant="success">Approved</Badge>
        <Badge variant="warning">Pending</Badge>
        <Badge variant="danger">Rejected</Badge>
        <Badge variant="brand">In review</Badge>
      </div>
    </section>
  );
}

export function TypeSection() {
  return (
    <section className="mb-14">
      <SectionHead eyebrow="02 · Type & ruler" title="Geist, on a 4px grid">
        An engineered grotesk built for product UI — the Vercel/Linear register.{" "}
        <span className="font-semibold text-foreground">{brand.font.family}</span> for everything,{" "}
        <span className="font-semibold text-foreground">{brand.font.mono}</span> for IDs, codes and
        metrics.
      </SectionHead>
      <div className="grid gap-3.5 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-xl border border-border bg-card px-5 shadow-sm">
          {[
            {
              spec: "38 / 700",
              node: <span className="text-h1 font-bold tracking-tight">Staffing overview</span>,
            },
            {
              spec: "24 / 600",
              node: <span className="text-h3 font-semibold">Recently finalised</span>,
            },
            {
              spec: "14 / 400",
              node: (
                <span className="text-base">
                  Automatic AI review against the Rihal Legal Manual.
                </span>
              ),
            },
            {
              spec: "mono 13",
              node: <span className="font-mono text-sm text-primary-emphasis">DFR-3612</span>,
            },
          ].map((r, i, arr) => (
            <div
              key={r.spec}
              className={
                "flex items-baseline gap-4 py-3 " +
                (i < arr.length - 1 ? "border-b border-border" : "")
              }
            >
              <span className="w-16 flex-none font-mono text-xs text-muted-foreground">
                {r.spec}
              </span>
              {r.node}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div>
            <div className="mb-2.5 text-sm font-semibold text-foreground">Radius</div>
            <div className="flex gap-2.5">
              {[
                { r: "rounded-sm", n: "6" },
                { r: "rounded-md", n: "8" },
                { r: "rounded-lg", n: "12" },
                { r: "rounded-full", n: "pill" },
              ].map((x) => (
                <div key={x.n} className="text-center">
                  <div className={"h-11 w-11 border border-primary bg-primary/10 " + x.r} />
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{x.n}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2.5 text-sm font-semibold text-foreground">Elevation</div>
            <div className="flex gap-3">
              {[
                { s: "shadow-sm", n: "sm" },
                { s: "shadow-md", n: "md" },
                { s: "shadow-lg", n: "lg" },
              ].map((x) => (
                <div
                  key={x.n}
                  className={
                    "flex h-11 w-16 items-end justify-center rounded-md border border-border bg-card pb-1 font-mono text-xs text-muted-foreground " +
                    x.s
                  }
                >
                  {x.n}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
