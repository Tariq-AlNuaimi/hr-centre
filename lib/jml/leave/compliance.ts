/**
 * §17.3 compliance gates C1–C11 and the statutory-deadline incidents — HR
 * Offboarding `compliance.ts`, ported pure. Labels verbatim.
 */

export const COMPLIANCE_GATES = {
  C1: { label: "Notice period served or compensated", appliesTo: "ALL" },
  C2: { label: "End-of-service gratuity correctly calculated", appliesTo: "SETTLEMENT" },
  C3: { label: "Accrued leave settled", appliesTo: "SETTLEMENT" },
  C4: { label: "Deductions lawful and documented", appliesTo: "SETTLEMENT" },
  C5: { label: "Settlement paid within the statutory window", appliesTo: "SETTLEMENT" },
  C6: { label: "Certificate of service issued", appliesTo: "ALL" },
  C7: { label: "Work permit and visa cancellation completed", appliesTo: "EXPATRIATE" },
  C8: { label: "Omanisation impact recorded", appliesTo: "ALL" },
  C9: { label: "Social insurance or Social Protection Fund deregistration", appliesTo: "ALL" },
  C10: { label: "Termination grounds documented", appliesTo: "DOCUMENTED_EXIT" },
  C11: { label: "Employee record retention", appliesTo: "ALL" },
} as const;

export type GateId = keyof typeof COMPLIANCE_GATES;
export const GATE_IDS = Object.keys(COMPLIANCE_GATES) as GateId[];

export function isGateId(v: string): v is GateId {
  return v in COMPLIANCE_GATES;
}

export type ComplianceProfile = {
  nationality: string;
  exitType: string;
  settlementApplicable: boolean;
};

export function applicableGates(p: ComplianceProfile): GateId[] {
  const documented = p.exitType === "TERMINATION" || p.exitType === "SUMMARY_DISMISSAL";
  return GATE_IDS.filter((id) => {
    switch (COMPLIANCE_GATES[id].appliesTo) {
      case "SETTLEMENT":
        return p.settlementApplicable;
      case "EXPATRIATE":
        return p.nationality === "EXPATRIATE";
      case "DOCUMENTED_EXIT":
        return documented;
      default:
        return true;
    }
  });
}

export type GateRecordLike = { gateId: string; satisfied: boolean; overriddenById: string | null };

/** AC-12.1: every applicable gate satisfied or overridden; an absent record is unsatisfied. */
export function checkClosureGates(p: ComplianceProfile, records: readonly GateRecordLike[]) {
  const byId = new Map(records.map((r) => [r.gateId, r]));
  const outstanding = applicableGates(p)
    .filter((id) => {
      const r = byId.get(id);
      return !r || (!r.satisfied && !r.overriddenById);
    })
    .map((id) => ({ gateId: id, label: COMPLIANCE_GATES[id].label }));
  return { allowed: outstanding.length === 0, outstanding };
}

/** C8 needs the position classification on the record (§17.3). */
export function gateDataProblem(
  gateId: string,
  positionClassification: string | null,
): string | null {
  if (gateId !== "C8" || positionClassification?.trim()) return null;
  return "C8 requires the exit to record its position classification. Record it on the case before marking this gate satisfied, or override it with a reason.";
}

export const INCIDENT_KINDS = {
  SETTLEMENT_PAYMENT_WINDOW: {
    label: "Settlement not paid within the statutory window",
    gate: "C5",
  },
  VISA_CANCELLATION_DEADLINE: {
    label: "Visa cancellation not completed by the departure date",
    gate: "C7",
  },
} as const;

export type IncidentKind = keyof typeof INCIDENT_KINDS;

const DAY = 86_400_000;

/**
 * ONE days-late function (Offboarding F15 fixed): calendar days between the
 * deadline day and the day measured, UTC dates — paid on the deadline day is 0.
 */
export function daysLate(deadline: Date, measured: Date): number {
  const floor = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((floor(measured) - floor(deadline)) / DAY);
}

export type DetectedIncident = {
  kind: IncidentKind;
  gateId: string;
  deadlineAt: Date;
  daysLate: number;
};

/** AC-12.2: logged independently of case status. */
export function detectIncidents(
  input: {
    lastDayOfService: Date | null;
    paymentConfirmedAt: Date | null;
    settlementApplicable: boolean;
    paymentWindowDays: number | null;
    nationality: string;
    departureDate: Date | null;
    visaCancellationConfirmedAt: Date | null;
  },
  now: Date,
): DetectedIncident[] {
  const out: DetectedIncident[] = [];
  if (input.settlementApplicable && input.lastDayOfService && input.paymentWindowDays !== null) {
    const deadlineAt = new Date(input.lastDayOfService.getTime() + input.paymentWindowDays * DAY);
    const late = daysLate(deadlineAt, input.paymentConfirmedAt ?? now);
    if (late > 0)
      out.push({ kind: "SETTLEMENT_PAYMENT_WINDOW", gateId: "C5", deadlineAt, daysLate: late });
  }
  if (input.nationality === "EXPATRIATE" && input.departureDate) {
    const late = daysLate(input.departureDate, input.visaCancellationConfirmedAt ?? now);
    if (late > 0) {
      out.push({
        kind: "VISA_CANCELLATION_DEADLINE",
        gateId: "C7",
        deadlineAt: input.departureDate,
        daysLate: late,
      });
    }
  }
  return out;
}
