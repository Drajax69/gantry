import { CheckIcon, ClockIcon, MessageSquareIcon } from 'lucide-react';
import type { PullGroupView, TicketView } from '@/lib/client/gantry';
import { cn } from '@/lib/utils';

export function TicketReviewStatus({ ticket, groups }: { ticket: TicketView; groups: PullGroupView[] }) {
  const statuses = new Map<string, string>(ticket.pullRequests.map(pull => [pull.url, 'waiting']));
  for (const group of groups) {
    if (group.projectId !== ticket.projectId || group.branch !== ticket.branch) continue;
    for (const pull of Object.values(group.pulls)) statuses.set(pull.url, pull.reviewStatus ?? 'waiting');
  }
  if (!statuses.size) return null;
  const values = [...statuses.values()];
  const changes = values.includes('changes_requested');
  const comments = values.includes('commented');
  const approved = values.every(status => status === 'approved');
  const label = changes ? 'Changes requested' : comments ? 'Review comments' : approved ? 'Approved' : 'Waiting for review';
  const Icon = changes || comments ? MessageSquareIcon : approved ? CheckIcon : ClockIcon;
  return <span title={label} aria-label={`PR review: ${label}`} className={cn(
    'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
    changes || comments ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300' : approved ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300',
  )}><Icon aria-hidden="true" className="size-3" /><span className="sr-only">{label}</span></span>;
}
