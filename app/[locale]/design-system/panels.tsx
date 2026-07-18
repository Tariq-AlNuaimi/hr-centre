// Components / AI-patterns / Adoption sections of the Manzil showcase (see
// page.tsx + docs/blueprints/design-system-showcase.md). Split out so no single
// file blows the complexity budget; markup unchanged. Values shown as text are
// READ from the token source (brand.config.ts).
import { brand } from "@/brand.config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AiAssistPanel,
  AiStreaming,
  CitationLink,
  ResponsibleAiBanner,
  AgentActivity,
} from "@/components/shared/ai";
import { SectionHead, CONFIDENCE } from "./sections";

export function ComponentsSection() {
  return (
    <section className="mb-14">
      <SectionHead eyebrow="03 · Components" title="Buttons, inputs & data" />
      <div className="mb-3.5 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Subtle</Button>
          <Button variant="link">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button disabled>Disabled</Button>
          <span className="inline-flex h-9 items-center rounded-md border border-primary bg-card px-3.5 text-sm shadow-[var(--shadow-ring)]">
            Focus ring
          </span>
        </div>
        <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Counterparty</span>
            <input
              defaultValue="Alpha Technologies LLC"
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:shadow-[var(--shadow-ring)]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Focused</span>
            <input
              defaultValue="typing…"
              className="h-9 w-full rounded-md border border-primary bg-card px-3 text-sm text-foreground shadow-[var(--shadow-ring)] outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-destructive-emphasis">
              Error
            </span>
            <input
              placeholder="Required"
              aria-invalid
              className="h-9 w-full rounded-md border border-destructive bg-card px-3 text-sm text-foreground outline-none"
            />
          </label>
        </div>
      </div>
      <div className="mb-3.5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {[
          { k: "In review", v: "3" },
          { k: "Revenue", v: "542k", trend: "↑ 80.8%" },
          { k: "Utilization", v: "53%" },
          { k: "Omanization", v: "71%", brand: true },
        ].map((s) => (
          <div key={s.k} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {s.k}
            </div>
            <div
              className={
                "mt-1.5 text-h2 font-bold tracking-tight " +
                (s.brand ? "text-primary-emphasis" : "text-foreground")
              }
            >
              {s.v}
            </div>
            {s.trend ? (
              <div className="mt-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {s.trend}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-3 border-b border-border bg-muted px-4.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Project</span>
          <span>Margin</span>
          <span>Status</span>
        </div>
        {[
          {
            p: "Government Treasury",
            org: "MoF",
            m: "79.2%",
            s: <Badge variant="success">Active</Badge>,
          },
          {
            p: "Fleet Operations",
            org: "OLG",
            m: "89.2%",
            s: <Badge variant="warning">Pending</Badge>,
          },
        ].map((row, i, arr) => (
          <div
            key={row.p}
            className={
              "grid grid-cols-[2fr_1fr_1fr] items-center gap-3 px-4.5 py-3 text-sm " +
              (i < arr.length - 1 ? "border-b border-border" : "")
            }
          >
            <span>
              <span className="font-semibold text-foreground">{row.p}</span>{" "}
              <span className="text-muted-foreground">· {row.org}</span>
            </span>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">{row.m}</span>
            <span>{row.s}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AiPatternsSection() {
  return (
    <section className="mb-14">
      <SectionHead
        eyebrow="04 · AI patterns — the differentiator"
        title="AI that assists, never shouts"
      >
        Every Rihal tool is AI-augmented, so these are shared primitives from{" "}
        <code className="font-mono text-sm text-foreground">components/shared/ai</code> — the royal
        ✦ mark, an advisory frame, a human always deciding.
      </SectionHead>
      <div className="flex flex-col gap-3.5">
        <AiAssistPanel
          title="Auto-renewal clause"
          risk="medium"
          riskLabel="Medium"
          confidence={CONFIDENCE}
          confidenceLabel="Confidence"
          meta="Clause 3"
          actions={
            <>
              <Button size="sm">Accept</Button>
              <Button size="sm" variant="outline">
                Reject
              </Button>
              <Button size="sm" variant="ghost">
                Edit
              </Button>
            </>
          }
        >
          Rihal policy requires <strong>mutual written agreement</strong> for renewal.{" "}
          <CitationLink href="#ai">Legal Manual §4.2</CitationLink>{" "}
          <CitationLink href="#ai">Fallback library</CitationLink>
        </AiAssistPanel>
        <div className="grid gap-3.5 md:grid-cols-2">
          <AiStreaming label="Generating…" lines={2} />
          <ResponsibleAiBanner>
            Never uses protected attributes. Scores are advisory and bias-checked; a human always
            decides.
          </ResponsibleAiBanner>
        </div>
        <AgentActivity
          items={[
            {
              time: "10:24",
              actor: "ai",
              text: (
                <>
                  CV parsed &amp; scored — <strong>Ahmed Al-Balushi</strong> · fit 4.2
                </>
              ),
            },
            {
              time: "11:03",
              actor: "human",
              text: (
                <>
                  Offer approved (Tier 2) — <strong>Aisha Al-Saidi</strong>
                </>
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}

export function AdoptionSection() {
  return (
    <section>
      <SectionHead eyebrow="05 · Adoption" title="One edit rebrands everything">
        Tailwind v4 <code className="font-mono text-sm text-foreground">@theme</code> + shadcn/ui.{" "}
        <code className="font-mono text-sm text-foreground">brand.config.ts</code> owns the hex →{" "}
        <code className="font-mono text-sm text-foreground">tokens.css</code> the scale →{" "}
        <code className="font-mono text-sm text-foreground">globals.css</code> the dark swap.
      </SectionHead>
      {/* Always-dark code surface (a terminal reads dark in both themes). */}
      <div className="overflow-hidden rounded-lg border border-border bg-slate-900 shadow-md">
        <div className="border-b border-white/10 px-4 py-2.5 font-mono text-xs text-slate-400">
          brand.config.ts → tokens.css → globals.css
        </div>
        <pre className="m-0 overflow-x-auto p-5 font-mono text-xs leading-relaxed text-slate-100">
          <span className="text-slate-400">
            {"// the single white-label point (template ships indigo)"}
          </span>
          {"\n"}
          {`brand.primary = "${brand.colors.primary}"  `}
          <span className="text-slate-400">{"// royal, solid — no gradient"}</span>
          {"\n"}
          {`brand.font    = { sans:"${brand.font.family}", mono:"${brand.font.mono}" }`}
          {"\n"}
          {"--color-primary: var(--brand-primary);  "}
          <span className="text-slate-400">{"// bg-primary, ring, links"}</span>
        </pre>
      </div>
      <div className="mt-4 rounded-md border border-l-2 border-border border-l-primary bg-card p-4">
        <div className="text-sm font-semibold text-foreground">
          Template · HR Hub · Legal Ops · Staffing · KPI · Risk · COO
        </div>
        <p className="m-0 mt-1 text-sm leading-relaxed text-muted-foreground">
          All converge on the shipped shadcn/Tailwind token contract. Full per-repo checklist in{" "}
          <code className="font-mono text-xs">adopt/MIGRATION.md</code>.
        </p>
      </div>
    </section>
  );
}
