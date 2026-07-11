#!/usr/bin/env node
// Statusline -- live token meter (ADR-019): `<model> | ctx NN% | $X.XX | N msgs`.
// Reads the statusline JSON from stdin; cost comes from Claude Code when
// provided, context from the transcript's last assistant usage block.
import { readFileSync, existsSync } from "node:fs";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const parts = [];
  const model = input.model?.display_name ?? input.model?.id ?? "";
  if (model) parts.push(model);

  const t = input.transcript_path;
  if (t && existsSync(t)) {
    let usage = null,
      msgs = 0;
    for (const line of readFileSync(t, "utf8").trim().split("\n")) {
      try {
        const e = JSON.parse(line);
        if (e.type === "assistant" && e.message?.usage) {
          usage = e.message.usage;
          msgs++;
        }
      } catch {
        /* skip */
      }
    }
    if (usage) {
      const ctx =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.output_tokens ?? 0);
      const pct = Math.round((ctx / 200_000) * 100);
      const flag = pct >= 80 ? " !! handoff" : pct >= 60 ? " ! plan handoff" : "";
      parts.push(`ctx ${pct}%${flag}`, `${msgs} msgs`);
    }
  }
  const cost = input.cost?.total_cost_usd;
  if (typeof cost === "number") parts.push(`$${cost.toFixed(2)}`);
  console.log(parts.join(" | "));
} catch {
  console.log("statusline unavailable");
}
