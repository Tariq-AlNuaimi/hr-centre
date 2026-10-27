/**
 * POST/GET a JML route that answers with a file and save it. Returns null on
 * success or the server's refusal sentence (never a silent failure).
 */
export async function downloadFile(
  path: string,
  fallbackName: string,
  body?: unknown,
): Promise<string | null> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    return payload?.error ?? `The file could not be produced (${res.status}).`;
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}
