import { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PrState } from "@/lib/types";

// GitHub's own colours: green open, purple merged, red closed, grey draft.
const STATES: Record<PrState, { label: string; Icon: typeof GitPullRequestIcon; text: string; pill: string }> = {
  open: { label: "Open", Icon: GitPullRequestIcon, text: "text-[#1a7f37] dark:text-[#3fb950]", pill: "bg-[#1f883d] dark:bg-[#238636]" },
  merged: { label: "Merged", Icon: GitMergeIcon, text: "text-[#8250df] dark:text-[#a371f7]", pill: "bg-[#8250df]" },
  closed: { label: "Closed", Icon: GitPullRequestClosedIcon, text: "text-[#cf222e] dark:text-[#f85149]", pill: "bg-[#cf222e] dark:bg-[#da3633]" },
  draft: { label: "Draft", Icon: GitPullRequestDraftIcon, text: "text-[#59636e] dark:text-[#9198a1]", pill: "bg-[#59636e] dark:bg-[#656c76]" },
};

/** The state as a coloured icon, for lists and tabs. */
export function PrStateIcon({ state, className }: { state: PrState; className?: string }) {
  const { label, Icon, text } = STATES[state];
  return <Icon role="img" aria-label={label} data-pr-state={state} className={cn("size-4 shrink-0", text, className)} />;
}

/** The state as GitHub's filled pill, for the review header. */
export function PrStateBadge({ state }: { state: PrState }) {
  const { label, Icon, pill } = STATES[state];
  return (
    <span data-pr-state={state} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white", pill)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
