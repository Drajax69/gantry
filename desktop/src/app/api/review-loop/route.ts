import { handle, requireLocalMutation } from '@/lib/server/http';
import { listSpaces } from '@/lib/server/spaces';
import { reviewTicket } from '@/lib/server/workflow-review';
import { controlExecution, executionFor } from '@/lib/server/workflow-executor';

export async function GET(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const params = new URL(req.url).searchParams;
    const association = reviewTicket(listSpaces().spaces, params.get('targetId') || '', params.get('spaceId') || undefined);
    return Response.json({ ticketId: association.ticketId, run: executionFor(association.ticketId) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const body = await req.json();
    if (
      typeof body.targetId !== 'string' ||
      typeof body.nodeId !== 'string' ||
      (body.spaceId !== undefined && typeof body.spaceId !== 'string') ||
      !Number.isSafeInteger(body.expectedUpdatedAt) ||
      body.confirm !== true ||
      (body.message !== undefined && (typeof body.message !== 'string' || body.message.length > 4000))
    )
      throw new Error('Invalid review restart. Choose a stage and confirm it.');
    const association = reviewTicket(listSpaces().spaces, body.targetId, body.spaceId);
    const run = await controlExecution(association.ticketId, 'review-restart', body.nodeId, body.message, undefined, undefined, {
      targetId: body.targetId,
      spaceId: body.spaceId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      confirm: body.confirm,
    });
    return Response.json(run);
  });
}
