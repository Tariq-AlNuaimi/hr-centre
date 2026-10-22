/**
 * Typed fetch wrapper over the REST routes and the `ApiResponse<T>` envelope
 * (`lib/api-response.ts`: `{ data?: T; error?: string; message?: string }`).
 *
 * Goal (optimization O6): recover end-to-end-ish typing across the client →
 * REST → service seam without adopting tRPC (ADR-012). Server components don't
 * need this -- they hit Prisma directly.
 *
 * Dependency-free: native fetch only.
 *
 * Usage:
 *   const user = await apiClient.get<User>(`/api/users/${id}`);
 *   const created = await apiClient.post<User>("/api/users", { name });
 *   try { ... } catch (e) { if (e instanceof ApiError) showError(e.message); }
 */

/**
 * Thrown when the server responds with a non-2xx status. Carries the HTTP
 * `status` and the server's `error` message from the `ApiResponse` envelope so
 * callers can surface the real reason (matching how the reset-password page
 * reads `body.error`).
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiClientOptions {
  /** Abort an in-flight request (use-crud aborts superseded reads). */
  signal?: AbortSignal;
  /** Extra headers merged over the default JSON content-type. */
  headers?: HeadersInit;
}

interface RequestInternalOptions extends ApiClientOptions {
  method: string;
  body?: unknown;
}

async function request<T>(
  path: string,
  { method, body, signal, headers }: RequestInternalOptions,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    signal,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(path, init);

  // Parse the envelope defensively: a 204 / empty / non-JSON body should not
  // crash the client. `null` stands in for "no parseable payload".
  const envelope = (await res.json().catch(() => null)) as {
    data?: T;
    error?: string;
  } | null;

  if (!res.ok) {
    throw new ApiError(envelope?.error ?? "Request failed", res.status);
  }

  return envelope?.data as T;
}

export const apiClient = {
  request,

  get<T>(path: string, opts?: ApiClientOptions): Promise<T> {
    return request<T>(path, { method: "GET", ...opts });
  },

  post<T>(path: string, body?: unknown, opts?: ApiClientOptions): Promise<T> {
    return request<T>(path, { method: "POST", body, ...opts });
  },

  put<T>(path: string, body?: unknown, opts?: ApiClientOptions): Promise<T> {
    return request<T>(path, { method: "PUT", body, ...opts });
  },

  patch<T>(path: string, body?: unknown, opts?: ApiClientOptions): Promise<T> {
    return request<T>(path, { method: "PATCH", body, ...opts });
  },

  /**
   * A DELETE may carry a body, and §9.4's discard needs to: destroying a
   * submitted 360 assessment demands a REASON, and a 500-character reason does
   * not belong in a URL. Legal HTTP, accepted by Next route handlers, and
   * optional — every existing caller passes nothing and is unaffected.
   */
  delete<T>(path: string, body?: unknown, opts?: ApiClientOptions): Promise<T> {
    return request<T>(path, { method: "DELETE", body, ...opts });
  },
};
