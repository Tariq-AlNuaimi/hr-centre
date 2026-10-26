"use client";

import { SIRAAJ_URL } from "@/lib/hive/mcp/siraaj";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { HiveLogo } from "@/components/hive/HiveLogo";
import { cn } from "@/lib/utils";

/**
 * ADR-070's thread, as the employee sees it (AC-9.5, AC-9.6, task 5.3b).
 *
 * ONE conversation and nothing around it: no topic sheet, no composer that could
 * start a new question, no transcript from the device. AC-9.6 is that a reply
 * link "SHALL NOT grant the topic menu as that person, SHALL NOT reach any other
 * escalation, and SHALL NOT restore general chat history" — so the absences here
 * are the feature, and the only navigation offered is a plain link out to
 * Siraaj (ADR-075), where employees ask anything else.
 *
 * The thread is passed IN from the server component that resolved the token.
 * Nothing here fetches it, so the token never has to be readable by client code
 * beyond the one POST it authorises.
 */

export interface ReplyThreadView {
  id: string;
  employeeName: string;
  question: string;
  answer: string | null;
  hrPairName: string;
  closed: boolean;
  /**
   * `at` is not rendered, and that is deliberate rather than an omission: a
   * timestamp on HR's reply invites "why did this take four days", which §5.4
   * specifically avoids by promising no turnaround time. The field is kept on
   * the type because it is what the messages are ORDERED by, server-side.
   */
  messages: { id: string; direction: string; body: string; at: Date | string }[];
}

type SendState = "idle" | "sending" | "sent" | "failed" | "tooMany";

export function ReplyClient({ token, thread }: { token: string; thread: ReplyThreadView }) {
  const t = useTranslations("hive.reply");
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<SendState>("idle");
  // Appended locally on success rather than refetched: the server has the row,
  // and a refetch would spend one of the token's own rate-limited reads to learn
  // something this client already knows.
  const [mine, setMine] = useState<string[]>([]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setState("sending");
    try {
      const res = await fetch(`/api/hive/reply/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setMine((prev) => [...prev, body]);
        setDraft("");
        setState("sent");
        return;
      }
      // A 404 here is the "too many follow-ups" or "closed" case as much as a
      // dead token — the route deliberately does not distinguish them (ADR-070
      // clause 6), so the message stays honest about what the employee can do
      // rather than guessing at why.
      setState(res.status === 429 ? "tooMany" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-[640px] flex-col gap-5 px-4 py-6">
      <header className="flex items-center gap-3">
        <HiveLogo size={32} />
        <h1 className="m-0 text-h4 font-bold text-foreground">{t("title")}</h1>
      </header>

      <section className="flex flex-col gap-2">
        <span className="px-1 text-xs text-muted-foreground">{t("youAsked")}</span>
        <p className="m-0 whitespace-pre-line rounded-2xl bg-primary px-4 py-3 text-base leading-relaxed text-primary-foreground">
          {thread.question}
        </p>
      </section>

      {thread.answer ? (
        <section className="flex flex-col gap-2">
          <span className="px-1 text-xs text-muted-foreground">{t("hrAnswered")}</span>
          {/* Rendered verbatim: §4.3 makes paraphrasing a liability question, and
              this is HR's approved text. */}
          <p className="m-0 whitespace-pre-line rounded-2xl border border-hive-lavender-edge bg-hive-lavender px-4 py-3 text-base leading-relaxed text-foreground">
            {thread.answer}
          </p>
          <span className="px-1 text-xs text-muted-foreground">
            {t("reviewedBy", { pair: thread.hrPairName })}
          </span>
        </section>
      ) : (
        <p className="m-0 px-1 text-sm text-muted-foreground">{t("answerPending")}</p>
      )}

      {thread.messages.length > 0 && (
        <section className="flex flex-col gap-3">
          {thread.messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-1",
                m.direction === "INBOUND" ? "items-end" : "items-start",
              )}
            >
              <span className="px-1 text-xs text-muted-foreground">
                {m.direction === "INBOUND" ? t("youFollowedUp") : t("hrReplied")}
              </span>
              <p
                className={cn(
                  "m-0 max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 text-base leading-relaxed",
                  m.direction === "INBOUND"
                    ? "bg-primary text-primary-foreground"
                    : "border border-hive-lavender-edge bg-hive-lavender text-foreground",
                )}
              >
                {m.body}
              </p>
            </div>
          ))}
        </section>
      )}

      {mine.map((body, i) => (
        <div key={`local-${i}`} className="flex flex-col items-end gap-1">
          <span className="px-1 text-xs text-muted-foreground">{t("youFollowedUp")}</span>
          <p className="m-0 max-w-[85%] whitespace-pre-line rounded-2xl bg-primary px-4 py-3 text-base leading-relaxed text-primary-foreground">
            {body}
          </p>
        </div>
      ))}

      {thread.closed ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-border px-4 py-4">
          <h2 className="m-0 text-base font-semibold text-foreground">{t("closedTitle")}</h2>
          <p className="m-0 text-sm text-muted-foreground">{t("closedBody")}</p>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <label htmlFor="follow-up" className="px-1 text-sm text-foreground">
            {t("followUpLabel")}
          </label>
          <textarea
            id="follow-up"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("followUpPlaceholder")}
            className="min-h-24 w-full rounded-2xl border border-input bg-background p-3 text-base"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void send()}
              disabled={state === "sending" || draft.trim().length === 0}
              className="inline-flex items-center justify-center rounded-2xl bg-primary px-5 py-3 text-base font-semibold text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {state === "sending" ? t("sending") : t("send")}
            </button>
            {state === "sent" && <span className="text-sm text-muted-foreground">{t("sent")}</span>}
            {state === "failed" && (
              <span className="text-sm text-destructive">{t("sendFailed")}</span>
            )}
            {state === "tooMany" && (
              <span className="text-sm text-muted-foreground">{t("tooMany")}</span>
            )}
          </div>
        </section>
      )}

      {/* The ONLY navigation on this page: out to Siraaj, where employees ask
          HR questions since ADR-075. It grants nothing about this thread. */}
      <a
        href={SIRAAJ_URL}
        className="px-1 text-sm text-muted-foreground underline underline-offset-4"
      >
        {t("askSiraaj")}
      </a>
    </main>
  );
}
