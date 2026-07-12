import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { defaultLocale } from "@/i18n/config";
import ApiReferenceView from "./ApiReferenceView";

export const metadata = { title: "API Reference" };

// GET /api-reference -- the interactive Scalar API reference (ADR-052, US2).
//
// Internal-gated (ADR-052 decision 1 / US2-worst): a server-side session check,
// the same way other authed pages gate (mirrors the audit-log page). `middleware`
// also gates this path, so this check is defense in depth. Scalar fetches
// `/api/openapi` same-origin, so the request carries the session cookie and the
// `withAuth`-wrapped spec route authorizes it.
export default async function ApiReferencePage() {
  const session = await auth();
  if (!session) redirect(`/${defaultLocale}/login`);
  return <ApiReferenceView />;
}
