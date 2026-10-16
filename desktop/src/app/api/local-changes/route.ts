import { handle, httpError, requireParam, requireLocalMutation } from "@/lib/server/http";
import { localChanges, publishChanges } from "@/lib/server/local-changes";
import { getTarget } from "@/lib/server/targets";
export async function GET(req: Request) {
  return handle(async () => Response.json(await localChanges(requireParam(new URL(req.url), "id"))));
}
export async function POST(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const { id, tree, head, message } = await req.json();
    if (typeof id !== "string" || typeof message !== "string" || message.length > 10000 || !/^[a-f0-9]{40}$/.test(tree) || !/^[a-f0-9]{40}$/.test(head)) throw httpError(400, "Invalid publish request.");
    const result = await publishChanges(id, tree, head, message);
    await getTarget(id, true);
    return Response.json(result);
  });
}
