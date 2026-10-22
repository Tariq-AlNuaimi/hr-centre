import { prisma } from "../lib/prisma";
import {
  applyReset,
  buildPlan,
  guardBlockedReason,
  printPlan,
  type ResetOptions,
} from "./dummy-data";

/**
 * `npm run db:dummy-data` — preview, and with `--apply` perform, a reset of the
 * test dataset. See `docs/runbooks/reset-dummy-data.md` for the copy-paste steps.
 *
 * DRY RUN IS THE DEFAULT. With no flags this writes nothing.
 *
 * Deliberately a CLI and not a route: it needs `DATABASE_URL` in hand, so it is
 * not reachable from the running app by anyone, at any permission level. That is
 * the first of the five guards.
 *
 * Uses the EXTENDED client from `lib/prisma`, and that is load-bearing. The
 * first version of this file built its own `new PrismaClient({ adapter })`,
 * which attaches NEITHER extension — so every "soft" delete was a hard delete
 * and not one audit row was written. The tool's central promise, that removals
 * are reversible from the Recycling Bin, was simply false. It surfaced as a
 * CHECK-constraint violation (`employees_department_xor_c_level_check`) when the
 * hard department delete nulled a kept DIRECTOR's `departmentId` through the
 * FK's `ON DELETE SET NULL` — a failure three steps away from its cause, and
 * only because the apply path was actually run.
 */

function parseArgs(argv: string[]): ResetOptions & { help: boolean } {
  const apply = argv.includes("--apply");
  const confirmAt = argv.indexOf("--confirm");
  const yearAt = argv.indexOf("--year");
  const nextYear = new Date().getUTCFullYear() + 1;
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    mode: apply ? "apply" : "dry-run",
    confirm: confirmAt >= 0 ? Number(argv[confirmAt + 1]) : undefined,
    year: yearAt >= 0 ? Number(argv[yearAt + 1]) : nextYear,
  };
}

const USAGE = `
Reset the test dataset.

  npm run db:dummy-data                      preview only, writes nothing
  npm run db:dummy-data -- --apply --confirm N   perform it
  npm run db:dummy-data -- --year 2027       choose the cycle year (default: next year)

Needs DATABASE_URL, project.config.json's dummyData.resetAllowed, and
DUMMY_DATA_RESET. Refuses outright if any cycle has published results.
`;

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. See docs/runbooks/reset-dummy-data.md step 1.");
    return 1;
  }

  try {
    const plan = await buildPlan(prisma);
    const removalCount = plan.employees.filter((e) => !e.keep).length;

    // Printed BEFORE the guard, so a refusal still tells the reader what the
    // run would have done. A guard message with no context is a dead end.
    printPlan(plan, opts);

    // The lockout check. Not one of the five guards — it is the one mistake the
    // guards cannot catch, because a deployment whose only HR account is itself
    // a test employee passes every one of them and then cannot run its own
    // cycle afterwards.
    const keptHr = plan.employees.filter((e) => e.keep && /HR|ADMIN/i.test(e.reason)).length;
    if (keptHr === 0) {
      console.error(
        "REFUSED: nothing in the keep list is an HR Super Admin, an HRBP or a platform\n" +
          "ADMIN. Applying this would leave the deployment with nobody who can run a\n" +
          "cycle, and no way back in except the database. Give one person an HR role in\n" +
          "the app first, then re-run.",
      );
      return 1;
    }

    const blocked = await guardBlockedReason(prisma, opts, removalCount);
    if (blocked) {
      console.error(`REFUSED: ${blocked}`);
      return 1;
    }

    if (opts.mode === "dry-run") {
      console.log("Nothing was changed. To perform it:");
      console.log(`  npm run db:dummy-data -- --apply --confirm ${removalCount}`);
      console.log();
      return 0;
    }

    console.log("Applying:");
    const { logins } = await applyReset(prisma, plan, opts);

    console.log();
    console.log("==========================================================");
    console.log("  LOGINS — shown ONCE. Copy them now.");
    console.log("  Not stored anywhere but the password hash, and not in git.");
    console.log("==========================================================");
    for (const l of logins) {
      console.log();
      console.log(`  ${l.role}`);
      console.log(`    name:     ${l.name}`);
      console.log(`    email:    ${l.email}`);
      console.log(`    password: ${l.password}`);
    }
    console.log();
    console.log("  The HR and admin accounts you kept kept their own passwords.");
    console.log("  Everyone else is passwordless, exactly as an imported population is.");
    console.log();
    console.log("Done. Removed people, departments and entities are in Recycling Bin");
    console.log("in the app and can be restored. The old cycles are gone for good.");
    console.log();
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
