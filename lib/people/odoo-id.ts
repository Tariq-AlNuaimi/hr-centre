import { auditedTransaction } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { OrgRuleError } from "@/lib/org/rules";
import { decryptSalary, encryptSalary } from "@/lib/pms/employee-select";
import { encryptIdNumber, readIdNumber } from "./id-documents";
import { isProvisionalOdooId } from "./provisional-id";

/**
 * Recording the real Odoo id on a pre-joiner (JML S1, ADR-075) — ONE audited
 * operation that re-keys every value cryptographically bound to the old id:
 * salary and ID numbers are AES-GCM envelopes with `odooId` as AAD (ADR-067), so
 * renaming the key without re-encrypting would make them unreadable forever.
 */

/** A real Odoo id: what the import accepts (no spaces), never the provisional namespace. */
const ODOO_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Replace a provisional id with the real Odoo id, re-encrypting the salary and
 * ID numbers under the new AAD in the same transaction. Refused when the
 * employee already has a real id, or the new id is taken.
 */
export async function recordOdooId(employeeId: string, rawOdooId: string): Promise<void> {
  const odooId = rawOdooId.trim();
  if (!ODOO_ID.test(odooId) || isProvisionalOdooId(odooId)) {
    throw new OrgRuleError("odooId: enter the Odoo employee ID exactly as Odoo shows it", 400);
  }
  await auditedTransaction(async (tx) => {
    const [employee, holder] = await Promise.all([
      tx.employee.findUnique({
        where: { id: employeeId },
        select: {
          id: true,
          odooId: true,
          basicSalaryEnc: true,
          civilIdNumberEnc: true,
          passportNumberEnc: true,
        },
      }),
      tx.employee.findUnique({ where: { odooId }, select: { id: true } }),
    ]);
    if (!employee) throw new OrgRuleError("That employee does not exist", 404);
    if (!isProvisionalOdooId(employee.odooId)) {
      throw new OrgRuleError(
        `odooId: this employee already has Odoo ID ${employee.odooId} — it never changes`,
      );
    }
    if (holder) throw new OrgRuleError(`odooId: ${odooId} already belongs to another employee`);

    const old = employee.odooId;
    const salary = decryptSalary(employee.basicSalaryEnc, old);
    const civil = readIdNumber(employee.civilIdNumberEnc, old);
    const passport = readIdNumber(employee.passportNumberEnc, old);
    if (civil.unavailable || passport.unavailable) {
      throw new OrgRuleError(
        "The ID numbers on this record cannot be opened right now (ID key missing), so the " +
          "Odoo ID cannot be recorded without losing them. Nothing was changed.",
      );
    }
    await tx.employee
      .update({
        where: { id: employeeId },
        data: {
          odooId,
          basicSalaryEnc: encryptSalary(salary, odooId),
          civilIdNumberEnc: encryptIdNumber(civil.value, odooId),
          passportNumberEnc: encryptIdNumber(passport.value, odooId),
        },
        select: { id: true },
      })
      .catch((e: unknown) => {
        // A soft-deleted (erroneous) record can still hold the id.
        if ((e as { code?: string }).code === "P2002") {
          throw new OrgRuleError(`odooId: ${odooId} already belongs to another record`);
        }
        throw e;
      });
    await recordAudit(tx, {
      entityType: "Employee",
      entityId: employeeId,
      action: "UPDATE",
      before: { odooId: old },
      after: { odooId, reKeyed: ["basicSalaryEnc", "civilIdNumberEnc", "passportNumberEnc"] },
    });
  });
}
