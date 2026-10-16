"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, PlusIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Space } from "@/lib/types";
import { spaceStyle } from "@/lib/space-style";

interface Props {
  target: string;
  spaces: Space[];
  current: string;
  onOpen: (space: string | null) => void;
}

/** "Open in <space>" plus a menu of the other spaces, or a new one (space = null).
 *  The main button goes to a space the PR is already in (the current one if it's there), else the current space. */
export function OpenInSpace({ target, spaces, current, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const holding = spaces.filter((s) => s.targets.includes(target));
  const here = holding.find((s) => s.id === current) ?? holding[0] ?? spaces.find((s) => s.id === current);

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

  const pick = (space: string | null) => {
    setOpen(false);
    onOpen(space);
  };

  return (
    <div ref={root} className="relative flex shrink-0 items-center">
      <div className="flex items-center rounded-md border bg-background text-xs shadow-xs">
        <button
          onClick={() => pick(here?.id ?? current)}
          className="flex items-center gap-1 rounded-l-md px-2 py-1 hover:bg-muted"
          title={`Open ${holding.includes(here!) ? "its tab" : "as a tab"} in ${here?.name ?? "the current space"}`}
        >
          {here ? <span aria-hidden>{spaceStyle(here).emoji}</span> : <SquareArrowOutUpRightIcon className="size-3" />}
          <span className="max-w-28 truncate">{here?.name ?? "Open"}</span>
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-r-md border-l px-1 py-1 hover:bg-muted"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Open in another space"
        >
          <ChevronDownIcon className="size-3.5" />
        </button>
      </div>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-50 mt-1 w-60 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Open in space</div>
          {spaces.map((s) => {
            const has = s.targets.includes(target);
            return (
              <button
                key={s.id}
                role="menuitem"
                onClick={() => pick(s.id)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted", s.id === here?.id && "font-medium")}
              >
                <span aria-hidden>{spaceStyle(s).emoji}</span>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {has && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckIcon className="size-3" /> open
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{s.targets.length}</span>
              </button>
            );
          })}
          <div className="my-1 h-px bg-border" />
          <button role="menuitem" onClick={() => pick(null)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
            <PlusIcon className="size-3.5" /> New space with this PR
          </button>
        </div>
      )}
    </div>
  );
}
