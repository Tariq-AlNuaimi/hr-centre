/** A role on the public careers board (`listOpenRoles`). */
export type CareersRole = {
  id: string;
  title: string;
  company: string;
  department: string;
  description: string;
  postedAt: string | null;
  slug: string;
};
