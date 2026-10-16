import type { Tok } from "@/lib/types";

/** One line of highlighted code. Colors come as CSS vars so the theme can switch without re-rendering. */
export function CodeLine({ toks }: { toks: Tok[] }) {
  return (
    <>
      {toks.map(([text, light, dark], i) =>
        light || dark ? (
          <span key={i} className="tok" style={{ "--tl": light, "--td": dark } as React.CSSProperties}>
            {text}
          </span>
        ) : (
          <span key={i}>{text}</span>
        ),
      )}
      {toks.length === 0 || (toks.length === 1 && toks[0][0] === "") ? " " : null}
    </>
  );
}
