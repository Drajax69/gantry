"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { COLOR_CLASSES, SPACE_COLORS, SPACE_EMOJI, spaceStyle } from "@/lib/space-style";
import type { Space } from "@/lib/types";

/** The space's emoji as a button that opens a little colour-and-emoji picker. */
export function SpaceStyler({ space, onChange, size = "md" }: {
  space: Space;
  onChange: (patch: { color?: string; emoji?: string }) => void;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { color, emoji, cls } = spaceStyle(space);

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

  return (
    <div ref={root} className="relative z-10" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Change ${space.name}'s colour and emoji`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex items-center justify-center rounded-xl transition-transform hover:scale-110 hover:-rotate-6 active:scale-95",
          cls.tint,
          size === "md" ? "size-10 text-2xl" : "size-6 rounded-md text-sm",
        )}
      >
        {emoji}
      </button>
      {open && (
        <div role="dialog" aria-label="Space look" className="absolute top-full left-0 z-50 mt-2 w-64 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Colour</div>
          <div className="flex flex-wrap gap-1.5">
            {SPACE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => onChange({ color: c })}
                aria-label={c}
                aria-pressed={c === color}
                className={cn("size-6 rounded-full transition-transform hover:scale-110", COLOR_CLASSES[c].dot, c === color && "ring-2 ring-foreground ring-offset-2 ring-offset-popover")}
              />
            ))}
          </div>
          <div className="mt-3 mb-2 text-xs font-medium text-muted-foreground">Emoji</div>
          <div className="grid grid-cols-8 gap-1">
            {SPACE_EMOJI.map((e) => (
              <button
                key={e}
                onClick={() => onChange({ emoji: e })}
                aria-label={e}
                aria-pressed={e === emoji}
                className={cn("rounded-md p-0.5 text-lg transition-transform hover:scale-125", e === emoji && "bg-muted")}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
