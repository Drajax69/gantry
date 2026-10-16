import { getTarget } from "@/lib/server/targets";
import { loadFile } from "@/lib/server/files";
import { handle, requireParam } from "@/lib/server/http";

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const t = await getTarget(requireParam(url, "id"));
    const mode = url.searchParams.get("mode") === "full" ? "full" : "diff";
    return Response.json(await loadFile(t, requireParam(url, "path"), mode));
  });
}
