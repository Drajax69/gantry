import { handle, httpError } from "@/lib/server/http";
import { ticketContext, ticketTarget } from "@/lib/server/ticket-chat";
import { loadChat, pendingFor, queuedFor, send, stopRun, deleteMessage } from "@/lib/server/chats";

export async function POST(req: Request) {
  return handle(async () => {
    const host = req.headers.get('host') || '';
    const caller = new URL(`http://${host}`);
    const origin = req.headers.get('origin');
    const site = req.headers.get('sec-fetch-site');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(caller.hostname) || caller.host !== host || (caller.port || '80') !== (process.env.PORT || new URL(req.url).port || '80') || (origin && origin !== caller.origin) || (site && !['same-origin', 'none'].includes(site))) throw httpError(403, 'Local same-origin access only.');
    const body = await req.json() as { ticketId: string; action: string; text?: string; messageId?: string };
    if (!/^[\w-]+$/.test(body.ticketId)) throw httpError(400, 'Invalid ticket.');
    const id = `ticket/${body.ticketId}`;
    if (body.action === 'send') {
      if (!body.text?.trim() || body.text.length > 50000) throw httpError(400, 'Enter a message of at most 50,000 characters.');
      const target = await ticketTarget(body.ticketId);
      return Response.json({ msg: send(target, { text: body.text, anchor: null }) });
    }
    if (body.action === 'stop') return Response.json({ stopped: stopRun(id) });
    if (body.action === 'delete') return Response.json({ deleted: deleteMessage(id, body.messageId || '') });
    if (!['load', 'prepare'].includes(body.action)) throw httpError(400, 'Unknown ticket chat action.');
    const context = await ticketContext(body.ticketId, body.action === 'prepare');
    return Response.json({ ...context, messages: loadChat(id)?.messages || [], pending: pendingFor(id), queued: queuedFor(id) });
  });
}
