import { createSpace, deleteSpace, listSpaces, updateSpace, type SpacePatch } from "@/lib/server/spaces";
import { handle, requireParam } from "@/lib/server/http";

export async function GET() {
  return handle(async () => Response.json(listSpaces()));
}

export async function POST(req: Request) {
  return handle(async () => {
    const { name } = (await req.json().catch(() => ({}))) as { name?: string };
    return Response.json(createSpace(name));
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const { id, ...patch } = (await req.json()) as SpacePatch & { id: string };
    return Response.json(updateSpace(id, patch));
  });
}

export async function DELETE(req: Request) {
  return handle(async () => Response.json(deleteSpace(requireParam(new URL(req.url), "id"))));
}
