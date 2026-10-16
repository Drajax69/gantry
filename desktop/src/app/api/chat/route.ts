import type { Anchor, Quote } from "@/lib/types";
import { getTarget } from "@/lib/server/targets";
import { deleteMessage, send, stopRun } from "@/lib/server/chats";
import { handle, requireParam } from "@/lib/server/http";

interface Body {
  id: string;
  text?: string;
  anchor?: Anchor | null;
  replyTo?: string;
  thread?: string;
  quote?: Quote[];
  agent?: string;
  action?: "stop";
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as Body;
    if (!body.id) return Response.json({ error: 'Missing "id"' }, { status: 400 });
    if (body.action === "stop") return Response.json({ stopped: stopRun(body.id) });
    if (!body.text?.trim()) return Response.json({ error: "Ask something first." }, { status: 400 });
    const t = await getTarget(body.id);
    const msg = send(t, { text: body.text, anchor: body.anchor ?? null, replyTo: body.replyTo, thread: body.thread, quote: body.quote, agent: body.agent });
    return Response.json({ msg });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const ok = deleteMessage(requireParam(url, "id"), requireParam(url, "msg"));
    return Response.json({ deleted: ok }, { status: ok ? 200 : 404 });
  });
}
