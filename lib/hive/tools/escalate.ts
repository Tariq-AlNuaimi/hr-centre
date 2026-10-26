import { registerTool, type ToolContext, type ToolResult } from "./index";
import { createEscalation } from "@/lib/hive/services/escalation";
import { formatTicketId } from "@/lib/hive/ticket-id";
import { getTicketSettings } from "@/lib/hive/services/ticket-settings";
import {
  ESCALATION_QUESTION_MAX,
  escalationCaptureSchema,
} from "@/lib/validations/hive/escalation";

/**
 * §5.4's escalation, as the one tool that writes (US9).
 *
 * `tools/index.ts` states the invariant this file has to keep: every tool is
 * read-only "except `escalate`, and `escalate` cannot send anything: it opens a
 * row that a human must approve (§5.3, AC-11.1)". So the worst outcome of a
 * prompt-injected model calling this is a row in a queue that a person reads.
 *
 * **AC-9.1 is a timing rule, and timing cannot be enforced from inside a tool.**
 * "Request full name and work email in one step, at that moment only, and never
 * upfront" is about when the model ASKS, which is the prompt's job. What this
 * file can do — and does — is refuse to be useful early: called without a name
 * and email it returns the ASK rather than a half-written row, so a model that
 * jumps the gun gets a prompt back instead of a partial record of someone who
 * never agreed to be identified. §5.1's "fully anonymous" is a property of the
 * database, not a promise in a paragraph.
 *
 * **AC-9.3 is enforced by what this returns.** "SHALL NOT state or imply a
 * response timeframe": there is no `expectedBy`, no SLA, no "within N days" in
 * any branch, and the confirmation text says so out loud. A field like that is
 * how a timeframe gets promised — the model reads it and repeats it.
 *
 * @public
 */

interface EscalateArgs {
  employeeName?: unknown;
  employeeEmail?: unknown;
  question?: unknown;
  directorate?: unknown;
  company?: unknown;
}

export async function runEscalate(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as EscalateArgs;

  // Nothing is written until all three are present. `safeParse`, not `parse`:
  // this input came from a language model relaying an anonymous stranger, and a
  // thrown error here would surface as `tool_failed` — a worse answer than the
  // ask it should be.
  const parsed = escalationCaptureSchema.safeParse({
    employeeName: args.employeeName,
    employeeEmail: args.employeeEmail,
    question: args.question,
    directorate: typeof args.directorate === "string" ? args.directorate : undefined,
    company: typeof args.company === "string" ? args.company : undefined,
  });

  if (!parsed.success) {
    // Which of the three is wrong decides what to ask for, and §5.4 step 2 asks
    // for name and email TOGETHER — "in one step".
    const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));

    // A REJECTED email outranks a missing question, because it is the specific,
    // actionable correction: someone who typed a personal address and has not
    // yet had their question confirmed should be told about the address, not
    // asked to restate the question and left to type the same address again.
    // A REJECTED address, not a missing one. `typeof === "string"` alone was
    // true for `""`, so an employee who had given nothing was told their address
    // looked wrong — and the missing NAME went unmentioned.
    const gaveEmail = typeof args.employeeEmail === "string" && args.employeeEmail.trim() !== "";
    if (bad.has("employeeEmail") && gaveEmail) {
      return {
        status: "need_identity",
        detail:
          "That does not look like a Rihal work email. Ask again for their work address — " +
          "warmly, once — and never send an HR answer to a personal address.",
      };
    }
    if (bad.has("question")) {
      // Too long is a DIFFERENT problem from missing, and "do not invent the
      // question" cannot fix a length failure — the model re-sends the same
      // 3,000 characters until the engine gives up and the employee sees a
      // failure for a question that was perfectly clear.
      const tooLong =
        typeof args.question === "string" && args.question.trim().length > ESCALATION_QUESTION_MAX;
      return {
        status: "need_question",
        detail: tooLong
          ? `That question is too long to pass on (limit ${ESCALATION_QUESTION_MAX} characters). Ask them for the short version — one or two sentences — and send that.`
          : "Confirm what they want asked, in their own words, before taking anything else. Do not " +
            "invent the question from the conversation.",
      };
    }
    return {
      status: "need_identity",
      detail:
        "Ask for their full name and work email TOGETHER, in one message, and only now — not " +
        "earlier in the conversation. Say it is so HR can reply to them directly.",
    };
  }

  const result = await createEscalation(parsed.data, {
    sessionId: ctx.sessionId,
    source: ctx.source,
    identityVerified: ctx.identityVerified,
    companyId: ctx.companyId,
    orgUnitId: ctx.orgUnitId,
  });

  if ("error" in result && result.error === "rate_limited") {
    return {
      status: "already_raised",
      detail:
        "They have already raised the questions this conversation can pass on. Say warmly that " +
        "HR has what they sent and will reply by email, and offer to keep helping with anything " +
        "else — do not raise another.",
    };
  }

  if ("error" in result) {
    return {
      error: "no_hr_pairs",
      detail:
        // The ONE Admin@rihal.om left in the codebase after §6.4's A-1
        // amendment, and deliberately: this branch fires when NO HR Tag pair
        // exists to receive the escalation, so "ask your HR Tag" would be
        // circular. A named address is the only thing left that reaches a
        // person, and inventing one would be worse than keeping this.
        "No HR Tag pair is set up to receive this. Say plainly that you could not pass it on and " +
        "suggest they email Admin@rihal.om — do not claim it has been sent.",
    };
  }

  // Spec V2 §8.8: the prefix HR set, so Siraaj quotes the ID the queue shows.
  const { ticketPrefix } = await getTicketSettings();

  if (result.duplicate) {
    return {
      status: "already_raised",
      pair: result.pairName,
      ticket: formatTicketId(result.ticketNumber, ticketPrefix),
      replyTo: parsed.data.employeeEmail,
      detail:
        `That question is already with ${result.pairName} — nothing new was raised. Tell them it ` +
        `is in hand and that a person will reply by email. Say nothing about WHEN.`,
    };
  }

  return {
    status: "raised",
    pair: result.pairName,
    // Spec V2 §8.6's ticket card is built from these two fields by the engine,
    // never from the model's prose (the same rule as the HR Tag card).
    ticket: formatTicketId(result.ticketNumber, ticketPrefix),
    replyTo: parsed.data.employeeEmail,
    // AC-9.3. Stated as an instruction rather than left to the model's manners:
    // the reassuring sentence everyone writes at this moment is exactly what the
    // spec forbids. Phrased WITHOUT quoting the offending phrases — naming them
    // here would put them in the model's context, and a contract test scans this
    // string for them, which is the check working as intended.
    detail:
      `Passed to ${result.pairName} as ticket ${formatTicketId(result.ticketNumber, ticketPrefix)}. Tell them ` +
      `the ticket number and who it went to by name, and that a person will ` +
      `reply to them by email. Say nothing at all about WHEN — do not estimate it, hint at it, ` +
      `or promise it.`,
  };
}

registerTool({
  definition: {
    type: "function",
    function: {
      name: "escalate",
      description:
        "Pass a question to the employee's HR Tag pair when you genuinely cannot answer it. Call " +
        "this ONLY after they have agreed to it and given you their full name and work email — " +
        "ask for those two together, at that moment, never earlier in the conversation. This " +
        "does not send anything: a person at Rihal HR reads and answers it.",
      parameters: {
        type: "object",
        properties: {
          employeeName: {
            type: "string",
            description: "Their full name, as they gave it. Never guess it.",
          },
          employeeEmail: {
            type: "string",
            description: "Their Rihal work email, as they gave it. Never guess it.",
          },
          question: {
            type: "string",
            description:
              "What they want asked, in their own words. Confirm it with them rather than " +
              "summarising the conversation for them.",
          },
          directorate: {
            type: "string",
            description:
              "Their directorate or department if known, so it reaches the right HR pair.",
          },
          company: {
            type: "string",
            description: "Their company if known ('Rihal', 'Transformation Pioneers', 'Codeline').",
          },
        },
        required: ["employeeName", "employeeEmail", "question"],
      },
    },
  },
  run: runEscalate,
});
