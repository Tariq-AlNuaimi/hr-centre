import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export interface AuthCardProps {
  /** The card's sole <h1> — the page title (login / forgot / reset …). */
  title: ReactNode;
  /** Form, message, or link content below the title. */
  children: ReactNode;
}

/**
 * AuthCard — the fixed-width, centered card the auth pages share (ADR-032
 * ledger 2026-08-08). Owns the auth card's width, padding, and the centered
 * page <h1> on the shipped shadcn Card/CardContent, so login / forgot-password /
 * reset-password (and any fork's new auth screen) stay identical. The
 * split-screen brand panel lives in `(auth)/layout.tsx`; the sign-in logic
 * stays in each page. On-token; the h1 is the page's only <h1>.
 */
export function AuthCard({ title, children }: AuthCardProps) {
  return (
    <Card className="w-full max-w-[400px]">
      <CardContent className="p-6">
        <h1 className="mb-6 text-center text-h4 font-semibold text-card-foreground">{title}</h1>
        {children}
      </CardContent>
    </Card>
  );
}
