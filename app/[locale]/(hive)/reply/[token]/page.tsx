import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveReplyToken } from "@/lib/hive/reply-token";
import { loadReplyThread } from "@/lib/hive/services/reply";
import { replyTokenSchema } from "@/lib/validations/hive/reply";
import { ReplyClient } from "@/components/hive/reply/ReplyClient";
import { ReplyInvalid } from "@/components/hive/reply/ReplyInvalid";

/**
 * `/reply/<token>` — ADR-070's thread view (AC-9.4…AC-9.7, task 5.3b).
 *
 * The token is resolved HERE, on the server, before anything renders. A client
 * component that fetched the thread itself would flash an empty shell at someone
 * holding a dead link, and would put the decision about what an invalid link
 * reveals into the browser.
 *
 * AC-9.7 is the whole of the failure path: an expired, malformed or revoked link
 * "SHALL say so plainly and offer to start a fresh question, and SHALL NOT reveal
 * the employee's name, email, question, or any part of the answer." All four
 * failures reach {@link ReplyInvalid}, which knows nothing about the escalation
 * because it is never given anything — there is no prop it could leak.
 *
 * `noindex` because the page renders Confidential data (§1) behind a bearer
 * token that will end up in browser history and, on some clients, a Referer.
 */
/**
 * Never prerendered and never cached. The page's content depends on a token and
 * on data that changes when HR act; a cached copy would be one employee's
 * Confidential thread served from an edge to whoever asked next.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hive.reply");
  return {
    title: t("title"),
    // Deliberately no description: it would be built from the thread, and this
    // page's whole point is that its content does not travel.
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function ReplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = replyTokenSchema.safeParse(token);
  if (!parsed.success) return <ReplyInvalid />;

  const grant = await resolveReplyToken(parsed.data);
  if (!grant) return <ReplyInvalid />;

  const thread = await loadReplyThread(grant.escalationId);
  if (!thread) return <ReplyInvalid />;

  // `createdAt` is dropped on the way out. It is not rendered — §5.4 promises no
  // turnaround time, and a date on the question invites the question that
  // promise avoids — so passing it would put it in the RSC payload for nothing.
  const { createdAt: _unused, ...view } = thread;
  return <ReplyClient token={parsed.data} thread={view} />;
}
