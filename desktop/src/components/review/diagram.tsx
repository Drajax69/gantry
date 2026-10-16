"use client";

import { useEffect, useId, useState } from "react";
import { useTheme } from "next-themes";
import { Loader2Icon } from "lucide-react";

/** Renders a ```mermaid block from an answer. Mermaid loads on first use; it's big. */
export function Diagram({ code, live }: { code: string; live: boolean }) {
  const { resolvedTheme } = useTheme();
  const id = `d${useId().replace(/[^\w]/g, "")}`;
  const [svg, setSvg] = useState<{ for: string; svg?: string; error?: string } | null>(null);
  const key = `${resolvedTheme}:${code}`;

  useEffect(() => {
    // Half-written diagrams don't parse; wait for the answer to finish.
    if (live) return;
    let cancelled = false;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolvedTheme === "dark" ? "dark" : "default",
          fontFamily: "var(--font-sans)",
        });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setSvg({ for: key, svg });
      })
      .catch((e: Error) => {
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setSvg({ for: key, error: e.message.split("\n")[0] });
      });
    return () => {
      cancelled = true;
    };
  }, [code, id, key, live, resolvedTheme]);

  const ready = svg?.for === key ? svg : null;
  if (ready?.svg) {
    return (
      <div
        data-diagram
        className="my-2 flex justify-center overflow-x-auto rounded-lg border bg-background p-3 [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: ready.svg }}
      />
    );
  }
  return (
    <div className="my-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
      {ready?.error ? (
        <>
          <div className="mb-1">Couldn&apos;t draw this diagram ({ready.error}):</div>
          <pre className="overflow-x-auto font-mono">{code}</pre>
        </>
      ) : (
        <span className="flex items-center gap-2">
          <Loader2Icon className="size-3.5 animate-spin" /> Drawing a diagram…
        </span>
      )}
    </div>
  );
}
