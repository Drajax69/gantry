"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FileCodeIcon, Loader2Icon, MessageSquareIcon, Trash2Icon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { linesLabel, type Thread } from "@/lib/client/threads";
import { timeAgo } from "@/lib/client/api";
import type { Quote, ReviewComment } from "@/lib/types";
import { Answer, Markdown } from "./message";
import { Avatar, ComposerBox, GitHubMark, QuoteBlock } from "./thread";

export interface ChatPanelHandle {
  focusComposer: () => void;
  showMessage: (id: string) => void;
}

interface Props {
  ticket?: boolean;
  threads: Thread[];
  onAsk: (text: string, quote?: Quote[]) => Promise<boolean>;
  /** Comments on the PR as a whole from GitHub. */
  general: ReviewComment[];
  onStop: () => void;
  onDelete: (id: string) => void;
  /** Jump to a thread that lives in the code. */
  onOpenThread: (t: Thread) => void;
  onOpenLocation: (file: string, line: number) => void;
}

/**
 * The side panel: questions about the whole change as a running chat, and every thread
 * on specific lines as a link to where it sits in the code.
 */
export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel(props, ref) {
  const { threads, onAsk, onStop, onDelete, onOpenThread, onOpenLocation, general: ghGeneral } = props;
  const [quote, setQuote] = useState<Quote[] | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [flash, setFlash] = useState<string | null>(null);
  const composer = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusComposer: () => composer.current?.querySelector("textarea")?.focus(),
    showMessage: (id) => {
      list.current?.querySelector(`[data-msg="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash(id);
      setTimeout(() => setFlash((f) => (f === id ? null : f)), 1500);
    },
  }));

  // Follow the stream while the user is at the bottom.
  const general = threads.filter((t) => !t.anchor);
  const live = general.find((t) => t.pending)?.pending;
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [threads.length, live?.text]);

  const anyPending = threads.some((t) => t.pending);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center border-b px-3 text-sm font-medium">{props.ticket ? "Ticket chat" : "The whole change"}</div>
      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {ghGeneral.length > 0 && (
          <details className="mb-4 rounded-lg border border-violet-400/40 bg-violet-500/[0.04] text-sm" open={threads.length === 0}>
            <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground select-none">
              <GitHubMark className="size-3.5" /> {ghGeneral.length} {ghGeneral.length === 1 ? "comment" : "comments"} on GitHub
            </summary>
            <div className="flex flex-col gap-3 border-t px-3 py-3">
              {ghGeneral.map((c) => (
                <div key={c.id} className="group/c flex gap-2.5">
                  <Avatar comment={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 text-xs">
                      <span className="font-semibold">{c.author}</span>
                      <span className="text-muted-foreground">{timeAgo(c.createdAt)}</span>
                      <button
                        className="ml-auto text-muted-foreground hover:text-foreground"
                        onClick={() => setAsking(asking === c.id ? null : c.id)}
                      >
                        Ask about this
                      </button>
                    </div>
                    <Markdown text={c.body} onOpenLocation={onOpenLocation} />
                    {/* The question box opens right under the comment, not at the bottom of the panel. */}
                    {asking === c.id && (
                      <div className="mt-2">
                        <ComposerBox
                          autoFocus
                          placeholder="What do you want to know about this comment?"
                          label="Ask"
                          onCancel={() => setAsking(null)}
                          onSubmit={async (text) => {
                            const ok = await onAsk(text, [{ author: c.author, body: c.body, url: c.url }]);
                            if (ok) setAsking(null);
                            return ok;
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
        {threads.length === 0 && (
          <div className="mt-8 flex flex-col gap-2 text-center text-sm text-muted-foreground">
            <p>{props.ticket ? "Describe the feature or ask the agent to continue this ticket." : "Hover a line in the diff and press the blue +, drag across line numbers, or select code, then ask about it right there."}</p>
            <p>{props.ticket ? "Worktrees are prepared when you send your first message. Your configured provider works here and in reviews." : "Questions about the whole change go below."}</p>
          </div>
        )}
        <div className="flex flex-col gap-4">
          {threads.map((t) =>
            t.anchor ? (
              <ThreadLink key={t.id} thread={t} onOpen={() => onOpenThread(t)} />
            ) : (
              <div key={t.id} className="flex flex-col gap-3">
                {t.messages.map((m) =>
                  m.role === "user" ? (
                    <div
                      key={m.id}
                      data-msg={m.id}
                      className={cn("group relative ml-6 rounded-lg bg-sky-500/15 px-3 py-2 pr-8 text-sm ring-1 ring-sky-500/30 transition-colors dark:bg-sky-500/20", flash === m.id && "bg-amber-400/25")}
                    >
                      <div className="mb-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">You</div>
                      {m.quote && <QuoteBlock quote={m.quote} />}
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      <button
                        onClick={() => onDelete(m.id)}
                        className="absolute top-2 right-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                        aria-label="Delete question and answer"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div key={m.id} data-msg={m.id} className={cn("rounded-lg transition-colors", flash === m.id && "bg-amber-400/15")}>
                      <Answer msg={m} live={false} onOpenLocation={onOpenLocation} />
                    </div>
                  ),
                )}
                {t.pending && <Answer msg={t.pending} live onOpenLocation={onOpenLocation} />}
                {!t.pending && t.waiting && <div className="text-xs text-muted-foreground">Waiting for the current answer to finish…</div>}
              </div>
            ),
          )}
        </div>
      </div>
      <div ref={composer} className="shrink-0 border-t p-2">
        {quote && (
          <div className="relative pr-6">
            <QuoteBlock quote={quote} />
            <button onClick={() => setQuote(null)} className="absolute top-0 right-0 text-muted-foreground hover:text-foreground" aria-label="Don't quote this comment">
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}
        <p className="px-1 pb-2 text-xs text-muted-foreground">Ask questions or request code changes. The agent can edit local files.</p>
        <ComposerBox
          placeholder={props.ticket ? "Ask or describe a change…" : "Ask about the whole change…"}
          onSubmit={async (text) => {
            const ok = await onAsk(text, quote ?? undefined);
            if (ok) setQuote(null);
            return ok;
          }}
          busy={anyPending}
          onStop={onStop}
          label="Send"
        />
      </div>
    </div>
  );
});

function ThreadLink({ thread, onOpen }: { thread: Thread; onOpen: () => void }) {
  const first = thread.messages.find((m) => m.role === "user");
  const answers = thread.messages.filter((m) => m.role === "assistant").length;
  const a = thread.anchor!;
  return (
    <button
      data-msg={first?.id}
      onClick={onOpen}
      className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
    >
      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <FileCodeIcon className="size-3 shrink-0" />
        <span className="truncate">
          {a.file}:{a.start}
          {a.end !== a.start ? `-${a.end}` : ""}
        </span>
        <span className="shrink-0 font-sans">· {linesLabel(a).toLowerCase()}</span>
      </span>
      <span className="line-clamp-2">{first?.text}</span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {thread.pending ? (
          <>
            <Loader2Icon className="size-3 animate-spin" /> Answering
          </>
        ) : thread.waiting ? (
          "Waiting"
        ) : (
          <>
            <MessageSquareIcon className="size-3" /> {answers} {answers === 1 ? "answer" : "answers"}
          </>
        )}
      </span>
    </button>
  );
}
