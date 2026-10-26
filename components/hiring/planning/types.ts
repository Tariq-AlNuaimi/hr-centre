export type NeedRow = {
  id: string;
  departmentId: string;
  department: string;
  owner: { id: string; name: string; email: string } | null;
  status: string;
  rolesRequested: number | null;
  agreedRoles: number | null;
  lastContact: { kind: string; at: string | null };
  noteCount: number;
  raised: { id: string; title: string; status: string }[];
  blockedReason: string | null;
};

export type RoundView = {
  id: string;
  label: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  entity: { id: string; name: string } | null;
  needs: NeedRow[];
  stats: {
    departmentsAsked: number;
    responded: number;
    outstanding: number;
    rolesRequested: number;
    agreedAfterChallenge: number;
    stillToDiscuss: number;
    raisedDepartments: string[];
    readyToRaise: string[];
  };
  truncated: boolean;
  canManage: boolean;
};
