import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import bcrypt from "bcryptjs";
import type { Role } from "../generated/prisma/client";
import { prismaUnfiltered } from "./prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // @auth/prisma-adapter declares the adapter against the top-level @auth/core,
  // while next-auth resolves Adapter from its nested @auth/core (which carries
  // our role augmentation). Cast bridges the duplicate-dep version skew; runtime
  // is unaffected.
  adapter: PrismaAdapter(prismaUnfiltered) as Adapter,
  trustHost: true,
  session: { strategy: "jwt" },
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

        const user = await prismaUnfiltered.user.findUnique({
          where: {
            email: credentials.email as string,
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
        };
      },
    }),
    // Add OAuth providers via env vars:
    // Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
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
