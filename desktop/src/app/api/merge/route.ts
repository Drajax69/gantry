import { handle, httpError, requireLocalMutation } from "@/lib/server/http";
import { mergePull } from "@/lib/server/merge";

export async function POST(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const { id, head, method } = await req.json();
    if (typeof id !== "string" || typeof head !== "string" || typeof method !== "string") throw httpError(400, "Invalid merge request.");
    return Response.json(await mergePull(id, head, method));
  });
}
