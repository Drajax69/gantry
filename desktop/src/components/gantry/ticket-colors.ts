"use client";
import { useEffect, useState, type CSSProperties } from "react";

// Match the playful space palette. Keep assignments after moves, renames and reloads.
const hues = [340, 55, 140, 240, 300, 90, 185, 20, 270, 115, 210, 0];
function nextHue(used: number[]) {
  const fresh = hues.find(h => !used.includes(h));
  if (fresh !== undefined) return fresh;
  const sorted = [...new Set(used)].sort((a,b) => a-b);
  let gap = -1, next = 0;
  sorted.forEach((h,i) => { const distance = (sorted[i+1] ?? sorted[0]+360)-h; if (distance > gap) { gap = distance; next = (h+distance/2)%360; } });
  return next;
}
export function useTicketColors(project: string, tickets: {id:string;status:string;position?:number}[]) {
  const [colors, setColors] = useState<Record<string, number>>({});
  const identity = JSON.stringify({project, ids: [...tickets].sort((a,b) => (a.status === 'backlog' ? 0 : a.status === 'done' ? 2 : 1) - (b.status === 'backlog' ? 0 : b.status === 'done' ? 2 : 1) || (a.position ?? 0)-(b.position ?? 0) || a.id.localeCompare(b.id)).map(t=>t.id)});
  useEffect(() => {
    const {project, ids} = JSON.parse(identity) as {project:string;ids:string[]};
    if (!project) return;
    const key = `gantry-ticket-colors:${project}`;
    let saved: Record<string,number> = {};
    try { const value = JSON.parse(localStorage.getItem(key) || '{}'); if (value && typeof value === 'object') saved = Object.fromEntries(Object.entries(value).filter(([,v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 360)) as Record<string,number>; } catch { /* An unavailable store must not hide the board. */ }
    for (const id of ids) if (saved[id] === undefined) saved[id] = nextHue(Object.values(saved));
    let live = true;
    queueMicrotask(() => { if (live) setColors(saved); });
    try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* Colors still work for this view. */ }
    return () => { live = false; };
  }, [identity]);
  return (id: string): CSSProperties => ({ '--ticket-hue': colors[id] ?? 240 } as CSSProperties);
}
