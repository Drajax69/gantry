"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ExternalLinkIcon, Loader2Icon, MessageSquarePlusIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Thread } from "@/lib/client/threads";
import type { Anchor, FileResponse, Quote, ReviewThread, TargetInfo, Tok } from "@/lib/types";
import { FileEditor } from "./file-editor";
import { Markdown } from "./message";
import { CodeLine } from "./code";
import { ComposerBox, GitHubThread, InlineComposer, InlineThread, QuoteBlock } from "./thread";

const MAX_SNIPPET_LINES = 80;
const STATUS_LABEL = { A: "added", M: "modified", D: "deleted", R: "renamed" } as const;

export interface Focus {
  file: string;
  line: number;
  side: "new" | "old";
  /** Changes on every request so the same line can be re-focused. */
  nonce: number;
}

/** A selectable line, in either view. */
interface Line {
  key: string;
  side: "new" | "old";
  /** Line number on `side`. */
  num: number;
  text: string;
}

/** One rendered row: a diff hunk header, or a line of code. */
type Row =
  | { kind: "hunk"; i: number; text: string }
  | { kind: "code"; i: number; line: Line; o?: number; n?: number; k: "add" | "del" | "ctx"; toks: Tok[] };

interface Props {
  target: TargetInfo;
  local?: boolean;
  onSaved: () => void;
  path: string | null;
  data: FileResponse | null;
  loading: boolean;
  error: string | null;
  mode: "diff" | "full";
  onMode: (m: "diff" | "full") => void;
  /** Lines picked for a new question; the composer opens under them. */
  draft: Anchor | null;
  /** GitHub comments the draft question is about. */
  draftQuote: Quote[] | null;
  onDraft: (a: Anchor | null, quote?: Quote[]) => void;
  /** Threads anchored in this file. */
  threads: Thread[];
  /** GitHub review threads in this file. */
  ghThreads: ReviewThread[];
  collapsed: Set<string>;
  onToggleThread: (id: string) => void;
  agentName: string;
  onAsk: (text: string, anchor: Anchor, quote?: Quote[]) => Promise<boolean>;
  onReply: (thread: string, text: string) => Promise<boolean>;
  onStop: () => void;
  onDelete: (msgId: string) => void;
  onOpenLocation: (file: string, line: number) => void;
  focus: Focus | null;
}

const lineKey = (side: "new" | "old", n: number) => `${side}-${n}`;

export function FileView(props: Props) {
  const { target, path, data, loading, error, mode, onMode, draft, draftQuote, onDraft, threads, ghThreads, collapsed, onToggleThread, agentName, onAsk, onReply, onStop, onDelete, onOpenLocation, focus } = props;
  const [editing, setEditing] = useState<string | null>(null);
  // Markdown (a plan, notes) can be read rendered; it shows the full file, so it rides on full mode.
  const [rendered, setRendered] = useState(false);
  const markdown = !!path && /\.(md|markdown)$/i.test(path);
  const scroller = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);
  // Where a drag across line numbers started.
  const drag = useRef<Line | null>(null);
  // The composer waits for the drag to end, so it doesn't push lines out from under the cursor.
  const [dragging, setDragging] = useState(false);
  const [textAsk, setTextAsk] = useState<{ anchor: Anchor; x: number; y: number } | null>(null);
  // Asking about a GitHub comment opens the composer in that comment's card, wherever the card is
  // (outdated comments sit at the end of the file, away from any line).
  const [ghAsk, setGhAsk] = useState<{ id: string; anchor: Anchor; quote: Quote[] } | null>(null);
  // Picking lines for a new question closes it.
  const [lastDraft, setLastDraft] = useState(draft);
  if (draft !== lastDraft) {
    setLastDraft(draft);
    if (draft) setGhAsk(null);
  }

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    if (data.rows) {
      return data.rows.map((r, i): Row =>
        r.k === "hunk"
          ? { kind: "hunk", i, text: r.text }
          : { kind: "code", i, k: r.k, o: r.o, n: r.n, toks: r.toks, line: { key: `r${i}`, side: r.k === "del" ? "old" : "new", num: (r.k === "del" ? r.o : r.n)!, text: r.text } },
      );
    }
    return (data.lines ?? []).map((toks, i): Row => ({
      kind: "code", i, k: "ctx", n: i + 1, toks, line: { key: `l${i}`, side: "new", num: i + 1, text: toks.map((t) => t[0]).join("") },
    }));
  }, [data]);
  const lines = useMemo(() => rows.flatMap((r) => (r.kind === "code" ? [r.line] : [])), [rows]);

  // Inline cards stay as wide as the visible pane while the code scrolls sideways under them.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);

  useEffect(() => {
    if (!focus || !data || focus.file !== path) return;
    const el = scroller.current?.querySelector(`[data-line="${focus.side}-${focus.line}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [focus, data, path]);

  const anchorFor = useCallback(
    (side: "new" | "old", a: number, b: number): Anchor | null => {
      if (!path) return null;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      const picked = lines.filter((l) => l.side === side && l.num >= start && l.num <= end);
      const snippet = picked.slice(0, MAX_SNIPPET_LINES).map((l) => l.text).join("\n");
      return { file: path, start, end, side, snippet };
    },
    [lines, path],
  );

  // Press on a line number (or its +) to pick it, drag to pick a range, shift-click to extend.
  function pressLine(line: Line, e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    setTextAsk(null);
    const from = e.shiftKey && draft && draft.file === path && draft.side === line.side ? (line.num < draft.start ? draft.end : draft.start) : line.num;
    drag.current = { ...line, num: from };
    setDragging(true);
    onDraft(anchorFor(line.side, from, line.num));
  }

  function enterLine(line: Line) {
    const start = drag.current;
    if (!start || start.side !== line.side) return;
    onDraft(anchorFor(line.side, start.num, line.num));
  }

  useEffect(() => {
    const up = () => {
      drag.current = null;
      setDragging(false);
    };
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  // Selecting code text offers to ask about the lines it covers.
  function onTextSelected(e: React.MouseEvent) {
    if (drag.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim() || !scroller.current) return setTextAsk(null);
    const rowOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-row]");
    const a = rowOf(sel.anchorNode);
    const b = rowOf(sel.focusNode);
    if (!a || !b || !scroller.current.contains(a) || !scroller.current.contains(b)) return setTextAsk(null);
    const [i, j] = [Number(a.dataset.row), Number(b.dataset.row)].sort((x, y) => x - y);
    const covered = rows.filter((r): r is Extract<Row, { kind: "code" }> => r.kind === "code" && r.i >= i && r.i <= j).map((r) => r.line);
    // A selection across removed and added lines asks about the new side.
    const side = covered.some((l) => l.side === "new") ? "new" : "old";
    const nums = covered.filter((l) => l.side === side).map((l) => l.num);
    if (!nums.length) return setTextAsk(null);
    const anchor = anchorFor(side, Math.min(...nums), Math.max(...nums));
    const box = scroller.current.parentElement!.getBoundingClientRect();
    if (anchor) setTextAsk({ anchor, x: e.clientX - box.left, y: e.clientY - box.top });
  }

  useEffect(() => {
    if (!textAsk) return;
    const check = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setTextAsk(null);
    };
    document.addEventListener("selectionchange", check);
    return () => document.removeEventListener("selectionchange", check);
  }, [textAsk]);

  if (editing) return <FileEditor id={target.id} path={editing} agentName={agentName} onAsk={onAsk} onSaved={props.onSaved} onClose={() => setEditing(null)} />;

  if (!path) {
    return <Empty>Pick a file on the left.</Empty>;
  }

  const file = data?.file ?? null;
  const blobUrl = target.url && target.kind !== "doc" ? `https://github.com/${target.owner}/${target.repo}/blob/${target.headSha}/${path}` : null;
  const showRendered = rendered && markdown && mode === "full";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          {file?.oldPath && file.oldPath !== path && <span className="text-muted-foreground">{file.oldPath} → </span>}
          {path}
        </span>
        {data && !data.tooLarge && !file?.binary && file?.status !== "D" && <Button size="xs" variant="outline" onClick={() => setEditing(path)}>Edit file</Button>}
        {file && <Badge variant="secondary">{STATUS_LABEL[file.status]}</Badge>}
        {file && file.status !== "D" && (
          <div className="flex rounded-md bg-muted p-0.5 text-xs">
            {(["diff", "full"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setRendered(false); onMode(m); }}
                className={cn("rounded px-2 py-0.5 text-muted-foreground", mode === m && !showRendered && "bg-background text-foreground shadow-sm")}
              >
                {m === "diff" ? "Diff" : "Full file"}
              </button>
            ))}
            {markdown && (
              <button
                onClick={() => { setRendered(true); onMode("full"); }}
                className={cn("rounded px-2 py-0.5 text-muted-foreground", showRendered && "bg-background text-foreground shadow-sm")}
              >
                Rendered
              </button>
            )}
          </div>
        )}
        {!props.local && blobUrl && <Button variant="ghost" size="icon-xs" nativeButton={false} render={<a href={blobUrl} target="_blank" rel="noreferrer" />} aria-label="Open on GitHub">
          <ExternalLinkIcon />
        </Button>}
      </div>

      <div className="relative min-h-0 flex-1">
        {textAsk && (
          <div className="absolute z-20" style={{ left: Math.max(8, textAsk.x - 60), top: textAsk.y + 14 }}>
            <Button
              size="xs"
              className="shadow-md"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onDraft(textAsk.anchor);
                setTextAsk(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              <MessageSquarePlusIcon /> Ask about {textAsk.anchor.start === textAsk.anchor.end ? `line ${textAsk.anchor.start}` : `lines ${textAsk.anchor.start}–${textAsk.anchor.end}`}
            </Button>
          </div>
        )}
        <div ref={scroller} className="absolute inset-0 overflow-auto" onMouseUp={onTextSelected}>
          {loading && !data && (
            <Empty>
              <Loader2Icon className="mr-2 size-4 animate-spin" /> Loading {path}…
            </Empty>
          )}
          {error && <Empty className="text-destructive">{error}</Empty>}
          {data && !error && showRendered && data.lines && (
            <div className="mx-auto max-w-3xl px-6 py-5 text-sm leading-relaxed">
              <Markdown text={data.lines.map((line) => line.map((tok) => tok[0]).join("")).join("\n")} onOpenLocation={onOpenLocation} />
            </div>
          )}
          {data && !error && !(showRendered && data.lines) && (
            <Body
              data={data}
              rows={rows}
              draft={draft && draft.file === path ? draft : null}
              showComposer={!dragging}
              threads={threads}
              ghThreads={ghThreads}
              viewWidth={viewWidth}
              onPress={pressLine}
              onEnter={enterLine}
              renderThread={(t) => (
                <InlineThread
                  thread={t}
                  collapsed={collapsed.has(t.id)}
                  onToggle={() => onToggleThread(t.id)}
                  onReply={(text) => onReply(t.id, text)}
                  onStop={onStop}
                  onDelete={onDelete}
                  onOpenLocation={onOpenLocation}
                />
              )}
              renderComposer={(a) => (
                <InlineComposer anchor={a} quote={draftQuote} agent={agentName} onSubmit={(text) => onAsk(text, a, draftQuote ?? undefined)} onCancel={() => onDraft(null)} />
              )}
              renderGitHub={(t) => (
                <GitHubThread
                  thread={t}
                  collapsed={collapsed.has(t.id)}
                  onToggle={() => onToggleThread(t.id)}
                  agent={agentName}
                  onOpenLocation={onOpenLocation}
                  asking={ghAsk?.id === t.id}
                  onAsk={() => {
                    const a = anchorFor(t.side, t.start, t.end);
                    if (!a) return;
                    onDraft(null);
                    // The current lines aren't what an outdated comment was about, so don't quote them.
                    setGhAsk({ id: t.id, anchor: t.outdated ? { ...a, snippet: "" } : a, quote: t.comments.map((c) => ({ author: c.author, body: c.body, url: c.url })) });
                  }}
                >
                  {ghAsk?.id === t.id && (
                    <>
                      <QuoteBlock quote={ghAsk.quote} />
                      <ComposerBox
                        autoFocus
                        placeholder="What do you want to know about this comment?"
                        label="Ask"
                        onCancel={() => setGhAsk(null)}
                        onSubmit={async (text) => {
                          const ok = await onAsk(text, ghAsk.anchor, ghAsk.quote);
                          if (ok) setGhAsk(null);
                          return ok;
                        }}
                      />
                    </>
                  )}
                </GitHubThread>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Body({
  data,
  rows,
  draft,
  showComposer,
  threads,
  ghThreads,
  viewWidth,
  onPress,
  onEnter,
  renderThread,
  renderComposer,
  renderGitHub,
}: {
  data: FileResponse;
  rows: Row[];
  draft: Anchor | null;
  showComposer: boolean;
  threads: Thread[];
  ghThreads: ReviewThread[];
  viewWidth: number;
  onPress: (l: Line, e: React.MouseEvent) => void;
  onEnter: (l: Line) => void;
  renderThread: (t: Thread) => React.ReactNode;
  renderComposer: (a: Anchor) => React.ReactNode;
  renderGitHub: (t: ReviewThread) => React.ReactNode;
}) {
  if (data.tooLarge) return <Empty>This file is too large to show.</Empty>;
  if (data.file?.binary) return <Empty>Binary file.</Empty>;
  if (data.rows && data.rows.length === 0) return <Empty>No textual changes.</Empty>;
  if (!data.rows && !data.lines) return <Empty>This file doesn&apos;t exist at this commit.</Empty>;

  const diff = !!data.rows;
  const added = new Set(data.added);
  const shown = new Set(rows.flatMap((r) => (r.kind === "code" ? [lineKey(r.line.side, r.line.num)] : [])));

  // Threads sit under the last line they're about; ones whose lines aren't in this view go at the end.
  const after = new Map<string, Thread[]>();
  const leftover: Thread[] = [];
  const covered = new Set<string>();
  for (const t of threads) {
    const a = t.anchor!;
    const key = lineKey(a.side, a.end);
    if (!shown.has(key)) {
      if (diff || a.side === "new") leftover.push(t);
      continue;
    }
    after.set(key, [...(after.get(key) ?? []), t]);
    for (let n = a.start; n <= a.end; n++) covered.add(lineKey(a.side, n));
  }
  // GitHub threads go first under their line; outdated ones point at code that has since changed.
  const ghAfter = new Map<string, ReviewThread[]>();
  const ghLeftover: ReviewThread[] = [];
  for (const t of ghThreads) {
    const key = lineKey(t.side, t.end);
    if (t.outdated || !shown.has(key)) {
      if (diff || t.side === "new") ghLeftover.push(t);
      continue;
    }
    ghAfter.set(key, [...(ghAfter.get(key) ?? []), t]);
    for (let n = t.start; n <= t.end; n++) covered.add(lineKey(t.side, n));
  }
  const draftKey = draft ? lineKey(draft.side, draft.end) : null;
  const inDraft = (l: Line) => !!draft && draft.side === l.side && l.num >= draft.start && l.num <= draft.end;

  const card = (children: React.ReactNode, key: string) => (
    <div key={key} className="sticky left-0 box-border px-3 py-1.5" style={{ width: viewWidth || undefined }}>
      {children}
    </div>
  );

  const gutter = (r: Extract<Row, { kind: "code" }>, n: number | undefined, side: "new" | "old") => {
    const own = r.line.side === side && n !== undefined;
    return (
      <span className="w-11 shrink-0 select-none pr-2 text-right text-muted-foreground/70">
        {own ? (
          <button
            onMouseDown={(e) => onPress(r.line, e)}
            className="cursor-pointer hover:text-foreground"
            aria-label={`${n}`}
          >
            {n}
          </button>
        ) : (
          n
        )}
      </span>
    );
  };

  return (
    <div className="min-w-fit py-1 font-mono text-xs leading-5">
      {rows.map((r) => {
        if (r.kind === "hunk") {
          return (
            <div key={r.i} className="bg-sky-500/10 px-3 py-0.5 text-muted-foreground">
              {r.text}
            </div>
          );
        }
        const l = r.line;
        const key = lineKey(l.side, l.num);
        const selected = inDraft(l);
        const discussed = covered.has(key);
        return (
          <Fragment key={r.i}>
            <div
              data-row={r.i}
              data-line={key}
              onMouseEnter={() => onEnter(l)}
              className={cn(
                "group/line relative flex",
                r.k === "add" && "bg-emerald-500/10",
                r.k === "del" && "bg-red-500/10",
                diff ? "" : added.has(l.num) && "bg-emerald-500/10",
                discussed && "shadow-[inset_3px_0_0_var(--color-sky-500)]",
                selected && "bg-amber-300/35 shadow-[inset_3px_0_0_var(--color-amber-500)] dark:bg-amber-400/15",
              )}
            >
              {diff ? (
                <>
                  {gutter(r, r.o, "old")}
                  {gutter(r, r.n, "new")}
                </>
              ) : (
                gutter(r, r.n, "new")
              )}
              {/* GitHub-style "+": press to ask about this line, drag for a range. */}
              <button
                onMouseDown={(e) => onPress(l, e)}
                className="absolute top-0.5 z-10 flex size-4 items-center justify-center rounded bg-sky-600 text-white opacity-0 shadow-sm transition-opacity group-hover/line:opacity-100 focus-visible:opacity-100"
                style={{ left: diff ? 90 : 46 }}
                aria-label={`Ask about line ${l.num}${l.side === "old" ? " (old)" : ""}`}
                tabIndex={-1}
              >
                <PlusIcon className="size-3" />
              </button>
              <span className="w-5 shrink-0 select-none text-center text-muted-foreground">
                {r.k === "add" ? "+" : r.k === "del" ? "−" : ""}
              </span>
              <span className="pr-4 whitespace-pre">
                <CodeLine toks={r.toks} />
              </span>
            </div>
            {ghAfter.get(key)?.map((t) => card(renderGitHub(t), `g:${t.id}`))}
            {after.get(key)?.map((t) => card(renderThread(t), `t:${t.id}`))}
            {showComposer && draftKey === key && card(renderComposer(draft!), "draft")}
          </Fragment>
        );
      })}
      {ghLeftover.length > 0 && (
        <div className="mt-2 border-t pt-1">
          <div className="sticky left-0 px-3 py-1 font-sans text-xs text-muted-foreground">GitHub comments on code that has changed since</div>
          {ghLeftover.map((t) => card(renderGitHub(t), `g:${t.id}`))}
        </div>
      )}
      {leftover.length > 0 && (
        <div className="mt-2 border-t pt-1">
          <div className="sticky left-0 px-3 py-1 font-sans text-xs text-muted-foreground">
            {diff ? "Threads on lines outside this diff" : "Threads on lines that aren't in this version"}
          </div>
          {leftover.map((t) => card(renderThread(t), `t:${t.id}`))}
        </div>
      )}
    </div>
  );
}

function Empty({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex h-full items-center justify-center p-6 text-sm text-muted-foreground", className)}>{children}</div>;
}
