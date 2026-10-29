import {
  clearModuleSetting,
  readModuleSettings,
  writeModuleSetting,
} from "@/lib/core/settings/store";
import type { ContactSettingsInput } from "@/lib/validations/jml/config";

/**
 * The outside desks and systems JML talks to, read at call time. Every one is
 * OFF while unset — a missing desk address queues nothing rather than mailing
 * nobody (Onboarding §11.2).
 *
 * The desk addresses and case links are HR settings on the core store (module
 * "jml", ADR-092), edited under JML settings › Desks and links. Until HR save
 * one, the deployment's environment variable (declared in lib/env.ts) still
 * applies, so nothing changes for a deployment configured the old way. The IT
 * intake integration stays env-only: it carries a credential and gate G6.
 */

const read = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v ? v : null;
};

/** Each HR-editable desk or link: its setting key and the env var it falls back to. */
export const CONTACT_SETTINGS = {
  itEmail: "IT_NOTIFY_EMAIL",
  proEmail: "PRO_NOTIFY_EMAIL",
  payrollEmail: "PAYROLL_NOTIFY_EMAIL",
  odooUrl: "ODOO_EMPLOYEE_URL",
  staffingFormUrl: "STAFFING_FORM_URL",
} as const;
export type ContactKey = keyof typeof CONTACT_SETTINGS;
const CONTACT_KEYS = Object.keys(CONTACT_SETTINGS) as ContactKey[];

/** Every desk value with where it came from: an HR setting, the environment, or unset. */
export async function contactSettings(): Promise<
  Record<ContactKey, { value: string | null; source: "setting" | "env" | "unset" }>
> {
  const stored = await readModuleSettings("jml", CONTACT_KEYS);
  const out = {} as Record<
    ContactKey,
    { value: string | null; source: "setting" | "env" | "unset" }
  >;
  for (const key of CONTACT_KEYS) {
    const v = stored.get(key);
    if (typeof v === "string" && v.trim()) out[key] = { value: v.trim(), source: "setting" };
    else {
      const env = read(CONTACT_SETTINGS[key]);
      out[key] = env ? { value: env, source: "env" } : { value: null, source: "unset" };
    }
  }
  return out;
}

/** Save HR's values: a string sets it, `null` clears it (env applies again), absent leaves it. */
export async function saveContactSettings(input: ContactSettingsInput, userId: string) {
  for (const key of CONTACT_KEYS) {
    const v = input[key];
    if (v === undefined) continue;
    if (v === null || !v.trim()) await clearModuleSetting("jml", key);
    else await writeModuleSetting("jml", key, v.trim(), userId);
  }
  return contactSettings();
}

async function desk(key: ContactKey): Promise<string | null> {
  return (await contactSettings())[key].value;
}

export const desks = {
  it: () => desk("itEmail"),
  pro: () => desk("proEmail"),
  payroll: () => desk("payrollEmail"),
};

/** Links shown on a case (Onboarding external-links.ts): Odoo and the Staffing Form. */
export async function externalSystems() {
  const d = await contactSettings();
  return [
    { key: "odoo" as const, url: d.odooUrl.value },
    { key: "staffing-form" as const, url: d.staffingFormUrl.value },
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
