export type Insights = {
  scoped: boolean;
  kpis: {
    openRequisitions: number;
    activeCandidates: number;
    upcomingInterviews: number;
    liveOffers: number;
    hires: number;
    offerAcceptance: number | null;
    avgDaysToHire: number | null;
  };
  funnel: { stages: { stage: string; count: number }[]; rejected: number; withdrawn: number };
  velocity: {
    avgDaysToHire: number | null;
    hires: number;
    truncated: boolean;
    byCompany: { company: string; avgDays: number | null; hires: number }[];
  };
  omanization: {
    overall: { hires: number; omani: number; pct: number | null };
    companies: {
      company: string;
      hires: number;
      omani: number;
      pct: number | null;
      target: number | null;
      meetsTarget: boolean | null;
    }[];
    truncated: boolean;
  } | null;
  dei: {
    gender: { value: string; count: number }[];
    ethnicity: { value: string; count: number }[];
    declaredGender: number;
    declaredEthnicity: number;
  } | null;
};
