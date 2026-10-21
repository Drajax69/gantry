/** A tool call Claude Code refused in a non-interactive stage (`permission_denials` in its result). */
export interface Denial {
  tool_name: string;
  tool_input?: Record<string, unknown>;
}

/** Tools where the subcommand matters (allow `git push`, not every `git`). */
const TWO_WORD = new Set(['git', 'gh', 'mix', 'npm', 'npx', 'pnpm', 'yarn', 'bundle', 'cargo', 'go', 'docker', 'kubectl', 'make', 'uv', 'poetry', 'brew']);

/** Rules people commonly want every stage to have. Offered as one click, never applied silently. */
export const COMMON_RULES = [
  'Edit',
  'Write',
  'WebFetch',
  'WebSearch',
  'Bash(git *)',
  'Bash(gh *)',
  'Bash(mix *)',
  'Bash(npm *)',
  'Bash(npx *)',
  'Bash(node *)',
  'Bash(python3 *)',
];

const RULE = /^[A-Za-z][\w-]*(\([^()\n]{1,200}\))?$/;
export const isValidRule = (rule: string) => RULE.test(rule) && rule.length <= 220;

/** The narrowest sensible allow rule for a refused call, in Claude Code's permission rule syntax. */
export function ruleFor(denial: Denial): string {
  const tool = denial.tool_name;
  const input = denial.tool_input ?? {};
  if (tool.startsWith('mcp__')) {
    const server = tool.split('__')[1];
    return server ? `mcp__${server}` : tool;
  }
  if (tool === 'WebFetch' && typeof input.url === 'string') {
    try {
      return `WebFetch(domain:${new URL(input.url).hostname})`;
    } catch {
      return 'WebFetch';
    }
  }
  if (tool === 'Bash' && typeof input.command === 'string') {
    // First command of a chain, without `cd x &&` or env assignments in front.
    const first =
      input.command
        .split(/&&|\|\||;|\|/)
        .map((part) => part.trim())
        .find((part) => part && !/^cd\s/.test(part)) ?? '';
    const words = first.split(/\s+/).filter((w) => !/^\w+=/.test(w));
    const command = (words[0] ?? '').split('/').at(-1) ?? '';
    if (!command || !/^[\w.+-]+$/.test(command)) return 'Bash';
    const sub = words[1];
    // Claude Code prefix syntax: a space before * matches the command with any arguments.
    return TWO_WORD.has(command) && sub && /^[a-z][\w-]*$/.test(sub) ? `Bash(${command} ${sub} *)` : `Bash(${command} *)`;
  }
  return tool;
}

// Current `Bash(git push *)` syntax and the older `Bash(git push:*)` form.
const BASH_PREFIX = /^Bash\((.+?)(?: \*|:\*)\)$/;
/** Whether an allow rule already covers a suggested rule (exact, or a broader prefix like `Bash(git *)` for `Bash(git push *)`). */
export function covers(allowed: string[], rule: string): boolean {
  if (allowed.includes(rule)) return true;
  if (rule.startsWith('WebFetch(')) return allowed.includes('WebFetch');
  const wanted = BASH_PREFIX.exec(rule)?.[1];
  if (!wanted) return false;
  return allowed.some((a) => {
    if (a === 'Bash') return true;
    const prefix = BASH_PREFIX.exec(a)?.[1];
    return !!prefix && (wanted === prefix || wanted.startsWith(`${prefix} `));
  });
}
