import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import type { Provider } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import type { Role } from "../generated/prisma/client";
import { prisma, prismaUnfiltered } from "./prisma";
import { verifyPassword, needsRehash, hashPassword } from "./password";
import {
  isPolisSsoConfigured,
  polisSsoConfig,
  isFederatedSignInAllowed,
  POLIS_PROVIDER_ID,
} from "./sso/config";

/**
 * SSO SEAM (ADR-013 / ADR-024): map an IdP's claims to our Role enum. Default is
 * least-privilege (VIEWER) so a misconfigured IdP can't grant ADMIN; an admin
 * promotes the user in-app after first SSO login. A fork that trusts its IdP's
 * group/role claims can override here, e.g.:
 *   if (claims?.groups?.includes("app-admins")) return "ADMIN";
 */
export function mapSsoRole(_claims: Record<string, unknown> | undefined): Role {
  return "VIEWER";
}

/**
 * SSO config resolution (ADR-024 Entra + ADR-045 Ory Polis). Pure function of env
 * so it is unit-testable without booting NextAuth. Every provider is dormant until
 * its env vars are set, mirroring the template's other opt-in features (Sentry,
 * cron). "One OIDC provider per deployment" (ADR-045): Entra is the OIDC-direct
 * path; a SAML-only tenant routes through the Polis SAML→OIDC sidecar.
 *   - entraEnabled: Microsoft Entra ID registered once id+secret+issuer are set.
 *   - polisEnabled: the generic Polis OIDC provider registered once its
 *     issuer+id+secret are set (see lib/sso/config.ts).
 *   - configured / ssoEnabled: ANY SSO provider is configured.
 *   - credentialsEnabled: password login is removed only when SSO is BOTH
 *     configured AND enforced (SSO-only) — that combination closes T-02.
 */
export function ssoProviderPlan(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  enforced: boolean;
  credentialsEnabled: boolean;
  ssoEnabled: boolean;
  entraEnabled: boolean;
  polisEnabled: boolean;
} {
  // Require id + secret + issuer together. id-only would render a broken button;
  // and omitting issuer would make MicrosoftEntraID default to the multi-tenant
  // `.../common/v2.0` endpoint, silently accepting ANY Microsoft account from ANY
  // tenant. Requiring a tenant-scoped issuer keeps SSO dormant until that audience
  // restriction is set explicitly (a fork wanting multi-tenant sets issuer=common).
  const entraEnabled = Boolean(
    env.AUTH_MICROSOFT_ENTRA_ID_ID &&
      env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
      env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
  );
  // Polis requires issuer+id+secret together for the same no-broken-button reason
  // (gate defined once in lib/sso/config.ts).
  const polisEnabled = isPolisSsoConfigured(env);
  const configured = entraEnabled || polisEnabled;
  const enforced = env.AUTH_ENFORCE_SSO === "true";
  return {
    configured,
    enforced,
    credentialsEnabled: !(configured && enforced),
    ssoEnabled: configured,
    entraEnabled,
    polisEnabled,
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

    const valid = await verifyPassword(
      credentials.password as string,
      user.passwordHash
    );
    if (!valid) return null;

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

/**
 * The Ory Polis SAML→OIDC provider (ADR-045). Polis bridges a tenant's SAML into
 * a standard OIDC endpoint, so this is a plain generic OIDC provider — no new
 * runtime dep. issuer discovery reads Polis's /.well-known/openid-configuration.
 * Optional tenant/product select the SAML connection (deploy-per-tenant bakes
 * them as fixed authorization params).
 *
 * INFRA-UNVERIFIED (ADR-045 wave-off): no live Polis is booted in-session, so the
 * Jackson-compat handshake settings below (client_secret_post token auth; `state`
 * check only — Jackson does not implement PKCE/nonce fully) are wired to the
 * documented contract, not end-to-end tested.
 *
 * allowDangerousEmailAccountLinking is ON, scoped to THIS provider ONLY (ADR-045
 * amendment A1): a SCIM-provisioned User row has no linked Account, so without
 * email-linking a provisioned user hits OAuthAccountNotLinked on first login and
 * the flagship US-1/US-2 workflow is dead-on-arrival. The "dangerous" part — a
 * spoofable email claim auto-linking to a REAL password user — is neutralized by
 * the `isFederatedSignInAllowed` guard in the signIn callback, which only permits
 * the link when the matched row is passwordless (a SCIM-created row). Entra keeps
 * the flag OFF (its collisions hard-block upstream).
 */
function polisOidcProvider(): Provider {
  const cfg = polisSsoConfig();
  const authorizationParams: Record<string, string> = {};
  if (cfg.tenant) authorizationParams.tenant = cfg.tenant;
  if (cfg.product) authorizationParams.product = cfg.product;
  return {
    id: POLIS_PROVIDER_ID,
    name: "SSO",
    type: "oidc",
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    ...(Object.keys(authorizationParams).length > 0
      ? { authorization: { params: authorizationParams } }
      : {}),
    client: { token_endpoint_auth_method: "client_secret_post" },
    checks: ["state"],
    // Scoped to Polis ONLY + paired with the passwordHash===null guard in signIn
    // (ADR-045 amendment A1): claims a passwordless SCIM row, blocks takeover of a
    // password user.
    allowDangerousEmailAccountLinking: true,
  } as Provider;
}

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
  if (plan.entraEnabled) {
    providers.push(
      MicrosoftEntraID({
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      })
    );
  }
  // Ory Polis SAML→OIDC bridge (ADR-045). Independent of Entra: a deployment can
  // run either, both, or neither.
  if (plan.polisEnabled) {
    providers.push(polisOidcProvider());
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
  // Credentials + (when configured) Microsoft Entra ID and/or Ory Polis SAML→OIDC
  // SSO. See buildProviders above, ADR-024 (Entra) and ADR-045 (Polis). New SSO
  // users land at the DB default role (VIEWER) via the PrismaAdapter, and an
  // admin promotes them in-app; the jwt callback deliberately does NOT call
  // mapSsoRole, so an in-app promotion survives the next SSO login. mapSsoRole is
  // the seam a fork wires into the jwt OAuth branch ONLY if it wants the IdP's
  // group/role claims to be authoritative (accepting that they override in-app changes).
  providers: buildProviders(),
  callbacks: {
    // The Credentials authorize() filters deletedAt:null, but the OAuth path goes
    // through PrismaAdapter (prismaUnfiltered), which does NOT — so without this a
    // soft-deleted (off-boarded) SSO user could keep signing in indefinitely.
    // Deny federated sign-in when the linked user row is soft-deleted. (Existing
    // JWTs persist until maxAge, same accepted gap as credentials; rotate
    // AUTH_SECRET to revoke immediately — SECURITY.md §2.) Match BOTH "oauth" and
    // "oidc" account types: Entra and Polis are OIDC providers, and Auth.js labels
    // an OIDC account's type "oidc" — keying on "oauth" alone would let a
    // SCIM-off-boarded Polis user re-authenticate (ADR-045 US-3). Only the
    // credentials path (type "credentials") is skipped — it already filters
    // deletedAt in authorize(). The same lookup also feeds the Polis
    // account-linking takeover guard (ADR-045 amendment A1): passwordHash is
    // selected so isFederatedSignInAllowed can permit a link only for a
    // passwordless (SCIM-provisioned) row and hard-block a real password user
    // with a colliding email. One indexed read covers both invariants.
    async signIn({ user, account }) {
      if ((account?.type === "oauth" || account?.type === "oidc") && user?.id) {
        const row = await prismaUnfiltered.user.findUnique({
          where: { id: user.id },
          select: { deletedAt: true, passwordHash: true },
        });
        return isFederatedSignInAllowed(row, account.provider);
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
