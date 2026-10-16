import { localTarget } from "@/lib/server/local-changes";
import { getTarget } from "@/lib/server/targets";
import { loadFile } from "@/lib/server/files";
import { handle, requireParam } from "@/lib/server/http";

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    let t = await getTarget(requireParam(url, "id"));
    if (new URL(req.url).searchParams.get("source") === "local") t = (await localTarget(t)).target;
    const mode = url.searchParams.get("mode") === "full" ? "full" : "diff";
    return Response.json(await loadFile(t, requireParam(url, "path"), mode));
  });
}
