"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, Sparkles } from "lucide-react";
import { ApplyPanel } from "./ApplyPanel";
import type { CareersRole } from "./types";

/**
 * The public careers board (Interview Hub `/careers`): hero, team chips and
 * search over the open roles already in hand, one card per role, and the apply
 * panel. Candidate-facing brand; stays light in either theme.
 */
export function CareersBoard({ roles }: { roles: CareersRole[] }) {
  const t = useTranslations("careers");
  const [team, setTeam] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CareersRole | null>(null);
  const teams = useMemo(
    () => [...new Set(roles.map((r) => r.department).filter(Boolean))].sort(),
    [roles],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return roles.filter(
      (r) =>
        (!team || r.department === team) &&
        (!needle ||
          `${r.title} ${r.department} ${r.company} ${r.description}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [roles, team, query]);
  return (
    <>
      <section className="relative overflow-hidden bg-careers-panel">
        <div
          aria-hidden
          className="absolute -end-24 -top-24 h-80 w-80 rounded-full bg-radial from-careers-mint via-careers-sky to-careers-royal opacity-80 blur-sm"
        />
        <div className="relative mx-auto max-w-5xl px-6 py-16">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-careers-line bg-careers-page px-3 py-1 text-xs font-semibold text-careers-ink">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {t("heroChip")}
          </span>
          <h1 className="mt-4 max-w-2xl text-h1 font-bold text-careers-navy">
            {t("heroTitle")}{" "}
            <span className="bg-linear-to-r from-careers-mint via-careers-sky to-careers-royal bg-clip-text text-transparent">
              {t("heroTitleAccent")}
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-careers-muted">{t("heroBody")}</p>
        </div>
      </section>
      <main id="open-roles" className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-6 flex flex-col gap-3">
          <label className="relative block max-w-md">
            <span className="sr-only">{t("search")}</span>
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-careers-muted"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              className="w-full rounded-md border border-careers-line bg-careers-panel py-2 ps-9 pe-3 text-sm text-careers-ink outline-none focus:border-careers-royal"
            />
          </label>
          {teams.length > 1 ? (
            <div role="group" aria-label={t("teams")} className="flex flex-wrap gap-2">
              {[null, ...teams].map((d) => (
                <button
                  key={d ?? "all"}
                  type="button"
                  aria-pressed={team === d}
                  onClick={() => setTeam(d)}
                  className={
                    team === d
                      ? "rounded-full bg-careers-navy px-3 py-1 text-sm font-medium text-careers-panel"
                      : "rounded-full border border-careers-line bg-careers-panel px-3 py-1 text-sm text-careers-ink hover:border-careers-royal"
                  }
                >
                  {d ?? t("allTeams")}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {roles.length === 0 ? (
          <p className="text-sm text-careers-muted">{t("noRoles")}</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-careers-muted">
            {t("noMatch")}{" "}
            <button
              type="button"
              className="text-careers-royal underline"
              onClick={() => (setTeam(null), setQuery(""))}
            >
              {t("showAll", { count: roles.length })}
            </button>
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm font-semibold text-careers-muted">
              {t("count", { count: visible.length })}
            </p>
            <ul className="space-y-3">
              {visible.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-4 rounded-lg border border-careers-line bg-careers-panel p-5"
                >
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-careers-navy">{r.title}</h2>
                    <p className="text-sm text-careers-muted">
                      {[r.company, r.department].filter(Boolean).join(" · ")}
                    </p>
                    {r.description ? (
                      <p className="mt-2 line-clamp-2 text-sm text-careers-ink">{r.description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(r)}
                    className="rounded-md bg-careers-royal px-5 py-2 text-sm font-semibold text-careers-panel hover:bg-careers-navy"
                    aria-label={t("applyFor", { title: r.title })}
                  >
                    {t("apply")}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-8 rounded-lg border border-dashed border-careers-line bg-careers-panel p-5 text-sm">
              <p className="font-semibold text-careers-navy">{t("noRoleTitle")}</p>
              <p className="text-careers-muted">{t("noRoleBody")}</p>
            </div>
          </>
        )}
        {selected ? (
          <ApplyPanel key={selected.id} role={selected} onClose={() => setSelected(null)} />
        ) : null}
      </main>
    </>
  );
}
