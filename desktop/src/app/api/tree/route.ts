import { localTarget } from "@/lib/server/local-changes";
import { getTarget, listTree } from "@/lib/server/targets";
import { handle, requireParam } from "@/lib/server/http";

export async function GET(req: Request) {
  return handle(async () => {
    let t = await getTarget(requireParam(new URL(req.url), "id"));
    if (new URL(req.url).searchParams.get("source") === "local") t = (await localTarget(t)).target;
    return Response.json(await listTree(t));
  });
}
