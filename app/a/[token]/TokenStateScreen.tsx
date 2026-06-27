import { candidateStrings } from "@/lib/candidate-i18n";

// The non-active token states (UI-SPEC C.1): invalid / revoked / expired /
// completed. Each is a distinct, calm, branded screen — NOT a raw Next 404.
// Org-neutral copy (the page doesn't import prisma); EN only here (the candidate
// hasn't entered the flow, and these are dead-link states). Uses tokens so dark
// mode is automatic. The completed state is the post-submit thank-you.
export function TokenStateScreen({
  state,
}: {
  state: "invalid" | "revoked" | "expired" | "completed";
}) {
  const s = candidateStrings.en;
  const copy = {
    invalid: { title: s.invalidTitle, body: s.invalidBody },
    revoked: { title: s.revokedTitle, body: s.revokedBody },
    expired: { title: s.expiredTitle, body: s.expiredBody },
    completed: { title: s.alreadyDoneTitle, body: s.alreadyDoneBody },
  }[state];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[680px] flex-col items-center justify-center px-5 py-12 text-center">
      <p className="mb-8 font-display text-sm font-semibold tracking-tight text-primary dark:text-accent-ink">
        {s.wordmark}
      </p>
      <div className="w-full rounded-lg border border-border bg-card p-8 shadow-[var(--shadow-card)]">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {copy.title}
        </h1>
        <p className="mx-auto mt-3 max-w-[44ch] text-sm leading-relaxed text-muted-foreground">
          {copy.body}
        </p>
      </div>
    </main>
  );
}
