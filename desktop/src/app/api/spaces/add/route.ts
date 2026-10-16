import { resolveUrl } from "@/lib/server/targets";
import { addToSpace } from "@/lib/server/spaces";
import { handle } from "@/lib/server/http";

/** Resolve any GitHub link (or an existing target id) and open it as a tab in a space. */
export async function POST(req: Request) {
  return handle(async () => {
    const { url, space } = (await req.json()) as { url?: string; space?: string };
    const { id, file } = await resolveUrl(url ?? "");
    return Response.json({ space: addToSpace(id, space, file), id, file });
  });
}
