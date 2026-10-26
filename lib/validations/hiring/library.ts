import { z } from "zod";

/** Knowledge base (Interview Hub competency / grade / jdTemplate / question schemas). */

const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const id = z.string().min(1).max(64);

const anchors = z
  .object({
    "1": optText(500),
    "2": optText(500),
    "3": optText(500),
    "4": optText(500),
    "5": optText(500),
  })
  .partial();

export const competencySchema = z.object({
  name: z.string().trim().min(1).max(120),
  definition: optText(2000),
  category: z.enum(["technical", "behavioral", "leadership", "domain"]).optional().nullable(),
  roleFamily: optText(80),
  entityId: id.optional().nullable(),
  anchors: anchors.optional().nullable(),
});

export const gradeSchema = z
  .object({
    code: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(120),
    minSalary: z.number().nonnegative().max(1_000_000).optional().nullable(),
    maxSalary: z.number().nonnegative().max(1_000_000).optional().nullable(),
    order: z.number().int().min(0).max(1000).default(0),
    entityId: id.optional().nullable(),
  })
  .refine((v) => v.minSalary == null || v.maxSalary == null || v.minSalary <= v.maxSalary, {
    message: "Minimum cannot exceed the maximum",
    path: ["minSalary"],
  });

/** D16 — a JD template now carries its grade. */
export const jdTemplateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  roleFamily: optText(80),
  description: z.string().trim().min(1).max(20_000),
  competencies: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  grade: optText(40),
  entityId: id.optional().nullable(),
});

export const questionSchema = z.object({
  roleFamily: z.string().trim().min(1).max(80),
  questionText: z.string().trim().min(1).max(2000),
  category: z.enum(["competency", "behavioral", "role-specific"]),
  requisitionId: id.optional().nullable(),
  competency: optText(120),
  qualityScore: z.number().min(0).max(5).optional(),
});

export const LIBRARY_KINDS = ["competencies", "grades", "jd-templates", "questions"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
