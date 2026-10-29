import type { EmployeeRecordView } from "@/lib/core/employee-select";
import type { RecordValues } from "./RecordFields";

/** The serialised record as form strings ("" = not on file). */
export function recordFormValues(record: EmployeeRecordView): RecordValues {
  const s = (v: string | null | undefined) => v ?? "";
  return {
    jobTitle: s(record.jobTitle),
    grade: s(record.grade),
    contractType: s(record.contractType),
    probationEndDate: s(record.probationEndDate),
    workLocation: s(record.workLocation),
    workPhone: s(record.workPhone),
    ...(record.personal
      ? {
          personalEmail: s(record.personal.personalEmail),
          personalPhone: s(record.personal.personalPhone),
          dateOfBirth: s(record.personal.dateOfBirth),
          gender: s(record.personal.gender),
          nationality: s(record.personal.nationality),
        }
      : {}),
    ...(record.idDocuments
      ? {
          civilIdNumber: s(record.idDocuments.civilIdNumber),
          civilIdExpiry: s(record.idDocuments.civilIdExpiry),
          passportNumber: s(record.idDocuments.passportNumber),
          passportExpiry: s(record.idDocuments.passportExpiry),
        }
      : {}),
  };
}
