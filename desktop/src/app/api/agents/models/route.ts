import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from '@/lib/server/spawn';
import { handle, requireLocalMutation } from '@/lib/server/http';
import { getAgent, CLI } from '@/lib/server/agents/store';
export async function GET(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const provider = getAgent(new URL(req.url).searchParams.get('providerId'));
    let models: { id: string; label: string; efforts?: string[] }[] = [];
    if (provider.kind === 'codex') {
      try {
        const cached = JSON.parse(
          await fs.promises.readFile(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json'), 'utf8'),
        );
        models = (cached.models ?? [])
          .filter((m: { slug?: string; visibility?: string }) => m.slug && m.visibility !== 'hide')
          .map((m: { slug: string; display_name?: string; supported_reasoning_levels?: { effort: string }[] }) => ({
            id: m.slug,
            label: m.display_name || m.slug,
            efforts: m.supported_reasoning_levels?.map((e) => e.effort),
          }));
      } catch {
        /* A new installation can use the provider default or enter an exact model ID. */
      }
    } else if (provider.kind === 'opencode') {
      try {
        // One provider/model per line, from the providers you set up in OpenCode.
        const stdout = await new Promise<string>((resolve, reject) =>
          execFile(CLI.opencode, ['models'], { timeout: 15000, maxBuffer: 2_000_000 }, (error, out) => (error ? reject(error) : resolve(String(out)))),
        );
        models = stdout.split('\n').map((l) => l.trim()).filter((l) => /^[\w.-]+\/\S+$/.test(l)).map((id) => ({ id, label: id }));
      } catch {
        /* Keep the saved selection available even while the CLI is unavailable. */
      }
    } else if (provider.kind === 'claude') {
      try {
        const stdout = await new Promise<string>((resolve, reject) =>
          execFile(CLI.claude, ['--help'], { timeout: 5000, maxBuffer: 200000 }, (error, out) => (error ? reject(error) : resolve(String(out)))),
        );
        const section = stdout.match(/--model <model>([\s\S]*?)(?=\n\s+--|$)/)?.[1] ?? '';
        const aliases = [...section.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]).filter((m) => !m.startsWith('claude-'));
        models = [...new Set(aliases)].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }));
      } catch {
        /* Keep the saved selection available even while the CLI is unavailable. */
      }
    }
    if (provider.model && !models.some((m) => m.id === provider.model)) models.unshift({ id: provider.model, label: provider.model });
    return Response.json({ models, kind: provider.kind });
  });
}
