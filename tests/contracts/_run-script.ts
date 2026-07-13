import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Shared subprocess runner for generator/enabler contract tests (scaffold,
// enable-docs-site, …). Not a test file itself — the `tests/contracts/*.test.ts`
// glob doesn't match it.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Run a repo script with node; return { code, stdout, stderr }. Never throws on non-zero. */
export function runScript(
  script: string,
  args: string[],
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [script, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}
