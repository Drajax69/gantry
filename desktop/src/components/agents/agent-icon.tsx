import { PlugIcon, SparkleIcon, TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentKind } from "@/lib/types";

const STYLE: Record<AgentKind, { Icon: typeof PlugIcon; tint: string }> = {
  claude: { Icon: SparkleIcon, tint: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  codex: { Icon: TerminalIcon, tint: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300" },
  openai: { Icon: PlugIcon, tint: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
};

export function AgentIcon({ kind, className }: { kind: AgentKind; className?: string }) {
  const { Icon, tint } = STYLE[kind];
  return (
    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-md", tint, className)}>
      <Icon className="size-3" />
    </span>
  );
}
