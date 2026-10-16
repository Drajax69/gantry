import type { AgentInput } from "@/lib/types";
import { addAgent, listAgents, removeAgent, setCurrentAgent, updateAgent } from "@/lib/server/agents";
import { handle, httpError, requireParam } from "@/lib/server/http";

export async function GET() {
  return handle(async () => Response.json(await listAgents()));
}

/** Add an agent; it becomes the current one. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as AgentInput;
    return Response.json(addAgent(body));
  });
}

/** Edit an agent, and/or make it current with `current: true`. */
export async function PATCH(req: Request) {
  return handle(async () => {
    const { id, current, ...patch } = (await req.json()) as Partial<AgentInput> & { id?: string; current?: boolean };
    if (!id) throw httpError(400, 'Missing "id"');
    const keys = Object.keys(patch).filter((k) => k !== "kind");
    if (keys.length) updateAgent(id, patch);
    if (current) setCurrentAgent(id);
    return Response.json(await listAgents());
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    removeAgent(requireParam(new URL(req.url), "id"));
    return Response.json(await listAgents());
  });
}
