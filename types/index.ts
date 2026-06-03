import type { Role } from "../generated/prisma/client";

// Extend next-auth session + user + JWT types so callbacks don't need `as any` casts.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: Role;
    };
  }

  interface User {
    role: Role;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}

// ApiResponse lives in lib/api-response.ts (the only producer of API envelopes);
// it is intentionally not re-declared here to avoid a drifting duplicate.

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
