import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { preboardingView, resolvePreboarding } from "@/lib/jml/preboarding/joiner";
import { preboardingTokenSchema } from "@/lib/validations/jml/preboarding";
import { PreboardingForm } from "@/components/jml/preboarding/PreboardingForm";
import { PreboardingInvalid } from "@/components/jml/preboarding/PreboardingInvalid";

/**
 * `/preboarding/<token>` — P2-4, the joiner's form before day one (ADR-093).
 *
 * The token is resolved HERE, on the server, before anything renders: one open
 * joiner case, someone who has not started. Every failure (malformed, unknown,
 * expired, revoked, closed, started) renders the same prop-less invalid page,
 * so a guessed token learns nothing. `noindex`, never cached.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("jml.preboarding.public");
  return { title: t("title"), robots: { index: false, follow: false, nocache: true } };
}

export default async function PreboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = preboardingTokenSchema.safeParse(token);
  if (!parsed.success) return <PreboardingInvalid />;
  const grant = await resolvePreboarding(parsed.data);
  if (!grant) return <PreboardingInvalid />;
  const view = await preboardingView(grant.caseId);
  if (!view) return <PreboardingInvalid />;
  return <PreboardingForm token={parsed.data} view={view} />;
}
