"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, Loader2Icon, MessageSquareIcon, SparklesIcon, SquareIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { linesLabel, type Thread } from "@/lib/client/threads";
import { timeAgo } from "@/lib/client/api";
import type { Anchor, Quote, ReviewComment, ReviewThread } from "@/lib/types";
import { Answer, Markdown } from "./message";

interface ThreadProps {
  thread: Thread;
  collapsed: boolean;
  onToggle: () => void;
  onReply: (text: string) => Promise<boolean>;
  onStop: () => void;
  onDelete: (msgId: string) => void;
  onOpenLocation: (file: string, line: number) => void;
}

/** A conversation about some lines, shown right under them like a review comment. */
export function InlineThread({ thread, collapsed, onToggle, onReply, onStop, onDelete, onOpenLocation }: ThreadProps) {
  const first = thread.messages.find((m) => m.role === "user");
  const questions = thread.messages.filter((m) => m.role === "user").length;

  return (
    <div data-thread={thread.id} className="rounded-lg border bg-card font-sans text-sm text-card-foreground shadow-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-foreground" aria-expanded={!collapsed} aria-label={`Thread on ${thread.anchor ? linesLabel(thread.anchor) : "this change"}`}>
          {collapsed ? <ChevronRightIcon className="size-3.5 shrink-0" /> : <ChevronDownIcon className="size-3.5 shrink-0" />}
          <MessageSquareIcon className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">{thread.anchor ? linesLabel(thread.anchor) : "Whole change"}</span>
          {collapsed && first && <span className="min-w-0 truncate">· {first.text}</span>}
          {collapsed && questions > 1 && <span className="shrink-0">· {questions} questions</span>}
        </button>
        {thread.pending && (
          <span className="flex items-center gap-1">
            <Loader2Icon className="size-3 animate-spin" /> Answering
          </span>
        )}
        {!thread.pending && thread.waiting && <span>Waiting</span>}
        {first && (
          <button onClick={() => onDelete(thread.id)} className="hover:text-destructive" aria-label="Delete thread">
            <Trash2Icon className="size-3.5" />
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          <div className="flex flex-col gap-3 border-t px-3 py-3">
            {thread.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} data-msg={m.id} className="group/q relative ml-8 rounded-lg bg-sky-500/15 px-3 py-2 pr-8 ring-1 ring-sky-500/30 dark:bg-sky-500/20">
                  <div className="mb-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">You</div>
                  {m.quote && <QuoteBlock quote={m.quote} />}
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  {m.id !== thread.id && (
                    <button
                      onClick={() => onDelete(m.id)}
                      className="absolute top-2 right-2 text-muted-foreground opacity-0 transition-opacity group-hover/q:opacity-100 hover:text-destructive focus-visible:opacity-100"
                      aria-label="Delete question and answer"
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <div key={m.id} data-msg={m.id}>
                  <Answer msg={m} live={false} onOpenLocation={onOpenLocation} />
                </div>
              ),
            )}
            {thread.pending && <Answer msg={thread.pending} live onOpenLocation={onOpenLocation} />}
            {!thread.pending && thread.waiting && (
              <div className="text-xs text-muted-foreground">Waiting for the answer in another thread to finish…</div>
            )}
          </div>
          <div className="border-t p-2">
            <ComposerBox placeholder="Reply…" onSubmit={onReply} busy={!!thread.pending} onStop={onStop} label="Reply" />
          </div>
        </>
      )}
    </div>
  );
}

/** Asking about freshly selected lines: the start of a new thread. */
export function InlineComposer({ anchor, quote, agent, onSubmit, onCancel }: {
  anchor: Anchor;
  quote?: Quote[] | null;
  agent: string;
  onSubmit: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-amber-500/50 bg-card font-sans text-sm shadow-md">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
        <MessageSquareIcon className="size-3.5" />
        <span className="flex-1">
          Ask {agent} about <span className="font-medium text-foreground">{linesLabel(anchor).toLowerCase()}</span>
          <span className="ml-2 hidden sm:inline">Shift-click or drag to change the lines</span>
        </span>
        <button onClick={onCancel} className="hover:text-foreground" aria-label="Cancel">
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="border-t p-2">
        {quote && <QuoteBlock quote={quote} />}
        <ComposerBox autoFocus placeholder={quote ? "What do you want to know about this comment?" : `Ask about ${anchor.start === anchor.end ? "this line" : "these lines"}…`} onSubmit={onSubmit} onCancel={onCancel} label="Ask" />
      </div>
    </div>
  );
}

export function ComposerBox({ placeholder, onSubmit, onCancel, busy, onStop, autoFocus, label }: {
  placeholder: string;
  onSubmit: (text: string) => Promise<boolean>;
  onCancel?: () => void;
  busy?: boolean;
  onStop?: () => void;
  autoFocus?: boolean;
  label: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  async function submit() {
    const q = text.trim();
    if (!q || sending) return;
    setSending(true);
    if (await onSubmit(q)) setText("");
    setSending(false);
  }

  return (
    <div className="flex items-end gap-2 rounded-md border bg-background p-1 focus-within:ring-3 focus-within:ring-ring/50">
      <textarea
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={1}
        placeholder={placeholder}
        className="max-h-48 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none field-sizing-content placeholder:text-muted-foreground"
      />
      {busy && onStop && !text.trim() ? (
        <Button size="icon-sm" variant="secondary" onClick={onStop} aria-label="Stop">
          <SquareIcon />
        </Button>
      ) : (
        <Button size="icon-sm" onClick={submit} disabled={!text.trim() || sending} aria-label={label}>
          {sending ? <Loader2Icon className="animate-spin" /> : <ArrowUpIcon />}
        </Button>
      )}
    </div>
  );
}

/** A GitHub review thread, shown where it was left, with a way to ask the agent about it. */
export function GitHubThread({ thread, collapsed, onToggle, onAsk, asking, agent, onOpenLocation, children }: {
  thread: ReviewThread;
  collapsed: boolean;
  onToggle: () => void;
  onAsk: () => void;
  /** The composer is open in this card (passed as children). */
  asking: boolean;
  agent: string;
  onOpenLocation: (file: string, line: number) => void;
  children?: ReactNode;
}) {
  const first = thread.comments[0];
  const label = thread.start === thread.end ? `Line ${thread.end}` : `Lines ${thread.start}–${thread.end}`;
  return (
    <div data-gh-thread={thread.id} className="rounded-lg border border-violet-400/40 bg-violet-500/[0.04] font-sans text-sm text-card-foreground shadow-sm dark:bg-violet-500/[0.07]">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-foreground" aria-expanded={!collapsed} aria-label={`GitHub comments on ${label}`}>
          {collapsed ? <ChevronRightIcon className="size-3.5 shrink-0" /> : <ChevronDownIcon className="size-3.5 shrink-0" />}
          <GitHubMark className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">
            {thread.comments.length === 1 ? `@${first.author}` : `@${first.author} and ${thread.comments.length - 1} more`}
          </span>
          {thread.outdated && <span className="shrink-0 rounded bg-muted px-1 text-[10px]">outdated</span>}
          {collapsed && <span className="min-w-0 truncate">· {first.body}</span>}
        </button>
        <a href={first.url} target="_blank" rel="noreferrer" className="hover:text-foreground" aria-label="Open on GitHub">
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>
      {!collapsed && (
        <>
          <div className="flex flex-col gap-3 border-t px-3 py-3">
            {thread.comments.map((c) => (
              <div key={c.id} className="flex gap-2.5">
                <Avatar comment={c} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="font-semibold">{c.author}</span>
                    <span className="text-muted-foreground">{timeAgo(c.createdAt)}</span>
                  </div>
                  <Markdown text={c.body} onOpenLocation={onOpenLocation} />
                </div>
              </div>
            ))}
          </div>
          {asking ? (
            <div className="border-t p-2">{children}</div>
          ) : (
            <div className="flex justify-end border-t px-3 py-1.5">
              <Button size="xs" variant="secondary" onClick={onAsk}>
                <SparklesIcon /> Ask {agent} about this
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Avatar({ comment }: { comment: ReviewComment }) {
  return comment.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${comment.avatar}${comment.avatar.includes("?") ? "&" : "?"}s=48`} alt="" className="size-6 shrink-0 rounded-full bg-muted" />
  ) : (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[10px] font-semibold uppercase">{comment.author.slice(0, 2)}</span>
  );
}

/** Reviewer comments a question quotes, shown small above it. */
export function QuoteBlock({ quote }: { quote: Quote[] }) {
  return (
    <div className="mb-1.5 flex flex-col gap-1 border-l-2 border-violet-400/60 pl-2 text-xs text-muted-foreground">
      {quote.map((q, i) => (
        <div key={i} className="line-clamp-3">
          <span className="font-medium text-foreground/80">@{q.author}</span> {q.body}
        </div>
      ))}
    </div>
  );
}

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
