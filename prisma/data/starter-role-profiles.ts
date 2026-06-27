// Pre-approved starter role profiles (ARCHITECTURE §5). Seeded as ACTIVE v1 under
// their role family so the org is usable on day one; HR clones+edits per real JD
// via the AI-assisted wizard. Every competency is GROUNDED (an O*NET work style +
// a Big-Five finding) and cites its source — the evidence trail, not invention.
//
// `facets` are IPIP-NEO machine-names from lib/ipip-facets (the only legal values).
// `direction` LOW = target at/BELOW the percentile (e.g. low Neuroticism facets).

export type StarterCompetency = {
  name: string;
  onetRef: string;
  importance: number;
  weight: number;
  direction: "HIGH" | "MODERATE" | "LOW";
  targetPercentile: number;
  sourceCitation: string;
  facets: string[];
};

export type StarterProfile = {
  familyKey: string; // joins to RoleFamily.key
  title: string;
  competencies: StarterCompetency[];
};

export const STARTER_ROLE_PROFILES: StarterProfile[] = [
  {
    familyKey: "sales",
    title: "Sales / BD — starter profile",
    competencies: [
      {
        name: "Achievement / Drive",
        onetRef: "Achievement/Effort",
        importance: 90,
        weight: 1.2,
        direction: "HIGH",
        targetPercentile: 70,
        sourceCitation:
          "O*NET Achievement/Effort; Barrick & Mount (1991): Conscientiousness predicts sales performance.",
        facets: ["achievement_striving"],
      },
      {
        name: "Resilience",
        onetRef: "Stress Tolerance",
        importance: 80,
        weight: 1.0,
        direction: "LOW",
        targetPercentile: 35,
        sourceCitation:
          "O*NET Stress Tolerance; Judge et al. (2002): emotional stability (low Neuroticism) predicts resilience.",
        facets: ["vulnerability"],
      },
      {
        name: "Influence / Assertiveness",
        onetRef: "Leadership",
        importance: 80,
        weight: 1.1,
        direction: "HIGH",
        targetPercentile: 70,
        sourceCitation:
          "O*NET Leadership; Barrick & Mount (1991): Extraversion-assertiveness predicts sales success.",
        facets: ["assertiveness"],
      },
      {
        name: "Relationship-building",
        onetRef: "Social Orientation",
        importance: 70,
        weight: 0.9,
        direction: "MODERATE",
        targetPercentile: 55,
        sourceCitation:
          "O*NET Social Orientation; balanced Extraversion-friendliness / Agreeableness in client relationships.",
        facets: ["friendliness"],
      },
      {
        name: "Self-discipline",
        onetRef: "Persistence",
        importance: 75,
        weight: 1.0,
        direction: "HIGH",
        targetPercentile: 65,
        sourceCitation:
          "O*NET Persistence; Conscientiousness-self-discipline sustains pipeline follow-through.",
        facets: ["self_discipline"],
      },
    ],
  },
  {
    familyKey: "pmo",
    title: "PMO — starter profile",
    competencies: [
      {
        name: "Organization & planning",
        onetRef: "Attention to Detail",
        importance: 90,
        weight: 1.2,
        direction: "HIGH",
        targetPercentile: 70,
        sourceCitation:
          "O*NET Attention to Detail; Conscientiousness (orderliness, self-discipline) predicts project delivery.",
        facets: ["orderliness", "self_discipline"],
      },
      {
        name: "Stress tolerance",
        onetRef: "Stress Tolerance",
        importance: 80,
        weight: 1.0,
        direction: "LOW",
        targetPercentile: 35,
        sourceCitation: "O*NET Stress Tolerance; low Neuroticism-vulnerability under deadline pressure.",
        facets: ["vulnerability"],
      },
      {
        name: "Stakeholder balance",
        onetRef: "Cooperation",
        importance: 75,
        weight: 0.9,
        direction: "MODERATE",
        targetPercentile: 55,
        sourceCitation: "O*NET Cooperation; assertiveness balanced with Agreeableness-cooperation.",
        facets: ["assertiveness", "cooperation"],
      },
      {
        name: "Conscientiousness overall",
        onetRef: "Dependability",
        importance: 85,
        weight: 1.0,
        direction: "HIGH",
        targetPercentile: 65,
        sourceCitation: "O*NET Dependability; Conscientiousness-dutifulness predicts reliable delivery.",
        facets: ["dutifulness"],
      },
    ],
  },
  {
    familyKey: "support",
    title: "Support — starter profile",
    competencies: [
      {
        name: "Empathy",
        onetRef: "Concern for Others",
        importance: 90,
        weight: 1.1,
        direction: "HIGH",
        targetPercentile: 70,
        sourceCitation: "O*NET Concern for Others; Agreeableness (sympathy, altruism) predicts service quality.",
        facets: ["sympathy", "altruism"],
      },
      {
        name: "Emotional regulation",
        onetRef: "Self-Control",
        importance: 85,
        weight: 1.0,
        direction: "LOW",
        targetPercentile: 35,
        sourceCitation: "O*NET Self-Control; low Neuroticism-anger sustains composure with difficult customers.",
        facets: ["anger"],
      },
      {
        name: "Follow-through",
        onetRef: "Dependability",
        importance: 80,
        weight: 1.0,
        direction: "HIGH",
        targetPercentile: 65,
        sourceCitation: "O*NET Dependability; Conscientiousness-dutifulness closes tickets reliably.",
        facets: ["dutifulness"],
      },
      {
        name: "Frustration tolerance",
        onetRef: "Stress Tolerance",
        importance: 75,
        weight: 0.9,
        direction: "LOW",
        targetPercentile: 40,
        sourceCitation: "O*NET Stress Tolerance; low Neuroticism-vulnerability in repetitive high-contact work.",
        facets: ["vulnerability"],
      },
    ],
  },
  {
    familyKey: "legal_grc",
    title: "Legal / GRC — starter profile",
    competencies: [
      {
        name: "Attention to detail",
        onetRef: "Attention to Detail",
        importance: 95,
        weight: 1.2,
        direction: "HIGH",
        targetPercentile: 75,
        sourceCitation: "O*NET Attention to Detail; Conscientiousness-orderliness is critical in compliance review.",
        facets: ["orderliness"],
      },
      {
        name: "Rule-orientation",
        onetRef: "Integrity",
        importance: 90,
        weight: 1.1,
        direction: "HIGH",
        targetPercentile: 70,
        sourceCitation: "O*NET Integrity; Conscientiousness-dutifulness + Agreeableness-morality predict rule adherence.",
        facets: ["dutifulness", "morality"],
      },
      {
        name: "Low impulsivity",
        onetRef: "Self-Control",
        importance: 85,
        weight: 1.0,
        direction: "LOW",
        targetPercentile: 30,
        sourceCitation: "O*NET Self-Control; low Neuroticism-immoderation guards against impulsive decisions.",
        facets: ["immoderation"],
      },
      {
        name: "Deliberation",
        onetRef: "Analytical Thinking",
        importance: 85,
        weight: 1.0,
        direction: "HIGH",
        targetPercentile: 70,
        sourceCitation: "O*NET Analytical Thinking; Conscientiousness-cautiousness supports careful judgement.",
        facets: ["cautiousness"],
      },
    ],
  },
  {
    familyKey: "leadership",
    title: "Leadership — starter profile",
    competencies: [
      {
        name: "Emotional stability",
        onetRef: "Stress Tolerance",
        importance: 85,
        weight: 1.0,
        direction: "LOW",
        targetPercentile: 35,
        sourceCitation: "O*NET Stress Tolerance; Judge et al. (2002): emotional stability predicts leader effectiveness.",
        facets: ["vulnerability"],
      },
      {
        name: "Assertiveness",
        onetRef: "Leadership",
        importance: 85,
        weight: 1.1,
        direction: "HIGH",
        targetPercentile: 70,
        sourceCitation: "O*NET Leadership; Extraversion-assertiveness predicts leadership emergence (Judge et al. 2002).",
        facets: ["assertiveness"],
      },
      {
        name: "Adaptability / Openness",
        onetRef: "Adaptability/Flexibility",
        importance: 75,
        weight: 0.9,
        direction: "MODERATE",
        targetPercentile: 60,
        sourceCitation: "O*NET Adaptability/Flexibility; Openness-adventurousness supports leading change.",
        facets: ["adventurousness"],
      },
      {
        name: "Conscientiousness",
        onetRef: "Dependability",
        importance: 80,
        weight: 1.0,
        direction: "HIGH",
        targetPercentile: 65,
        sourceCitation: "O*NET Dependability; Conscientiousness-self-discipline predicts managerial performance.",
        facets: ["self_discipline"],
      },
      {
        name: "Cooperation under pressure",
        onetRef: "Cooperation",
        importance: 75,
        weight: 0.9,
        direction: "HIGH",
        targetPercentile: 60,
        sourceCitation: "O*NET Cooperation; Agreeableness-cooperation sustains teams under stress.",
        facets: ["cooperation"],
      },
    ],
  },
];
