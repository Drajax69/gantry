import type { TargetResponse } from "@/lib/types";
import { getTarget } from "@/lib/server/targets";
import { loadChat, noteTarget, pendingFor, queuedFor } from "@/lib/server/chats";
import { handle, requireParam } from "@/lib/server/http";
import { withoutPatch } from "@/lib/server/files";

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const id = requireParam(url, "id");
    const t = await getTarget(id, url.searchParams.get("refresh") === "1");
    noteTarget(t.info);
    const files = Object.values(t.diff)
      .map(withoutPatch)
      .sort((a, b) => a.path.localeCompare(b.path));
    const body: TargetResponse = {
      target: t.info,
      files,
      messages: loadChat(id)?.messages ?? [],
      pending: pendingFor(id),
      queued: queuedFor(id),
    };
    return Response.json(body);
  });
}
