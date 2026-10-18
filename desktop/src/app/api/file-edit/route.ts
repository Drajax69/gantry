import { getTarget } from "@/lib/server/targets";
import { handle, httpError, requireLocalMutation, requireParam } from "@/lib/server/http";
import { readEditableFile, saveEditableFile } from "@/lib/server/file-edit";
import { withLock } from "@/lib/server/exec";
import { pendingFor, queuedFor } from "@/lib/server/chats";

export async function GET(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const url = new URL(req.url);
    const t = await getTarget(requireParam(url, "id"));
    return Response.json(await readEditableFile(t.worktree, requireParam(url, "path")));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const body = await req.json();
    if (!body || ["id", "path", "text", "revision"].some(key => typeof body[key] !== "string")) throw httpError(400, "Provide a file, text, and revision.");
    const t = await getTarget(body.id);
    return withLock(t.repoDir, async () => {
      if (pendingFor(body.id) || queuedFor(body.id).length) throw httpError(409, "Wait for the agent to finish before saving. Your draft is preserved.");
      return Response.json(await saveEditableFile(t.worktree, body.path, body.text, body.revision));
    });
  });
}
