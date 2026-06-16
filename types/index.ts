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
    // Stamped by the credentials provider so the jwt callback can bind a token
    // to the password epoch and revoke it after a reset.
    passwordChangedAt?: Date | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    // Epoch (ms) of the password this token is bound to; 0 if never changed.
    passwordChangedAt?: number;
  }
}

// ApiResponse lives in lib/api-response.ts (the only producer of API envelopes);
// it is intentionally not re-declared here to avoid a drifting duplicate.
//
// PaginatedResponse has a single home in lib/pagination.ts (its only producer);
// re-exported here so client code can keep importing it from `@/types`.
export type { PaginatedResponse } from "@/lib/pagination";
