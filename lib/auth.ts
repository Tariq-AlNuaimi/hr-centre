import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import bcrypt from "bcryptjs";
import type { Role } from "../generated/prisma/client";
import { prismaUnfiltered } from "./prisma";

/**
 * SSO SEAM (ADR-013): map an IdP's claims to our Role enum. Wire this in when a
 * `shared`-tier fork enables enterprise SSO (OIDC/SAML via Auth.js providers or
 * @boxyhq/saml-jackson). Default is least-privilege (VIEWER); a fork overrides
 * by group/role claim, e.g.:
 *   if (claims?.groups?.includes("app-admins")) return "ADMIN";
 * Keep the default restrictive so a misconfigured IdP can't grant ADMIN.
 */
export function mapSsoRole(_claims: Record<string, unknown> | undefined): Role {
  return "VIEWER";
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // @auth/prisma-adapter declares the adapter against the top-level @auth/core,
  // while next-auth resolves Adapter from its nested @auth/core (which carries
  // our role augmentation). Cast bridges the duplicate-dep version skew; runtime
  // is unaffected.
  adapter: PrismaAdapter(prismaUnfiltered) as Adapter,
  trustHost: true,
  // Explicit lifetime (NextAuth defaults to ~30 days when unset). Bounds how
  // long a stolen JWT is usable even absent a password change; the
  // passwordChangedAt check below revokes sooner on reset.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Normalize casing to match how emails are stored (emailSchema lowercases
        // on create; forgot-password lowercases on lookup) -- otherwise a
        // differently-cased login silently fails to match.
        const email = (credentials.email as string).toLowerCase().trim();
        const user = await prismaUnfiltered.user.findUnique({
          where: {
            email,
            deletedAt: null,
          },
        });

        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) return null;

        // Update last login
        await prismaUnfiltered.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          passwordChangedAt: user.passwordChangedAt,
        };
      },
    }),
    // Add OAuth / enterprise SSO providers via env vars (the SSO seam):
    // Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET }),
    // For OIDC (Entra/Okta/generic), add the provider here and map the role in
    // the jwt callback via mapSsoRole(profile claims). SAML: @boxyhq/saml-jackson.
    // See docs/decisions/ADR-013.
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Sign-in: stamp identity + the password epoch this token is bound to.
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.passwordChangedAt = user.passwordChangedAt?.getTime() ?? 0;
        return token;
      }
      // Subsequent requests: reject the token if the password changed after it
      // was issued (a completed reset stamps users.passwordChangedAt = now), or
      // if the user no longer exists. Returning null tears the session down on
      // the next request -- the point of the recovery flow.
      //
      // Cost: one narrow indexed read per request. A fork that prefers zero
      // per-request reads can drop this block and lean on session.maxAge alone,
      // accepting a stolen-token window of up to maxAge after a reset.
      if (token.id) {
        const current = await prismaUnfiltered.user.findUnique({
          where: { id: token.id as string },
          select: { passwordChangedAt: true },
        });
        if (!current) return null;
        const changedAt = current.passwordChangedAt?.getTime() ?? 0;
        if (changedAt > ((token.passwordChangedAt as number | undefined) ?? 0)) {
          return null;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        // Cast token fields explicitly: the JWT augmentation lives in
        // types/index.ts but isn't always picked up across the duplicate
        // @auth/core dep tree. Casts are narrow (not `as any`) so the
        // no-any-cast-on-session lint rule does not fire.
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
});
