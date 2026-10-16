"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { chooseAgent, useAgents } from "@/lib/client/agents";
import { AgentIcon } from "./agent-icon";

/** The chat header's "Claude ▾": which agent answers next, switchable in one click. */
export function AgentPicker({ align = "end" }: { align?: "start" | "end" }) {
  const data = useAgents();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const current = data?.agents.find((a) => a.id === data.current);
  if (!data || !current) return <span className="text-sm font-medium">Assistant</span>;

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Agent: ${current.name}`}
        className="-ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium hover:bg-muted"
      >
        <AgentIcon kind={current.kind} />
        {current.name}
        {!current.status.ok && <span className="size-1.5 rounded-full bg-destructive" aria-label="Not ready" />}
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div role="menu" className={cn("absolute top-full z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg", align === "start" ? "left-0" : "right-0")}>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Answer with</div>
          {data.agents.map((a) => (
            <button
              key={a.id}
              role="menuitemradio"
              aria-checked={a.id === data.current}
              onClick={() => {
                setOpen(false);
                if (a.id !== data.current) chooseAgent(a.id).catch((e: Error) => toast.error(e.message));
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <AgentIcon kind={a.kind} />
              <span className="min-w-0 flex-1">
                <span className="block break-words">{a.name}</span>
                <span className={cn("block truncate text-xs", a.status.ok ? "text-muted-foreground" : "text-destructive")}>
                  {a.model || a.status.detail}
                </span>
              </span>
              {a.id === data.current && <CheckIcon className="size-3.5" />}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <Link href="/settings" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted" onClick={() => setOpen(false)}>
            <PlusIcon className="size-3.5" /> Add or manage agents
          </Link>
        </div>
      )}
    </div>
  );
}
