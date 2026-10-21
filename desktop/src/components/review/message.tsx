"use client";

import { createContext, useContext, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2Icon, WrenchIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { Diagram } from "./diagram";

const LOCATION = /^([\w@./-]+\.[\w]+):(\d+)(?:-(\d+))?$/;

// Renderers live at module level so their identity is stable: a new function per
// render makes React remount every diagram on each poll, which redraws it (jitter).
const MarkdownContext = createContext<{ live: boolean; onOpenLocation: (file: string, line: number) => void }>({
  live: false,
  onOpenLocation: () => {},
});

const md: Components = {
  pre({ children, ...rest }) {
    // ```mermaid blocks become diagrams.
    const child = Array.isArray(children) ? children[0] : children;
    const props = (child as { props?: { className?: string; children?: unknown } })?.props;
    if (props?.className?.includes("language-mermaid")) return <MarkdownDiagram code={String(props.children).trim()} />;
    return <pre {...rest}>{children}</pre>;
  },
  code({ className, children, ...rest }) {
    return <MarkdownCode className={className} rest={rest}>{children}</MarkdownCode>;
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  },
};

function MarkdownDiagram({ code }: { code: string }) {
  const { live } = useContext(MarkdownContext);
  return <Diagram code={code} live={live} />;
}

function MarkdownCode({ className, children, rest }: { className?: string; children: ReactNode; rest: object }) {
  const { onOpenLocation } = useContext(MarkdownContext);
  const raw = String(children);
  const m = !className && raw.match(LOCATION);
  if (m) {
    return (
      <button
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-sky-700 hover:underline dark:text-sky-300"
        onClick={() => onOpenLocation(m[1], Number(m[2]))}
      >
        {raw}
      </button>
    );
  }
  return <code className={className} {...rest}>{children}</code>;
}

/** Markdown where `path:line` code spans jump to the code. */
export function Markdown({ text, live = false, onOpenLocation }: { text: string; live?: boolean; onOpenLocation: (file: string, line: number) => void }) {
  return (
    <MarkdownContext.Provider value={{ live, onOpenLocation }}>
      <div className="chat-md">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{text}</ReactMarkdown>
      </div>
    </MarkdownContext.Provider>
  );
}

/** An answer: who wrote it, the tools it used, the text, and any error. */
export function Answer({ msg, live, onOpenLocation }: { msg: ChatMessage; live: boolean; onOpenLocation: (file: string, line: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {msg.agent && (
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          {msg.agent}
          {!live && typeof msg.costUsd === "number" && <span className="font-normal">${msg.costUsd.toFixed(3)}</span>}
        </div>
      )}
      {!!msg.tools?.length && (
        <details className="text-xs text-muted-foreground" open={live}>
          <summary className="cursor-pointer select-none">
            <WrenchIcon className="mr-1 inline size-3" />
            {msg.tools.length} tool {msg.tools.length === 1 ? "call" : "calls"}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">
            {msg.tools.map((t, i) => (
              <li key={i} className="truncate font-mono" title={t.detail}>
                {t.name} {t.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
      {msg.text ? (
        <Markdown text={msg.text} live={live} onOpenLocation={onOpenLocation} />
      ) : live ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" /> Thinking…
        </div>
      ) : null}
      {msg.error && <div className="text-xs text-destructive">{msg.error}</div>}
    </div>
  );
}
