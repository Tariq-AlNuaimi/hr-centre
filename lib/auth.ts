import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import type { Provider } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import bcrypt from "bcryptjs";
import type { Role } from "../generated/prisma/client";
import { prismaUnfiltered } from "./prisma";

/**
 * SSO SEAM (ADR-013 / ADR-024): map an IdP's claims to our Role enum. Default is
 * least-privilege (HIRING_MANAGER) so a misconfigured IdP can't grant HR_ADMIN;
 * an HR_ADMIN promotes the user in-app after first SSO login. A fork that trusts
 * its IdP's group/role claims can override here, e.g.:
 *   if (claims?.groups?.includes("hr-admins")) return "HR_ADMIN";
 */
export function mapSsoRole(_claims: Record<string, unknown> | undefined): Role {
  return "HIRING_MANAGER";
}

/**
 * SSO config resolution (ADR-024). Pure function of env so it is unit-testable
 * without booting NextAuth. Microsoft Entra ID is dormant until its env vars are
 * set, mirroring the template's other opt-in features (Sentry, cron).
 *   - credentialsEnabled: password login is removed only when SSO is BOTH
 *     configured AND enforced (SSO-only) — that combination closes T-02.
 *   - ssoEnabled: the Entra provider is registered once its client id is present.
 */
export function ssoProviderPlan(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  enforced: boolean;
  credentialsEnabled: boolean;
  ssoEnabled: boolean;
} {
  // Require id + secret + issuer together. id-only would render a broken button;
  // and omitting issuer would make MicrosoftEntraID default to the multi-tenant
  // `.../common/v2.0` endpoint, silently accepting ANY Microsoft account from ANY
  // tenant. Requiring a tenant-scoped issuer keeps SSO dormant until that audience
  // restriction is set explicitly (a fork wanting multi-tenant sets issuer=common).
  const configured = Boolean(
    env.AUTH_MICROSOFT_ENTRA_ID_ID &&
      env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
      env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
  );
  const enforced = env.AUTH_ENFORCE_SSO === "true";
  return {
    configured,
    enforced,
    credentialsEnabled: !(configured && enforced),
    ssoEnabled: configured,
  };
}

// Captured at module load (env is fixed at boot on Vercel). The login page reads
// these server-side to decide which controls to render.
export const ssoConfigured = ssoProviderPlan().configured;
export const ssoEnforced = ssoProviderPlan().enforced;

const credentialsProvider = Credentials({
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
      orgId: user.orgId,
      passwordChangedAt: user.passwordChangedAt,
    };
  },
});

function buildProviders(): Provider[] {
  const plan = ssoProviderPlan();
  const providers: Provider[] = [];
  // Credentials stays unless SSO is configured AND enforced (SSO-only).
  if (plan.credentialsEnabled) {
    providers.push(credentialsProvider);
  }
  // Microsoft Entra ID OIDC. allowDangerousEmailAccountLinking stays OFF
  // (default): an Entra login whose email matches an existing password user is
  // NOT auto-linked, which prevents account takeover via a spoofable email claim.
  if (plan.ssoEnabled) {
    providers.push(
      MicrosoftEntraID({
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      })
    );
  }
  return providers;
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
  // Credentials + (when configured) Microsoft Entra ID SSO. See buildProviders
  // above and ADR-024. New SSO users land at the DB default role (HIRING_MANAGER) and an
  // admin promotes them in-app; the jwt callback deliberately does NOT call
  // mapSsoRole, so an in-app promotion survives the next SSO login. mapSsoRole is
  // the seam a fork wires into the jwt OAuth branch ONLY if it wants the IdP's
  // group/role claims to be authoritative (accepting that they override in-app changes).
  providers: buildProviders(),
  callbacks: {
    // The Credentials authorize() filters deletedAt:null, but the OAuth path goes
    // through PrismaAdapter (prismaUnfiltered), which does NOT — so without this a
    // soft-deleted (off-boarded) SSO user could keep signing in indefinitely.
    // Deny OAuth sign-in when the linked user row is soft-deleted. (Existing JWTs
    // persist until maxAge, same accepted gap as credentials; rotate AUTH_SECRET to
    // revoke immediately — SECURITY.md §2.)
    async signIn({ user, account }) {
      // Match by account.type !== "credentials": Microsoft Entra ID registers as
      // type "oidc" (NOT "oauth"), so an === "oauth" check would silently never
      // fire and leave SSO users unguarded. A new (not-yet-linked) SSO user has no
      // DB row yet → findUnique returns null → row?.deletedAt is falsy → allowed
      // (onboarding proceeds); only an existing soft-deleted user is denied.
      if (account && account.type !== "credentials" && user?.id) {
        const row = await prismaUnfiltered.user.findUnique({
          where: { id: user.id },
          select: { deletedAt: true },
        });
        if (row?.deletedAt) return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      // Sign-in: stamp identity + the password epoch this token is bound to.
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.orgId = user.orgId ?? null;
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
        session.user.orgId = (token.orgId as string | null) ?? null;
      }
      return session;
    },
  },
});
