import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { mapSsoRole } from "./sso/role-map";
import type { Adapter } from "next-auth/adapters";
import type { Role } from "../generated/prisma/client";
import { prisma, prismaUnfiltered } from "./prisma";
import { verifyPassword, needsRehash, hashPassword } from "./password";
import { isAccountLocked, recordFailedLogin, clearFailedLogins } from "./account-lockout";
import { withAuditContext } from "./audit-context";

/**
 * Write the IdP-derived platform role onto the row SSO just created, and return
 * it — ADR-069.
 *
 * Since ADR-070 the seam can only hand this `ADMIN` or `VIEWER` (see
 * `lib/sso/role-map.ts`), so the early return below is now the only no-op case
 * and `EDITOR` can no longer be written here by any path.
 *
 * Called on the `signUp` trigger only, so this runs at most once per federated
 * account. It exists because the adapter creates the row with the schema default
 * (`VIEWER`) before any callback sees the profile: without this write the JWT
 * would carry the mapped role while `/admin/access` showed the default, and
 * `withAdminAuth` reads the JWT. A privilege that the directory listing does not
 * show is the failure this whole change set out to stop creating.
 *
 * On the AUDITED client, and inside an audit context naming the person signing
 * in: a platform-role assignment is exactly the kind of write ADR-010 exists for,
 * and the actor is not the system — it is them, arriving with those claims.
 *
 * A failure here must not break the sign-in. The mapped role is returned either
 * way, so the worst case is a session whose role is right and a row that still
 * says VIEWER — recoverable at `/admin/access`, and strictly better than refusing a
 * legitimate first login over a bookkeeping write.
 */
async function adoptSsoRole(userId: string, role: Role): Promise<Role> {
  if (role === "VIEWER") return role; // already the schema default; nothing to write.
  try {
    const user = await prismaUnfiltered.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    await withAuditContext({ userId, actorEmail: user?.email }, () =>
      prisma.user.update({ where: { id: userId }, data: { role } }),
    );
  } catch {
    // Deliberately swallowed — see above. Nothing about the error is safe to log
    // here: this path handles an identity provider's claims.
  }
  return role;
}

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
  // Credentials + optional enterprise SSO (ADR-069, following
  // `docs/recipes/saas/1-sso-oidc-saml.md` part (a)). SSO was removed on 2026-08-21
  // as a dormant layer; it comes back because the employee import now provisions
  // PASSWORDLESS accounts, and SSO is how their owners get in. ADR-024 and ADR-045
  // are superseded but kept as the historical record.
  //
  // ENV-GATED, exactly like `lib/email.ts`: with the vars unset the provider is not
  // registered at all, so an unconfigured deployment shows a credentials form and
  // no broken button. Credentials stays as break-glass for the bootstrap admin —
  // an IdP outage must not lock HR out of their own system.
  //
  // `allowDangerousEmailAccountLinking` is ON, and the name deserves an answer
  // rather than a shrug. It lets an IdP identity attach to an EXISTING `User` row
  // with the same email — which is the entire mechanism by which an
  // import-provisioned account becomes usable. It is dangerous when an app trusts
  // an unverified email from a public provider, because anyone who can register
  // that address inherits the account. Neither half applies here: the identities
  // come from the organisation's own directory, and the accounts it links to are
  // ones this system created FROM that directory, with no password to take over.
  // Turning it off would mean every imported employee hits "OAuthAccountNotLinked"
  // on their first sign-in, which is the gap this whole change exists to close.
  providers: [
    credentialsProvider,
    // All THREE, not just the client id: a half-configured provider would register
    // and then fail at the token exchange, which reads to the user as "SSO is
    // broken" rather than "SSO is not set up". Absent beats broken.
    ...(process.env.AUTH_ENTRA_ID &&
    process.env.AUTH_ENTRA_SECRET &&
    process.env.AUTH_ENTRA_TENANT_ID
      ? [
          MicrosoftEntraID({
            clientId: process.env.AUTH_ENTRA_ID,
            clientSecret: process.env.AUTH_ENTRA_SECRET,
            issuer: `https://login.microsoftonline.com/${process.env.AUTH_ENTRA_TENANT_ID}/v2.0`,
            authorization: { params: { scope: "openid profile email" } },
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
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
    async jwt({ token, user, account, profile, trigger }) {
      // Sign-in: stamp identity + the password epoch this token is bound to.
      if (user) {
        token.id = user.id!;
        // The IdP's groups decide the platform role for an account SSO ITSELF
        // CREATES, and only then (`trigger === "signUp"`). Every other sign-in
        // — credentials, or a federated sign-in onto a row that already existed
        // — takes the STORED role.
        //
        // The narrow rule is the deliberate one, and the two alternatives are
        // both worse:
        //
        //  - Re-mapping on every federated sign-in makes the directory
        //    authoritative, which sounds tidy until `SSO_ADMIN_GROUPS` is unset
        //    or misspelled: the next sign-in silently demotes every
        //    administrator to VIEWER, including the bootstrap admin, and nobody
        //    can reach /admin/access to undo it.
        //  - Mapping without persisting (what this first did) leaves the JWT
        //    saying ADMIN while the row says VIEWER. `withAdminAuth` reads the
        //    SESSION, so the grant is real — and invisible on the one screen
        //    that exists to show it. A privilege that no list shows is the kind
        //    this change set out to stop creating.
        //
        // So: `SSO_ADMIN_GROUPS` seeds a brand-new federated account, and
        // `/admin/access` governs it from then on. `adoptSsoRole` writes the mapped
        // role to the row so the session and the directory listing agree from
        // the first request.
        const federated = account?.type === "oauth" || account?.type === "oidc";
        token.role =
          federated && trigger === "signUp"
            ? await adoptSsoRole(user.id!, mapSsoRole(profile as Record<string, unknown>))
            : user.role;
        token.passwordChangedAt = user.passwordChangedAt?.getTime() ?? 0;
        // mustChangePassword is NOT taken from the sign-in user: the very next
        // request re-reads it below (that lookup runs on every request anyway).
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
          // `deletedAt` joins the epoch check for ADR-069's off-boarding: setting
          // an employee to LEAVER soft-deletes their `User`, and both sign-in
          // paths already refuse a soft-deleted account — but a session ISSUED
          // before the departure would otherwise survive until `maxAge`. A
          // revocation that leaves the departing person signed in for the rest
          // of the day is not a revocation.
          //
          // This read already happens on every request; `deletedAt` is one more
          // column on the same narrow indexed lookup, not a second query.
          select: { passwordChangedAt: true, deletedAt: true, mustChangePassword: true },
        });
        if (!current || current.deletedAt !== null) return null;
        // HR Centre F-d — re-read every request (this lookup already runs), so
        // the forced change applies and lifts without waiting for a new token.
        token.mustChangePassword = current.mustChangePassword;
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
        session.user.mustChangePassword = token.mustChangePassword === true;
      }
      return session;
    },
  },
});
