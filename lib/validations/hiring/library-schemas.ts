import type { z } from "zod";
import {
  competencySchema,
  gradeSchema,
  jdTemplateSchema,
  LIBRARY_KINDS,
  questionSchema,
  type LibraryKind,
} from "./library";

/** kind → its create schema (update = the same schema, partial). */
export const LIBRARY_SCHEMAS: Record<LibraryKind, z.ZodTypeAny> = {
  competencies: competencySchema,
  grades: gradeSchema,
  "jd-templates": jdTemplateSchema,
  questions: questionSchema,
};

export function libraryKind(raw: string): LibraryKind | null {
  return (LIBRARY_KINDS as readonly string[]).includes(raw) ? (raw as LibraryKind) : null;
}
