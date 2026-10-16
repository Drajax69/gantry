import { getComments } from "@/lib/server/comments";
import { handle, requireParam } from "@/lib/server/http";

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    return Response.json(await getComments(requireParam(url, "id"), url.searchParams.get("refresh") === "1"));
  });
}
