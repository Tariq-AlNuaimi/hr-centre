/**
 * §9.3's answer scale, as a LEAF module — no imports, so it is safe to reach
 * from a client component.
 *
 * It lived in `lib/pms/three-sixty.ts`, which imports `./cycle`, which imports
 * `lib/prisma`. Importing the scale into the §9.7 answering form therefore
 * dragged the Postgres driver into the browser bundle and failed the build on
 * `Can't resolve 'dns'`. Splitting the constant out is the fix that keeps ONE
 * definition of the scale: `three-sixty.ts` re-exports these, so server code is
 * unchanged and there is no second copy to drift.
 */

/** §9.3 — "4-point forced scale (no neutral midpoint)." */
export const MIN_ANSWER = 1;
export const MAX_ANSWER = 4;

/** §9.3's labels, in the order the spec lists them. */
export const ANSWER_SCALE = [
  { score: 1, key: "stronglyDisagree" },
  { score: 2, key: "disagree" },
  { score: 3, key: "agree" },
  { score: 4, key: "stronglyAgree" },
] as const;

/** §9.3 — a score is on the scale, or it is not an answer. */
export function isAnswerScore(score: number): boolean {
  return Number.isInteger(score) && score >= MIN_ANSWER && score <= MAX_ANSWER;
}
