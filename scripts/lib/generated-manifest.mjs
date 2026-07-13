// scripts/lib/generated-manifest.mjs — generator manifest recorder (ADR-054).
//
// Every real (non-dry-run) scaffold run upserts one entry into
// docs/generated-manifest.json: which generator ran, for what name, which files
// it created / patched, at which harness version (.claude/plugin.json), and when.
// This is the picture a later re-sync/codemod mode (deferred; ADR-054 decision 2)
// reasons from when the template's generated SHAPE changes — without it, already-
// generated forks drift invisibly.
//
// Contract: OBSERVABILITY ONLY. A manifest failure must never fail a scaffold —
// warn and move on. A malformed existing manifest is replaced with a fresh one.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MANIFEST = "docs/generated-manifest.json";

/**
 * Upsert a generation record (keyed on generator+name, so a re-scaffold updates
 * its entry instead of duplicating it).
 *
 * @param {string} root repo root (the generator's ROOT)
 * @param {{ generator: string, name: string, files?: string[], patched?: string[] }} rec
 */
export async function recordGeneration(root, { generator, name, files = [], patched = [] }) {
  try {
    const path = join(root, MANIFEST);
    let doc;
    try {
      doc = JSON.parse(await readFile(path, "utf8"));
      if (!doc || typeof doc !== "object" || !Array.isArray(doc.entries)) throw new Error("shape");
    } catch {
      doc = {
        note: "Generator manifest (ADR-054). One entry per scaffold run (generator+name), upserted by scripts/lib/generated-manifest.mjs. Consumed by the future re-sync/codemod mode; do not hand-edit.",
        entries: [],
      };
    }
    let harnessVersion = "unknown";
    try {
      harnessVersion =
        JSON.parse(await readFile(join(root, ".claude/plugin.json"), "utf8")).version ?? "unknown";
    } catch {
      /* pre-plugin fork -- keep "unknown" */
    }
    const entry = {
      generator,
      name,
      files,
      patched,
      harnessVersion,
      date: new Date().toISOString().slice(0, 10),
    };
    const i = doc.entries.findIndex((e) => e.generator === generator && e.name === name);
    if (i >= 0) doc.entries[i] = entry;
    else doc.entries.push(entry);
    await writeFile(path, JSON.stringify(doc, null, 2) + "\n");
    console.log(`~ ${MANIFEST} (recorded ${generator}: ${name})`);
  } catch (e) {
    console.warn(`warn: could not update ${MANIFEST} — ${e.message} (non-fatal, scaffold is done)`);
  }
}
