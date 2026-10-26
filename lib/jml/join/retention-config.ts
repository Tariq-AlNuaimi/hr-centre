/** The retention rule from the environment (gate G8: no default period). Pure. */
export type RetentionConfig =
  | { configured: true; days: number; action: "anonymise" | "purge" }
  | { configured: false; reason: string };

export function retentionConfig(
  env: Record<string, string | undefined> = process.env,
): RetentionConfig {
  const raw = env.JML_RETENTION_DAYS?.trim();
  if (!raw)
    return {
      configured: false,
      reason: "JML_RETENTION_DAYS is not set — HR has not approved a period",
    };
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    return {
      configured: false,
      reason: "JML_RETENTION_DAYS must be a positive whole number of days",
    };
  }
  const action = env.JML_RETENTION_ACTION?.trim() || "anonymise";
  if (action !== "anonymise" && action !== "purge") {
    return { configured: false, reason: "JML_RETENTION_ACTION must be anonymise or purge" };
  }
  return { configured: true, days: Number(raw), action };
}
