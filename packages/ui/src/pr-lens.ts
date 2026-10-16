/** Desktop handoff contains only a validated GitHub PR identity. */
export function prLensLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/);
    return match ? `pr-lens://review/${match[1]}/${match[2]}/pull/${match[3]}` : null;
  } catch {
    return null;
  }
}
