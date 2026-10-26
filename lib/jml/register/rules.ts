/**
 * Register rules, pure (Offboarding `access.ts` / `transmittal.ts`) — the
 * refusals the register services apply and the contract tests pin.
 */

/** AC-10.6 / T17: assets neither returned, written off nor carrying a deduction. */
export function unsettledAssets(
  assets: readonly {
    returnedDate: Date | null;
    writtenOff: boolean;
    deductionApplicable: boolean;
  }[],
): number {
  return assets.filter((a) => !a.returnedDate && !a.writtenOff && !a.deductionApplicable).length;
}

export type AccessConfirmation = {
  confirmingParty: string | null;
  confirmedDate: Date | null;
  reference: string | null;
  coveredByDisablementOf: string | null;
};

/**
 * AC-7.1 / AC-7.2: an item is confirmed once, with party + date + reference
 * (each missing part named); a rotation item cannot be closed by pointing at
 * another account's disablement — the credential still works.
 */
export function accessConfirmationProblem(
  item: { confirmedDate: Date | null; rotationRequired: boolean; direction: "GRANT" | "REVOKE" },
  input: AccessConfirmation,
): string | null {
  if (item.confirmedDate) return "This item is already confirmed.";
  if (input.coveredByDisablementOf && item.rotationRequired) {
    return "A credential that must be rotated cannot be closed by another account's disablement — rotate it and confirm.";
  }
  const missing: string[] = [];
  if (!input.confirmingParty) missing.push("confirming party");
  if (!input.confirmedDate) missing.push("confirmation date");
  if (!input.reference && !input.coveredByDisablementOf) missing.push("reference");
  return missing.length ? `Confirmation needs: ${missing.join(", ")}.` : null;
}

/** AC-7.2: a shared credential always needs rotating. */
export const rotationFor = (sharedCredential: boolean, rotationRequired: boolean) =>
  sharedCredential || rotationRequired;
