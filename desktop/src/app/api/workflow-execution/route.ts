import { handle, requireLocalMutation } from '@/lib/server/http';
import { controlExecution, executionFor, startExecutor } from '@/lib/server/workflow-executor';
export async function GET(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    startExecutor();
    const id = new URL(req.url).searchParams.get('ticketId') || '';
    return Response.json(executionFor(id));
  });
}
export async function POST(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const body = await req.json();
    if (typeof body.ticketId !== 'string' || typeof body.action !== 'string') throw new Error('Ticket and action are required.');
    if (
      (body.nodeId !== undefined && typeof body.nodeId !== 'string') ||
      (body.message !== undefined && (typeof body.message !== 'string' || body.message.length > 12000))
    )
      throw new Error('Invalid stage or reply.');
    return Response.json(await controlExecution(body.ticketId, body.action, body.nodeId, body.message));
  });
}
