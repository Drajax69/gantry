import "server-only";
import { bundledLanguages, codeToTokens, type BundledLanguage } from "shiki";
import type { Tok } from "@/lib/types";

const MAX_BYTES = 400_000;

const EXT_ALIASES: Record<string, string> = {
  ex: "elixir", exs: "elixir", heex: "html", eex: "html", leex: "html",
  rb: "ruby", rake: "ruby", gemspec: "ruby", py: "python", rs: "rust", kt: "kotlin",
  yml: "yaml", md: "markdown", mdx: "mdx", sh: "bash", zsh: "bash", tf: "hcl",
  mjs: "javascript", cjs: "javascript", mts: "typescript", cts: "typescript",
  h: "c", hpp: "cpp", cc: "cpp", cs: "csharp", proto: "proto", gql: "graphql",
  lock: "json", env: "dotenv", txt: "text",
};
const NAME_ALIASES: Record<string, string> = {
  Dockerfile: "docker", Makefile: "make", Gemfile: "ruby", Rakefile: "ruby", Procfile: "bash",
};

export function langFor(path: string): string {
  const base = path.split("/").pop() ?? "";
  if (NAME_ALIASES[base]) return NAME_ALIASES[base];
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  const lang = EXT_ALIASES[ext] ?? ext;
  return lang in bundledLanguages ? lang : "text";
}

const plain = (code: string): Tok[][] => code.split("\n").map((l) => [[l]]);

/** Highlight a whole file into per-line tokens with light and dark colors. */
export async function highlight(code: string, path: string): Promise<Tok[][]> {
  if (code.endsWith("\n")) code = code.slice(0, -1);
  const lang = langFor(path);
  if (lang === "text" || code.length > MAX_BYTES) return plain(code);
  try {
    const { tokens } = await codeToTokens(code, {
      lang: lang as BundledLanguage,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
    return tokens.map((line) =>
      line.map((t) => {
        const s = t.htmlStyle as Record<string, string> | undefined;
        return [t.content, s?.["--shiki-light"], s?.["--shiki-dark"]] as Tok;
      }),
    );
  } catch {
    return plain(code);
  }
}
