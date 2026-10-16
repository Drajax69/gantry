import { testAgent } from "@/lib/server/agents";
import { handle, httpError } from "@/lib/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    const { id } = (await req.json()) as { id?: string };
    if (!id) throw httpError(400, 'Missing "id"');
    return Response.json(await testAgent(id));
  });
}
