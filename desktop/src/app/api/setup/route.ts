import { handle } from "@/lib/server/http";
import { setupStatus } from "@/lib/server/setup";

/** Whether this computer has what Gantry needs: herdr and a coding CLI. */
export async function GET() {
  return handle(async () => Response.json(await setupStatus()));
}
