export type AiProviderView = {
  provider: "anthropic" | "openai";
  baseUrl: string;
  model: string;
  keySet: boolean;
  keySource: "settings" | "env" | null;
  keyUnreadable: boolean;
  pdfVision: boolean;
  configured: boolean;
  canEdit: boolean;
};

export type AiUsageView = {
  limits: {
    killSwitch: boolean;
    dailyTokenCap: number;
    dailySpendCap: number;
    timeoutMs: number;
    pricePer1kIn: number;
    pricePer1kOut: number;
  };
  today: { calls: number; tokens: number; spend: number | null };
  days: number;
  byFeature: { feature: string; calls: number; tokens: number; avgLatencyMs: number }[];
};

export type Weights = {
  skills: number;
  experience: number;
  education: number;
  culture: number;
  language: number;
};
export type BudgetEntry = { fiscalYear: string; amountOMR: number; setBy: string; setOn: string };

export type GeneralView = {
  entities: { code: string; name: string }[];
  weights: Weights;
  panelAiMode: "blind" | "assisted" | "off";
  budget: { entities: Record<string, BudgetEntry> };
  approvals: { chains: Record<string, string[]>; cooThreshold: number };
  canEdit: boolean;
};

export const APPROVAL_ROLES = [
  "HR_MANAGER",
  "HR_SPECIALIST",
  "HIRING_MANAGER",
  "PANELIST",
  "DEPARTMENT_HEAD",
  "DIRECTOR",
  "OPERATIONS_MANAGER",
  "OPERATIONS_DIRECTOR",
  "COO",
  "CEO",
] as const;
