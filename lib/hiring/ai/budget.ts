/** The AI budget decision (Interview Hub `lib/ai/budget.ts`) — pure. */

export type BudgetState = {
  killSwitch: boolean;
  todayTokens: number;
  todaySpend: number | null;
  dailyTokenCap: number;
  dailySpendCap: number;
};
export type BudgetVerdict =
  { allowed: true } | { allowed: false; code: "kill_switch" | "budget_exceeded"; reason: string };

export function decideAiBudget(s: BudgetState): BudgetVerdict {
  if (s.killSwitch)
    return {
      allowed: false,
      code: "kill_switch",
      reason: "AI is switched off by an administrator.",
    };
  if (s.dailyTokenCap > 0 && s.todayTokens >= s.dailyTokenCap)
    return { allowed: false, code: "budget_exceeded", reason: "Daily AI token limit reached." };
  if (s.dailySpendCap > 0 && s.todaySpend != null && s.todaySpend >= s.dailySpendCap) {
    return { allowed: false, code: "budget_exceeded", reason: "Daily AI spend limit reached." };
  }
  return { allowed: true };
}

export const startOfUtcDay = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export function estimateSpend(
  tokensIn: number,
  tokensOut: number,
  priceIn: number | null,
  priceOut: number | null,
): number | null {
  if (priceIn == null || priceOut == null) return null;
  return (tokensIn / 1000) * priceIn + (tokensOut / 1000) * priceOut;
}
