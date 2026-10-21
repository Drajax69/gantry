import { handle, requireLocalMutation } from '@/lib/server/http';
import { controlExecution, executionFor, startExecutor } from '@/lib/server/workflow-executor';
import { summarizeExecution } from '@/lib/server/workflow-summary';
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
      (body.message !== undefined && (typeof body.message !== 'string' || body.message.length > 12000)) ||
      (body.optionId !== undefined && (typeof body.optionId !== 'string' || !/^[\w-]{1,40}$/.test(body.optionId))) ||
      (body.rules !== undefined && (!Array.isArray(body.rules) || body.rules.length > 50 || body.rules.some((r: unknown) => typeof r !== 'string')))
    )
      throw new Error('Invalid stage, reply, choice or tool rules.');
    // The master chat reads the run through this; the full execution carries every stage's output.
    if (body.action === 'summary') {
      const run = executionFor(body.ticketId);
      return Response.json(run && summarizeExecution(run));
    }
    return Response.json(await controlExecution(body.ticketId, body.action, body.nodeId, body.message, body.optionId, body.rules));
  });
}
