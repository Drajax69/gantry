import { connection } from "next/server";
import { listPrs } from "@/lib/server/prs";
import { listRecent } from "@/lib/server/chats";
import { handle } from "@/lib/server/http";

export async function GET() {
  await connection();
  return handle(async () => {
    const recent = listRecent();
    try {
      return Response.json({ ...(await listPrs()), recent, prError: null });
    } catch (e) {
      return Response.json({ review: [], mine: [], recent, prError: (e as Error).message });
    }
  });
}
