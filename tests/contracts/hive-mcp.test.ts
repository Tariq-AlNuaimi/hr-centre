import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// ADR-074 / ADR-075: HIVE's MCP server is how Siraaj — the employee front door
// since the chat was retired — reaches HR. It is the ONLY way a ticket can be
// opened now, and the only HIVE route another system's language model drives.
// So the tests pin three things:
//   1. the door: no token, no entry; an unset token keeps the endpoint dark;
//   2. the protocol: the JSON-RPC shape Siraaj's MCP client expects;
//   3. the tools: one name per existing HIVE tool, tickets marked SIRAAJ, and a
//      forwarded employee identity that the model cannot override.
// The real route, real `withApiAuth`, real protocol and real adapters run; only
// Prisma-backed tools and the rate limiter are replaced.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

/** What the adapters handed to the HIVE tool layer. */
let calls: { name: string; args: Record<string, unknown>; ctx: Record<string, unknown> }[] = [];
/** What the fake tool layer answers. */
let toolResult: Record<string, unknown> = { status: "raised", ticket: "HIVE-0047" };

const DEFINITIONS = [
  "escalate",
  "hr_tag",
  "office_rotation",
  "employee_discounts",
  "network_providers",
  "organization_structure",
].map((name) => ({
  type: "function",
  function: { name, description: `${name} description`, parameters: { type: "object" } },
}));

type Handler = (req: NextRequest, ctx: unknown) => Promise<Response>;
let route: { POST: Handler; GET: Handler };

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/rate-limit.ts"), {
    namedExports: { rateLimit: async () => ({ ok: true, remaining: 59, reset: 0 }) },
  });
  mockApi.module!(import.meta.resolve("../../lib/hive/tools/register.ts"), { namedExports: {} });
  mockApi.module!(import.meta.resolve("../../lib/hive/tools/index.ts"), {
    namedExports: {
      toolDefinitions: () => DEFINITIONS,
      runTool: async (name: string, raw: string, ctx: Record<string, unknown>) => {
        calls.push({ name, args: JSON.parse(raw), ctx });
        return toolResult;
      },
    },
  });
  route = (await import(import.meta.resolve("../../app/api/mcp/route.ts"))) as {
    POST: Handler;
    GET: Handler;
  };
});

function reset(token: string | null = "s3cret-token") {
  calls = [];
  toolResult = { status: "raised", ticket: "HIVE-0047" };
  if (token === null) delete process.env.HIVE_MCP_TOKEN;
  else process.env.HIVE_MCP_TOKEN = token;
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return route.POST(
    new NextRequest("http://x/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer s3cret-token",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

const rpc = (method: string, params?: Record<string, unknown>, id: number | null = 1) => ({
  jsonrpc: "2.0",
  ...(id === null ? {} : { id }),
  method,
  ...(params ? { params } : {}),
});

describe("the door", { skip: !canMock }, () => {
  test("while HIVE_MCP_TOKEN is unset the endpoint is dark (503) and runs nothing", async () => {
    reset(null);
    const res = await post(rpc("tools/list"));
    assert.equal(res.status, 503);
    assert.equal(calls.length, 0);
  });

  test("a wrong or missing token is refused (401)", async () => {
    reset();
    assert.equal((await post(rpc("tools/list"), { authorization: "Bearer nope" })).status, 401);
    assert.equal((await post(rpc("tools/list"), { authorization: "" })).status, 401);
  });

  test("GET answers 405 — this server never opens an event stream", async () => {
    reset();
    const res = await route.GET(
      new NextRequest("http://x/api/mcp", { headers: { authorization: "Bearer s3cret-token" } }),
      { params: Promise.resolve({}) },
    );
    assert.equal(res.status, 405);
  });
});

describe("the protocol", { skip: !canMock }, () => {
  test("initialize negotiates a supported version and advertises tools", async () => {
    reset();
    const body = (await (
      await post(rpc("initialize", { protocolVersion: "2025-03-26" }))
    ).json()) as {
      result: {
        protocolVersion: string;
        capabilities: { tools: unknown };
        serverInfo: { name: string };
      };
    };
    assert.equal(body.result.protocolVersion, "2025-03-26");
    assert.ok(body.result.capabilities.tools);
    assert.equal(body.result.serverInfo.name, "hive");
  });

  test("an unknown protocol version gets the newest one offered back", async () => {
    reset();
    const body = (await (
      await post(rpc("initialize", { protocolVersion: "1999-01-01" }))
    ).json()) as {
      result: { protocolVersion: string };
    };
    assert.equal(body.result.protocolVersion, "2025-11-25");
  });

  test("a notification is acknowledged with 202 and no body", async () => {
    reset();
    const res = await post(rpc("notifications/initialized", undefined, null));
    assert.equal(res.status, 202);
  });

  test("bad JSON, batches and unknown methods are JSON-RPC errors, not crashes", async () => {
    reset();
    const parse = await post("{not json");
    assert.equal(parse.status, 400);
    assert.equal(((await parse.json()) as { error: { code: number } }).error.code, -32700);
    const batch = (await (await post([rpc("ping")])).json()) as { error: { code: number } };
    assert.equal(batch.error.code, -32600);
    const unknown = (await (await post(rpc("resources/list"))).json()) as {
      error: { code: number };
    };
    assert.equal(unknown.error.code, -32601);
  });
});

describe("the tools", { skip: !canMock }, () => {
  test("tools/list offers the six HIVE tools under hive_ names", async () => {
    reset();
    const body = (await (await post(rpc("tools/list"))).json()) as {
      result: { tools: { name: string; inputSchema: unknown }[] };
    };
    assert.deepEqual(body.result.tools.map((t) => t.name).sort(), [
      "hive_employee_discounts",
      "hive_find_hr_tag",
      "hive_network_providers",
      "hive_office_rotation",
      "hive_open_ticket",
      "hive_org_structure",
    ]);
    assert.ok(body.result.tools.every((t) => t.inputSchema));
  });

  test("hive_open_ticket runs HIVE's own escalate tool and marks the ticket SIRAAJ", async () => {
    reset();
    const body = (await (
      await post(
        rpc("tools/call", {
          name: "hive_open_ticket",
          arguments: { employeeName: "Salim", employeeEmail: "salim@rihal.om", question: "q" },
        }),
      )
    ).json()) as { result: { structuredContent: { ticket: string }; isError: boolean } };
    assert.equal(calls[0]?.name, "escalate");
    assert.equal(calls[0]?.ctx.source, "SIRAAJ");
    assert.equal(calls[0]?.ctx.sessionId, null);
    assert.equal(body.result.structuredContent.ticket, "HIVE-0047");
    assert.equal(body.result.isError, false);
  });

  test("a forwarded employee identity overrides the email the model supplied (OQ-S1)", async () => {
    reset();
    await post(
      rpc("tools/call", {
        name: "hive_open_ticket",
        arguments: { employeeName: "x", employeeEmail: "colleague@rihal.om", question: "q" },
      }),
      { "x-siraaj-user-email": "Salim.Real@rihal.om" },
    );
    assert.equal(calls[0]?.args.employeeEmail, "salim.real@rihal.om");
  });

  test("a forwarded identity that is not a Rihal mailbox is REFUSED, not downgraded", async () => {
    reset();
    const res = await post(
      rpc("tools/call", {
        name: "hive_open_ticket",
        arguments: { employeeName: "x", employeeEmail: "salim@rihal.om", question: "q" },
      }),
      { "x-siraaj-user-email": "attacker@example.com" },
    );
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0, "nothing ran on a malformed identity");
  });

  test("tickets record whether the identity was forwarded", async () => {
    reset();
    const args = { employeeName: "x", employeeEmail: "salim@rihal.om", question: "q" };
    await post(rpc("tools/call", { name: "hive_open_ticket", arguments: args }));
    await post(rpc("tools/call", { name: "hive_open_ticket", arguments: args }), {
      "x-siraaj-user-email": "salim@rihal.om",
    });
    assert.equal(calls[0]?.ctx.identityVerified, false);
    assert.equal(calls[1]?.ctx.identityVerified, true);
  });

  test("the identity override applies to tickets only", async () => {
    reset();
    await post(rpc("tools/call", { name: "hive_find_hr_tag", arguments: { company: "Rihal" } }), {
      "x-siraaj-user-email": "salim@rihal.om",
    });
    assert.deepEqual(calls[0], {
      name: "hr_tag",
      args: { company: "Rihal" },
      ctx: {
        companyId: null,
        orgUnitId: null,
        sessionId: null,
        source: "SIRAAJ",
        identityVerified: true,
      },
    });
  });

  test("a tool's own error is reported as isError, never as a success", async () => {
    reset();
    toolResult = { error: "no_hr_pairs", detail: "x" };
    const body = (await (
      await post(rpc("tools/call", { name: "hive_open_ticket", arguments: {} }))
    ).json()) as { result: { isError: boolean } };
    assert.equal(body.result.isError, true);
  });

  test("an unknown tool name is an invalid-params error and runs nothing", async () => {
    reset();
    const body = (await (await post(rpc("tools/call", { name: "escalate" }))).json()) as {
      error: { code: number };
    };
    assert.equal(body.error.code, -32602, "the raw HIVE name is not callable — only hive_*");
    assert.equal(calls.length, 0);
  });

  test("inherited property names are not tools", async () => {
    reset();
    for (const name of ["constructor", "__proto__", "toString"]) {
      const body = (await (await post(rpc("tools/call", { name }))).json()) as {
        error: { code: number };
      };
      assert.equal(body.error.code, -32602, name);
    }
    assert.equal(calls.length, 0);
  });
});

describe("protocol edges", { skip: !canMock }, () => {
  test("a JSON-RPC response posted by the client is acknowledged with 202", async () => {
    reset();
    const res = await post({ jsonrpc: "2.0", id: 9, result: {} });
    assert.equal(res.status, 202);
  });

  test("GET's 405 names the allowed method", async () => {
    reset();
    const res = await route.GET(
      new NextRequest("http://x/api/mcp", { headers: { authorization: "Bearer s3cret-token" } }),
      { params: Promise.resolve({}) },
    );
    assert.equal(res.headers.get("allow"), "POST");
  });
});
