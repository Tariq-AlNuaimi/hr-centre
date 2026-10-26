/** Wire shapes of the /api/org/* reads, as the admin screens consume them. */

export type Company = {
  id: string;
  code: string;
  name: string;
  _count: { departments: number; employees: number };
};

export type Directorate = {
  id: string;
  name: string;
  entityId: string;
  entity: { id: string; code: string; name: string };
  _count: { departments: number };
};

export type Department = {
  id: string;
  name: string;
  entityId: string;
  directorateId: string | null;
  entity: { id: string; code: string; name: string };
  directorate: { id: string; name: string } | null;
  _count: { employees: number; teams: number };
};

export type Team = {
  id: string;
  name: string;
  departmentId: string;
  department: { id: string; name: string; entity: { id: string; code: string } };
  _count: { employees: number };
};
