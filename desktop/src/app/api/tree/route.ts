import { getTarget, listTree } from "@/lib/server/targets";
import { handle, requireParam } from "@/lib/server/http";

export async function GET(req: Request) {
  return handle(async () => {
    const t = await getTarget(requireParam(new URL(req.url), "id"));
    return Response.json(await listTree(t));
  });
}
