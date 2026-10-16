import "server-only";

/** An error whose status the route returns instead of 500. */
export const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/** JSON error response with the message the UI shows. */
export function fail(e: unknown, status = 500): Response {
  const message = e instanceof Error ? e.message : String(e);
  return Response.json({ error: message }, { status });
}

export function requireParam(url: URL, name: string): string {
  const v = url.searchParams.get(name);
  if (!v) throw Object.assign(new Error(`Missing "${name}"`), { status: 400 });
  return v;
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return fail(e, (e as { status?: number }).status ?? 500);
  }
}

export function requireLocalMutation(req: Request) {
  const host = req.headers.get("host") || "";
  const caller = new URL(`http://${host}`);
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(caller.hostname) || caller.host !== host || (caller.port || "80") !== (process.env.PORT || new URL(req.url).port || "80") || (origin && origin !== caller.origin) || (site && !["same-origin", "none"].includes(site))) throw httpError(403, "Local same-origin access only.");
}
