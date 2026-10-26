/**
 * The outside desks and systems JML talks to, read at call time (declared in
 * lib/env.ts for the contract). Every one is OFF while unset — a missing desk
 * address queues nothing rather than mailing nobody (Onboarding §11.2).
 */

const read = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v ? v : null;
};

export const desks = {
  it: () => read("IT_NOTIFY_EMAIL"),
  pro: () => read("PRO_NOTIFY_EMAIL"),
  payroll: () => read("PAYROLL_NOTIFY_EMAIL"),
};

/** Links shown on a case (Onboarding external-links.ts): Odoo and the Staffing Form. */
export function externalSystems() {
  return [
    { key: "odoo" as const, url: read("ODOO_EMPLOYEE_URL") },
    { key: "staffing-form" as const, url: read("STAFFING_FORM_URL") },
  ];
}

/** The IT intake integration is off unless BOTH the URL and the design approval are set (gate G6). */
export function itIntakeConfig():
  { enabled: true; url: string; token: string | null } | { enabled: false; reason: string } {
  const url = read("IT_INTAKE_URL");
  if (!url) return { enabled: false, reason: "IT_INTAKE_URL is not set — the integration is off" };
  if (read("IT_INTAKE_DESIGN_APPROVED") !== "true") {
    return {
      enabled: false,
      reason:
        "IT_INTAKE_DESIGN_APPROVED is not set — the payload shape has not been approved at gate G6 (AC-INT-002)",
    };
  }
  return { enabled: true, url, token: read("IT_INTAKE_TOKEN") };
}

export function itIntakeFallbackUrl(): string | null {
  return read("IT_INTAKE_FALLBACK_FORM_URL");
}

/** IT intake retry policy: network failures, 429 and 5xx are retried; other 4xx are not. */
export function isRetryable(status: number | null): boolean {
  if (status === null) return true;
  if (status === 429) return true;
  return status >= 500;
}
