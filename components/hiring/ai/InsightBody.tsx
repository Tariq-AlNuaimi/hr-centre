"use client";

import { useTranslations } from "next-intl";

/**
 * Renders an insight's JSON by its known keys (summary prose, lists, score
 * maps); anything unrecognised falls back to the model's text. Advisory copy:
 * the card around it always says a person decides.
 */
const PROSE = ["summary", "rationale", "recommendation", "vote", "improvedJd"] as const;
const LISTS = [
  "strengths",
  "concerns",
  "risks",
  "gaps",
  "redFlags",
  "followUps",
  "interviewerBias",
  "competencies",
] as const;
const MAPS = ["scores", "competencySignals"] as const;

const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

export function InsightBody({
  json,
  text,
}: {
  json: Record<string, unknown> | null;
  text: string;
}) {
  const t = useTranslations("hiring.ai");
  if (!json) return <p className="text-sm whitespace-pre-wrap text-foreground">{text}</p>;
  const overall = typeof json.overall === "number" ? json.overall : null;
  return (
    <div className="space-y-3 text-sm">
      {overall !== null ? (
        <p className="text-h4 font-semibold text-foreground">
          {t("overall", { n: Math.round(overall) })}
        </p>
      ) : null}
      {PROSE.map((k) =>
        typeof json[k] === "string" && json[k] ? (
          <div key={k}>
            <p className="text-xs font-semibold text-muted-foreground uppercase">{t(`key.${k}`)}</p>
            <p className="whitespace-pre-wrap text-foreground">{json[k] as string}</p>
          </div>
        ) : null,
      )}
      {LISTS.map((k) => {
        const items = strs(json[k]);
        return items.length ? (
          <div key={k}>
            <p className="text-xs font-semibold text-muted-foreground uppercase">{t(`key.${k}`)}</p>
            <ul className="ms-5 list-disc space-y-0.5 text-foreground">
              {items.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null;
      })}
      {MAPS.map((k) => {
        const m = json[k];
        if (!m || typeof m !== "object" || Array.isArray(m)) return null;
        const rows = Object.entries(m as Record<string, unknown>).filter(
          ([, v]) => typeof v === "number" || typeof v === "string",
        );
        return rows.length ? (
          <div key={k}>
            <p className="text-xs font-semibold text-muted-foreground uppercase">{t(`key.${k}`)}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              {rows.map(([name, v]) => (
                <div key={name} className="contents">
                  <dt className="text-foreground">{name}</dt>
                  <dd className="text-end font-mono text-muted-foreground">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null;
      })}
    </div>
  );
}
