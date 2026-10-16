import { syncGantrySpaces } from "@/lib/server/spaces";
import type { StatusView } from "@/lib/client/gantry";

/** Same-origin bridge to the local Gantry service; never accepts an upstream URL. */

type Context = { params: Promise<{ path: string[] }> };
const reads = [
  /^api\/(status|version)$/,
  /^logs\/(run\/[\w-]+|preview\/[\w-]+\/[\w-]+)$/,
  /^artifacts\/[\w-]+\/[\w.-]+$/,
];
const writes = [
  /^api\/projects$/,
  /^api\/projects\/[\w-]+\/(refresh|tickets)$/,
  /^api\/projects\/[\w-]+\/tickets\/reorder$/,
  /^api\/tickets\/[\w-]+\/(update|delete|prompt|start|handoff|resume)$/,
  /^api\/previews\/[\w-]+\/(pause|resume|restart|retry-dependencies|archive|restore|environment)$/,
];

async function proxy(req: Request, context: Context) {
  const host = req.headers.get("host") || "";
  let caller: URL;
  try { caller = new URL(`http://${host}`); } catch { return Response.json({ error: "Invalid local host." }, { status: 403 }); }
  // Next's standalone server may normalize req.url to localhost. Validate the
  // actual Host against its listening port, then compare browser Origin to it.
  const port = process.env.PORT || new URL(req.url).port || "80";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(caller.hostname) || caller.host !== host || (caller.port || "80") !== port || caller.username || caller.password) {
    return Response.json({ error: "Gantry is available only from this local app." }, { status: 403 });
  }
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if ((origin && origin !== caller.origin) || (site && !["same-origin", "none"].includes(site))) {
    return Response.json({ error: "Cross-origin Gantry access is not allowed." }, { status: 403 });
  }
  const segments = (await context.params).path;
  const route = segments.join("/");
  const allowed = req.method === "GET" ? reads : req.method === "POST" ? writes : [/^api\/projects\/[\w-]+$/];
  if (segments.some((part) => !/^[\w.-]+$/.test(part) || part === "." || part === "..") || !allowed.some((pattern) => pattern.test(route))) {
    return Response.json({ error: "Unsupported Gantry action." }, { status: 404 });
  }
  try {
    const upstream = new URL(process.env.PR_LENS_GANTRY_URL || "http://127.0.0.1:4500");
    if (upstream.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname) || upstream.username || upstream.password) throw new Error("Invalid local Gantry URL.");
    let body: string | undefined;
    if (req.method !== "GET") {
      if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON is required." }, { status: 415 });
      body = await req.text();
      if (body.length > 1_000_000) return Response.json({ error: "Request is too large." }, { status: 413 });
    }
    const response = await fetch(new URL(`/${route}`, upstream), {
      method: req.method,
      headers: { "Content-Type": "application/json", Origin: upstream.origin },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    let responseBody: BodyInit | null = response.body;
    if (route === "api/status" && response.ok) {
      const status = await response.json() as StatusView;
      const spaces = syncGantrySpaces(status);
      responseBody = JSON.stringify({ ...status, tickets: status.tickets.map(t => ({ ...t, reviewSpaceId: spaces[t.id] })) });
    }
    return new Response(responseBody, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Gantry is unavailable. Reopen the desktop app, or start Gantry and retry." }, { status: 503 });
  }
}

export { proxy as GET, proxy as POST, proxy as DELETE };
