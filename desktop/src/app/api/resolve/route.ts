import { resolveUrl } from "@/lib/server/targets";
import { handle } from "@/lib/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    const { url } = (await req.json()) as { url?: string };
    return Response.json(await resolveUrl(url ?? ""));
  });
}
