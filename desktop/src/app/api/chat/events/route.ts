import { subscribe } from "@/lib/server/chats";
import { handle } from "@/lib/server/http";

/**
 * Server-sent events for chats: questions, streamed answers, deletions. Without `id` it carries
 * every target, so a page with many tabs needs one connection (browsers cap them per host).
 */
export async function GET(req: Request) {
  return handle(async () => {
    const id = new URL(req.url).searchParams.get("id") || "*";
    const enc = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (s: string) => {
          try {
            controller.enqueue(enc.encode(s));
          } catch {
            cleanup();
          }
        };
        const unsubscribe = subscribe(id, (e) => write(`data: ${JSON.stringify(e)}\n\n`));
        const ping = setInterval(() => write(": ping\n\n"), 25_000);
        cleanup = () => {
          clearInterval(ping);
          unsubscribe();
        };
        req.signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
        write(": connected\n\n");
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
