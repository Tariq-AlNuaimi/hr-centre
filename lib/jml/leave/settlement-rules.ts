/**
 * Settlement gates (Offboarding `transmittal.ts`, AC-10.6–10.8), pure. F5
 * fixed: approval needs BOTH Final Settlement Approval signatures (HR Manager
 * and Operations Director) as approval rows, not one click.
 */

export type Gate = { allowed: true } | { allowed: false; reasons: string[] };
const gate = (reasons: string[]): Gate =>
  reasons.length ? { allowed: false, reasons } : { allowed: true };

export type AssetSnapshot = {
  identifier: string | null;
  description: string | null;
  returnedDate: Date | null;
  writtenOff: boolean;
  deductionApplicable: boolean;
};

/** AC-10.6 / T17: every asset is returned, charged, or written off. */
export function canTransmitSettlement(assets: readonly AssetSnapshot[]): Gate {
  return gate(
    assets
      .filter((a) => !a.returnedDate && !a.writtenOff && !a.deductionApplicable)
      .map(
        (a) =>
          `"${a.identifier ?? a.description ?? "an asset"}" is neither returned, charged as a deduction, nor written off. ` +
          "Record one of the three before the settlement goes forward (AC-10.6).",
      ),
  );
}

export function canApproveSettlement(ctx: {
  calculated: boolean;
  recalculationRequired: boolean;
  provisional: boolean;
  unverifiedKeys: readonly string[];
  unreferencedDeductions: number;
  assets: readonly AssetSnapshot[];
  signatures: { granted: boolean; missingHolders: readonly string[] };
  alreadyApproved: boolean;
}): Gate {
  const reasons: string[] = [];
  if (ctx.alreadyApproved) reasons.push("The settlement is already approved.");
  if (!ctx.calculated) reasons.push("Calculate the settlement first.");
  if (ctx.recalculationRequired)
    reasons.push("A line changed after the last calculation — recalculate so the net is current.");
  if (ctx.provisional) {
    reasons.push(
      `The calculation used statutory values no one has verified (${ctx.unverifiedKeys.join(", ")}). ` +
        'It is "Provisional — statutory values unconfirmed" and cannot be approved until they are verified (AC-10.8).',
    );
  }
  if (ctx.unreferencedDeductions > 0) {
    reasons.push(
      `${ctx.unreferencedDeductions} deduction line(s) have no documentary reference (C4).`,
    );
  }
  const transmit = canTransmitSettlement(ctx.assets);
  if (!transmit.allowed) reasons.push(...transmit.reasons);
  if (!ctx.signatures.granted) {
    reasons.push(
      `Final Settlement Approval still needs: ${ctx.signatures.missingHolders.join(" and ")} (two signatures).`,
    );
  }
  return gate(reasons);
}

/** AC-10.7: approved, payment confirmed, with a reference. */
export function canCloseSettlement(ctx: {
  approvedAt: Date | null;
  paymentConfirmedAt: Date | null;
  paymentReference: string | null;
}): Gate {
  const reasons: string[] = [];
  if (!ctx.approvedAt) reasons.push("The settlement has not been approved yet (AC-10.7).");
  if (!ctx.paymentConfirmedAt) reasons.push("Payment has not been confirmed (AC-10.7).");
  if (!ctx.paymentReference?.trim()) reasons.push("A payment reference is required (AC-10.7).");
  return gate(reasons);
}

/** The C5 deadline: the last day of service + the window, CALENDAR days. */
export function paymentDeadline(lastDayOfService: Date, windowDays: number): Date {
  return new Date(lastDayOfService.getTime() + windowDays * 86_400_000);
}
