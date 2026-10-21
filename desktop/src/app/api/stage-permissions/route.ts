import { handle, requireLocalMutation } from '@/lib/server/http';
import { allowedTools, updateAllowedTools } from '@/lib/server/stage-permissions';
import { COMMON_RULES } from '@/lib/server/stage-permission-rules';

const projectOf = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) throw Object.assign(new Error('Unknown workspace.'), { status: 400 });
  return value;
};
const list = (value: unknown) => (Array.isArray(value) && value.length <= 50 && value.every((r) => typeof r === 'string') ? (value as string[]) : []);

/** Tools a workspace's Claude stages may use without asking. */
export async function GET(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const projectId = projectOf(new URL(req.url).searchParams.get('projectId'));
    return Response.json({ allow: allowedTools(projectId), common: COMMON_RULES });
  });
}
export async function POST(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const body = await req.json();
    return Response.json({ allow: updateAllowedTools(projectOf(body.projectId), list(body.add), list(body.remove)), common: COMMON_RULES });
  });
}
