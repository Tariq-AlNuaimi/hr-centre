/** Field layout per knowledge-base kind (Interview Hub KB forms). */
export type FieldDef = {
  name: string;
  type: "text" | "textarea" | "number" | "select" | "competencies" | "anchors";
  required?: boolean;
  options?: string[];
};

export const LIBRARY_FIELDS: Record<string, FieldDef[]> = {
  competencies: [
    { name: "name", type: "text", required: true },
    {
      name: "category",
      type: "select",
      options: ["technical", "behavioral", "leadership", "domain"],
    },
    { name: "roleFamily", type: "text" },
    { name: "definition", type: "textarea" },
    { name: "anchors", type: "anchors" },
  ],
  grades: [
    { name: "code", type: "text", required: true },
    { name: "name", type: "text", required: true },
    { name: "minSalary", type: "number" },
    { name: "maxSalary", type: "number" },
    { name: "order", type: "number" },
  ],
  "jd-templates": [
    { name: "title", type: "text", required: true },
    { name: "roleFamily", type: "text" },
    { name: "grade", type: "text" },
    { name: "description", type: "textarea", required: true },
    { name: "competencies", type: "competencies" },
  ],
  questions: [
    { name: "roleFamily", type: "text", required: true },
    {
      name: "category",
      type: "select",
      required: true,
      options: ["competency", "behavioral", "role-specific"],
    },
    { name: "competency", type: "text" },
    { name: "questionText", type: "textarea", required: true },
    { name: "qualityScore", type: "number" },
  ],
};

/** The columns each list shows. */
export const LIBRARY_COLUMNS: Record<string, string[]> = {
  competencies: ["name", "category", "roleFamily"],
  grades: ["code", "name", "band", "order"],
  "jd-templates": ["title", "roleFamily", "grade"],
  questions: ["questionText", "category", "competency", "roleFamily"],
};
