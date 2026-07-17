// Pure blueprint-content checks (V2-202 feature-parity, V2-209 amendment-confirm),
// shared by scripts/ship.mjs (the gate) and tests/harness/hooks.test.mjs (its unit test)
// so the enforcement is verified, not just asserted. Dependency-free; callers supply I/O.

/**
 * Analyze one blueprint's markdown text.
 * @param {string} text - the blueprint file contents.
 * @param {(name: string) => boolean} benchmarkExists - true if docs/benchmarks/<name>.md exists.
 * @returns {{ parityGap: boolean, amendGap: boolean }}
 *   parityGap — references a SPECIFIC existing benchmark .md but has no "## Feature parity"
 *               section and no "Feature parity: <opt-out>" line (V2-202).
 *   amendGap  — carries a REAL amendment delta row (| YYYY-MM-DD |, not the <YYYY-MM-DD>
 *               template placeholder) while its "Confirmed:" line is empty/placeholder (V2-209).
 */
export function analyzeBlueprint(text, benchmarkExists) {
  const refs = [...text.matchAll(/docs\/benchmarks\/([a-z0-9-]+)\.md/g)].map((m) => m[1]);
  const refsExistingBenchmark = refs.some((r) => benchmarkExists(r));
  const hasParity = /^##\s+Feature parity/im.test(text) || /^\s*Feature parity:\s*\S/im.test(text);
  const parityGap = refsExistingBenchmark && !hasParity;

  const hasRealAmendRow = /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/m.test(text);
  const cm = /^[ \t]*Confirmed:[ \t]*(.*)$/im.exec(text);
  const confirmedEmpty = !!cm && (!cm[1].trim() || /^<.*>$/.test(cm[1].trim()));
  const amendGap = hasRealAmendRow && confirmedEmpty;

  return { parityGap, amendGap };
}
