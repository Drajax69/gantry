"use client";

import { useMemo, useState } from "react";
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, MessageSquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { ChangedFile } from "@/lib/types";

const STATUS_STYLE: Record<ChangedFile["status"], string> = {
  A: "text-emerald-600 dark:text-emerald-400",
  M: "text-amber-600 dark:text-amber-400",
  D: "text-red-600 dark:text-red-400",
  R: "text-sky-600 dark:text-sky-400",
};

/** A folder in the tree. `name` can be several segments ("lib/bridge") when compacted. */
interface Dir {
  name: string;
  path: string;
  dirs: Dir[];
  files: string[];
  /** Files under this folder, at any depth. */
  count: number;
}

/** Build a folder tree, folding chains of single-child folders into one row like VS Code. */
function buildTree(paths: string[]): Dir {
  const root: Dir = { name: "", path: "", dirs: [], files: [], count: 0 };
  const index = new Map<string, Dir>([["", root]]);
  for (const p of paths) {
    const parts = p.split("/");
    let dir = root;
    dir.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join("/");
      let next = index.get(key);
      if (!next) {
        next = { name: parts[i], path: key, dirs: [], files: [], count: 0 };
        index.set(key, next);
        dir.dirs.push(next);
      }
      next.count++;
      dir = next;
    }
    dir.files.push(p);
  }
  const compact = (d: Dir): Dir => {
    while (d.dirs.length === 1 && d.files.length === 0 && d.path) {
      const only = d.dirs[0];
      d = { ...only, name: `${d.name}/${only.name}` };
    }
    const dirs = d.dirs.map(compact).sort((a, b) => a.name.localeCompare(b.name));
    const files = [...d.files].sort((a, b) => base(a).localeCompare(base(b)));
    return { ...d, dirs, files };
  };
  return compact(root);
}

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

type Row = { kind: "dir"; dir: Dir; depth: number; open: boolean } | { kind: "file"; path: string; depth: number };

/** The rows currently visible, depth first, folders before files. */
function flatten(root: Dir, isOpen: (d: Dir) => boolean, limit: number): Row[] {
  const rows: Row[] = [];
  const walk = (d: Dir, depth: number) => {
    for (const sub of d.dirs) {
      if (rows.length >= limit) return;
      const open = isOpen(sub);
      rows.push({ kind: "dir", dir: sub, depth, open });
      if (open) walk(sub, depth + 1);
    }
    for (const f of d.files) {
      if (rows.length >= limit) return;
      rows.push({ kind: "file", path: f, depth });
    }
  };
  walk(root, 0);
  return rows;
}

const ancestors = (p: string) => {
  const parts = p.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
};

const MAX_ROWS = 3000;

interface Props {
  changed: ChangedFile[];
  all: string[] | null;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  canDiff: boolean;
  current: string | null;
  threads: Record<string, number>;
  onOpen: (path: string) => void;
}

export function FileList({ changed, all, showAll, onShowAll, canDiff, current, threads, onOpen }: Props) {
  const [filter, setFilter] = useState("");
  const byPath = useMemo(() => new Map(changed.map((f) => [f.path, f])), [changed]);
  const totals = useMemo(
    () => changed.reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 }),
    [changed],
  );
  // Folders the user folded or unfolded, per view. Everything else uses the view's default.
  const [toggled, setToggled] = useState<{ changed: Map<string, boolean>; all: Map<string, boolean> }>(() => ({
    changed: new Map(),
    all: new Map(),
  }));
  // The repo view starts folded, except the way to the open file and to every changed file.
  const unfolded = useMemo(
    () => new Set([...(current ? ancestors(current) : []), ...changed.flatMap((c) => ancestors(c.path))]),
    [current, changed],
  );

  const f = filter.trim().toLowerCase();
  const paths = useMemo(() => {
    const src = showAll ? (all ?? []) : changed.map((c) => c.path);
    return f ? src.filter((p) => p.toLowerCase().includes(f)) : src;
  }, [showAll, all, changed, f]);
  const tree = useMemo(() => buildTree(paths), [paths]);

  // A compacted folder ("lib/bridge") is keyed by its deepest path.
  const view = showAll ? "all" : "changed";
  const isOpen = (d: Dir) => f !== "" || (toggled[view].get(d.path) ?? (showAll ? unfolded.has(d.path) : true));
  const rows = flatten(tree, isOpen, MAX_ROWS);

  const toggle = (d: Dir) => {
    if (f) return;
    setToggled((t) => ({ ...t, [view]: new Map(t[view]).set(d.path, !isOpen(d)) }));
  };

  // Folders that hold changed files get a dot in the repo view.
  const changedDirs = useMemo(() => new Set(changed.flatMap((c) => ancestors(c.path))), [changed]);
  const threadDirs = useMemo(() => new Set(Object.keys(threads).flatMap(ancestors)), [threads]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b p-2">
        {canDiff && (
          <div className="flex rounded-lg bg-muted p-0.5 text-xs font-medium">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                onClick={() => onShowAll(v)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-muted-foreground transition-colors",
                  showAll === v && "bg-background text-foreground shadow-sm",
                )}
              >
                {v ? "All files" : `Changed ${changed.length}`}
              </button>
            ))}
          </div>
        )}
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" className="h-7 text-xs" />
        {canDiff && !showAll && (
          <div className="px-1 text-xs text-muted-foreground">
            <span className="text-emerald-600 dark:text-emerald-400">+{totals.add}</span>{" "}
            <span className="text-red-600 dark:text-red-400">−{totals.del}</span>
          </div>
        )}
      </div>
      <div role="tree" aria-label={showAll ? "All files" : "Changed files"} className="min-h-0 flex-1 overflow-y-auto py-1">
        {showAll && !all && <div className="px-3 py-2 text-xs text-muted-foreground">Loading files…</div>}
        {rows.map((r) => {
          if (r.kind === "dir") {
            const d = r.dir;
            const Icon = r.open ? FolderOpenIcon : FolderIcon;
            return (
              <Indented
                key={`d:${d.path}`}
                depth={r.depth}
                onClick={() => toggle(d)}
                title={d.path}
                aria-expanded={r.open}
                role="treeitem"
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronRightIcon className={cn("size-3 shrink-0 transition-transform", r.open && "rotate-90")} />
                <Icon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                {!r.open && threadDirs.has(d.path) && <MessageSquareIcon className="size-3 shrink-0" />}
                {showAll && changedDirs.has(d.path) && <span role="img" className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Has changes" />}
                {!showAll && !r.open && <span className="shrink-0 font-mono text-[10px]">{d.count}</span>}
              </Indented>
            );
          }
          const p = r.path;
          const file = byPath.get(p);
          return (
            <Indented
              key={`f:${p}`}
              depth={r.depth}
              onClick={() => onOpen(p)}
              title={p}
              role="treeitem"
              aria-selected={current === p}
              className={cn(current === p && "bg-muted font-medium")}
            >
              {/* Lines up with the folder chevron above. */}
              <span className="w-3 shrink-0" />
              <span className={cn("w-3.5 shrink-0 text-center font-mono text-[10px] font-semibold", file && STATUS_STYLE[file.status])}>
                {file?.status ?? ""}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", file?.status === "D" && "line-through decoration-red-500/60")}>{base(p)}</span>
              {threads[p] ? <MessageSquareIcon className="size-3 shrink-0 text-muted-foreground" /> : null}
              {file && !showAll && !file.binary && (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  +{file.additions} −{file.deletions}
                </span>
              )}
            </Indented>
          );
        })}
        {rows.length >= MAX_ROWS && <div className="px-3 py-2 text-xs text-muted-foreground">Showing the first {MAX_ROWS} rows. Filter or fold folders to see more.</div>}
        {!rows.length && (showAll ? all : true) && <div className="px-3 py-2 text-xs text-muted-foreground">{f ? "No files match." : "No files."}</div>}
      </div>
    </div>
  );
}

function Indented({
  depth,
  className,
  children,
  ...rest
}: { depth: number; className?: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={cn("relative flex w-full items-center gap-1.5 py-[3px] pr-3 text-left text-xs transition-colors hover:bg-muted/70", className)}
    >
      {/* Indent guides, one per level. */}
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} aria-hidden className="absolute inset-y-0 w-px bg-border" style={{ left: 13 + i * 12 }} />
      ))}
      {children}
    </button>
  );
}
