/** A role on the public careers board (`listOpenRoles`). */
export type CareersRole = {
  id: string;
  title: string;
  company: string;
  department: string;
  description: string;
  postedAt: string | null;
  slug: string;
  location: { city: string; country: string; arrangement: "ON_SITE" | "HYBRID" | "REMOTE" };
  /** "Muscat, Oman". */
  place: string;
};
