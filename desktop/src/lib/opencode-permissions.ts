/** Provider-tagged grants keep OpenCode patterns out of Claude's --allowedTools. */
export function openCodeRule(permission: string, pattern: string): string {
  return `OpenCode(${permission}:${encodeURIComponent(pattern).replaceAll('(', '%28').replaceAll(')', '%29')})`;
}

export function parseOpenCodeRule(rule: string): { permission: string; pattern: string } | undefined {
  if (rule.length > 4096) return;
  const match = /^OpenCode\(([a-z][\w-]*):([^()]*)\)$/.exec(rule);
  if (!match) return;
  try {
    const pattern = decodeURIComponent(match[2]);
    if (!pattern || /[\x00-\x1f]/.test(pattern)) return;
    return { permission: match[1], pattern };
  } catch { return; }
}

export function permissionLabel(rule: string): string {
  const grant = parseOpenCodeRule(rule);
  return grant ? `${grant.permission}: ${grant.pattern}` : rule;
}

/** OpenCode's INFO logger serializes the patterns array inside a quoted string. */
export function openCodePermissionRequest(line: string): { permission: string; patterns: string[] } | undefined {
  if (!/\bmessage=asking\b/.test(line)) return;
  const permission = /\bpermission=([a-z][\w-]*)\b/.exec(line)?.[1];
  const encoded = /\bpatterns=("(?:\\.|[^"\\])*"|\[[^\n]*\])/.exec(line)?.[1];
  if (!permission || !encoded) return;
  try {
    const value = JSON.parse(encoded);
    const patterns: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(patterns) || !patterns.length || patterns.length > 50 ||
      !patterns.every(p => typeof p === 'string' && parseOpenCodeRule(openCodeRule(permission, p)))) return;
    return { permission, patterns };
  } catch { return; }
}
