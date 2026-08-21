import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import type { Role } from "../generated/prisma/client";
import { prisma, prismaUnfiltered } from "./prisma";
import { verifyPassword, needsRehash, hashPassword } from "./password";
import { isAccountLocked, recordFailedLogin, clearFailedLogins } from "./account-lockout";

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

    // Per-account brute-force lockout (OWASP A07). Checked BEFORE the lookup + password
    // comparison so a locked account can't be probed and we don't burn an Argon2 verify
    // on a locked email. The per-IP limiter on /api/auth/* cannot cover this: an attacker
    // rotating IPs stays under every IP bucket while hammering one account.
    if (await isAccountLocked(email)) return null;

    const user = await prismaUnfiltered.user.findUnique({
      where: {
        email,
        deletedAt: null,
      },
    });

    // A miss and a bad password BOTH count toward the lock and BOTH return null, so the
    // response is indistinguishable either way — the login path stays non-enumerable.
    if (!user?.passwordHash) {
      await recordFailedLogin(email);
      return null;
    }

    const valid = await verifyPassword(credentials.password as string, user.passwordHash);
    if (!valid) {
      await recordFailedLogin(email);
      return null;
    }

    // Authenticated: drop the failure counter so a later honest typo starts from zero.
    await clearFailedLogins(email);

    // Update last login. lastLoginAt churns on every login, so keep it on the
    // unaudited client to avoid flooding the audit log with a row per sign-in.
    await prismaUnfiltered.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Silently upgrade a legacy (bcrypt) hash to Argon2id on successful auth
    // (ADR-039). Route THIS write through the AUDITED client so the passwordHash
    // mutation is recorded (value scrubbed via SCRUB_FIELDS), consistent with
    // every other password-touching path (SECURITY.md §5). No audit context is
    // set during authorize(), so the row is attributed to the system actor
    // (userId null) — the honest record for a login-triggered rehash. It does NOT
    // bump passwordChangedAt: the password itself did not change, so the user's
    // existing sessions must not be revoked.
    if (needsRehash(user.passwordHash)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(credentials.password as string) },
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      passwordChangedAt: user.passwordChangedAt,
    };
  },
});

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
  // Credentials only. Enterprise SSO (Microsoft Entra, and the Ory Polis SAML→OIDC
  // bridge) was removed on 2026-08-21 as the last unexecuted item of the audit's A1
  // dormant-layer cut -- it was configuration-gated and off in every fork that never
  // set its env vars. `docs/recipes/saas/1-sso-oidc-saml.md` re-adds it; ADR-024 and
  // ADR-045 are superseded but kept as the historical record.
  providers: [credentialsProvider],
  callbacks: {
    // KEPT DELIBERATELY, though no OAuth provider ships today.
    //
    // The Credentials authorize() filters `deletedAt: null`, but a federated path goes
    // through PrismaAdapter (prismaUnfiltered), which does NOT -- so without this guard a
    // soft-deleted (off-boarded) SSO user keeps signing in indefinitely. The SSO providers
    // were removed on 2026-08-21 (audit A1), which makes this branch unreachable RIGHT NOW
    // and dead code by the letter of the Maintainable pillar. It stays anyway: the
    // `/scale-up` SSO recipe re-adds a provider, and a fork that follows it would silently
    // reacquire an off-boarding hole if the guard had to be re-derived. Eleven lines that
    // activate exactly when they become load-bearing beat a trap laid for the next reader.
    //
    // Matches BOTH "oauth" and "oidc": Auth.js labels an OIDC account's type "oidc", so
    // keying on "oauth" alone would miss every OIDC provider. Existing JWTs persist until
    // maxAge -- the same accepted gap as credentials; rotate AUTH_SECRET to revoke now
    // (SECURITY.md §2).
    async signIn({ user, account }) {
      if ((account?.type === "oauth" || account?.type === "oidc") && user?.id) {
        const row = await prismaUnfiltered.user.findUnique({
          where: { id: user.id },
          select: { deletedAt: true },
        });
        return row !== null && row.deletedAt === null;
      }
      return true;
    },
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
