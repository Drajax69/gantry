import { GitPullRequestIcon, GitPullRequestDraftIcon } from 'lucide-react';
import type { PullGroupView, TicketView } from '@/lib/client/gantry';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Use the full status snapshot, including PRs hidden from the Reviews area. */
export function TicketPullRequests({ ticket, groups }: { ticket: TicketView; groups: PullGroupView[] }) {
  const pulls = new Map(
    ticket.pullRequests.map((pull) => [
      pull.url,
      {
        ...pull,
        status: 'Status unavailable',
        blockers: [] as string[],
      },
    ]),
  );

  for (const group of groups) {
    if (group.projectId !== ticket.projectId || group.branch !== ticket.branch) continue;

    for (const [role, pull] of Object.entries(group.pulls)) {
      pulls.set(pull.url, {
        role,
        number: pull.number,
        url: pull.url,
        title: pull.title,
        status: pull.draft ? 'Draft' : pull.ready === true ? 'Ready' : pull.ready === false ? 'Blocked' : 'Status unavailable',
        blockers: pull.blockers ?? [],
      });
    }
  }

  if (!pulls.size) return null;

  return (
    <span className="flex max-w-full flex-wrap gap-1.5" aria-label="Pull requests">
      {[...pulls.values()].map((pull) => {
        const Icon = pull.status === 'Draft' ? GitPullRequestDraftIcon : GitPullRequestIcon;
        const label = `${pull.role} #${pull.number} · ${pull.status}`;

        return (
          <Badge
            key={pull.url}
            variant="outline"
            aria-label={label}
            title={[label, pull.title, ...pull.blockers].join(' · ')}
            className={cn(
              'h-auto max-w-full min-w-0 whitespace-normal text-left',
              pull.status === 'Ready' && 'text-emerald-700 dark:text-emerald-300',
              pull.status === 'Blocked' && 'text-amber-800 dark:text-amber-300',
              (pull.status === 'Draft' || pull.status === 'Status unavailable') && 'text-muted-foreground',
            )}
          >
            <Icon aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span>
          </Badge>
        );
      })}
    </span>
  );
}
