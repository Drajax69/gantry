"use client";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

export function TicketDialog({ title, color, onClose, children, actions }: { color?: CSSProperties; title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} style={color} aria-labelledby="ticket-dialog-title" onCancel={e => { e.preventDefault(); onClose(); }} className="fixed inset-0 m-auto h-[90dvh] max-h-[calc(100dvh-32px)] w-[min(1680px,calc(100vw-32px))] max-w-none overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50">
    <div className="flex h-full min-h-0 flex-col">
      <header className={`${color ? "gantry-ticket-heading " : ""}flex shrink-0 flex-wrap items-center gap-3 border-b px-6 py-4`}><h2 id="ticket-dialog-title" className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>{actions}<Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}><XIcon /></Button></header>
      {children}
    </div>
  </dialog>;
}
