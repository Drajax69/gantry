import { handle, requireLocalMutation } from "@/lib/server/http";
import { launcherSettings, saveLauncherSettings, type LauncherSettings } from "@/lib/server/terminal-launcher";

/** How chats open in herdr: herdr's path and the app that shows its window. */
export async function GET(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    return Response.json(launcherSettings());
  });
}

// The herdr path is run as a command, so only the local app may change it.
export async function POST(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const body = (await req.json()) as Partial<LauncherSettings>;
    return Response.json(saveLauncherSettings({ terminalApp: body.terminalApp, herdrPath: body.herdrPath }));
  });
}
