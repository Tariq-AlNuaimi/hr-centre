import { NextResponse, type NextRequest } from "next/server";
import { withApiAuth, withRateLimit } from "@/lib/api-helpers";
import { handleMcpMessage, parseErrorResponse } from "@/lib/hive/mcp/protocol";
import { hiveMcpServer } from "@/lib/hive/mcp/tools";
import { mcpIdentitySchema } from "@/lib/validations/hive/mcp";

/**
 * HIVE's MCP server for Siraaj (ADR-074, ADR-075) — Streamable HTTP, stateless.
 *
 * Machine-only: `withApiAuth` checks `Authorization: Bearer <HIVE_MCP_TOKEN>` in
 * constant time and answers 503 while the variable is unset, so the endpoint is
 * dark until an admin deliberately turns it on. Middleware lets the path through
 * BY EXACT NAME (`i18n/route-decision.ts`); this wrapper is the control.
 * `withRateLimit` composes outside it so a flood is refused before any work.
 *
 * What a leaked token can do is bounded by the tools: read routing, rotation,
 * discount, provider and org-chart data, and open a ticket that HR must review
 * before anything is sent (§5.4). It cannot read a ticket, a person or the HR
 * back office.
 */

// Every call comes from Siraaj's server — ONE caller IP for the whole company —
// so this is a flood backstop sized for peak use, not a per-person limit. The
// per-person control on the one write is the 3-tickets-an-hour cap per employee
// email in `createEscalation`.
const LIMIT = { id: "hive-mcp", limit: 300, windowMs: 60_000 };

export const POST = withRateLimit(
  withApiAuth("HIVE_MCP_TOKEN", async (req: NextRequest) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(parseErrorResponse(), { status: 400 });
    }
    // Blueprint OQ-S1: Siraaj may forward the signed-in employee. Absent is
    // fine (the ticket then counts against the unverified ceiling); PRESENT but
    // malformed is refused, not quietly downgraded to the model's say-so.
    const header = req.headers.get("x-siraaj-user-email");
    let verifiedEmail: string | null = null;
    if (header !== null) {
      const forwarded = mcpIdentitySchema.safeParse(header);
      if (!forwarded.success) {
        return NextResponse.json(
          { error: "X-Siraaj-User-Email is not a Rihal work address." },
          { status: 400 },
        );
      }
      verifiedEmail = forwarded.data;
    }
    const response = await handleMcpMessage(hiveMcpServer(verifiedEmail), body);
    if (!response) return new NextResponse(null, { status: 202 });
    return NextResponse.json(response);
  }),
  LIMIT,
);

/** No server-initiated stream: this server never pushes (spec: 405 is the answer). */
export const GET = withApiAuth("HIVE_MCP_TOKEN", async () =>
  NextResponse.json(
    { error: "This MCP server does not open an event stream." },
    { status: 405, headers: { Allow: "POST" } },
  ),
);
