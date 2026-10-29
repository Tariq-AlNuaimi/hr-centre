/** Wire shapes of the /api/org/* reads, as the admin screens consume them. */

/** A unit's head (overnight item 2), or null. */
export type UnitHead = { id: string; name: string; status?: string } | null;

export type Company = {
  id: string;
  code: string;
  name: string;
  head: UnitHead;
  _count: { departments: number; employees: number };
};

export type Directorate = {
  id: string;
  name: string;
  entityId: string;
  entity: { id: string; code: string; name: string };
  head: UnitHead;
  _count: { departments: number };
};

export type Department = {
  id: string;
  name: string;
  entityId: string;
  directorateId: string | null;
  entity: { id: string; code: string; name: string };
  directorate: { id: string; name: string } | null;
  head: UnitHead;
  _count: { employees: number; teams: number };
};

export type Team = {
  id: string;
  name: string;
  departmentId: string;
  department: { id: string; name: string; entity: { id: string; code: string } };
  head: UnitHead;
  _count: { employees: number };
};
