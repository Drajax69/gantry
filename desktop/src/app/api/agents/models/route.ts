import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from '@/lib/server/spawn';
import { handle, requireLocalMutation } from '@/lib/server/http';
import { getAgent, CLI } from '@/lib/server/agents/store';
import { openCodeModels, qualifyOpenCodeModel } from '@/lib/server/agents/opencode-models';
export async function GET(req: Request) {
  return handle(async () => {
    requireLocalMutation(req);
    const provider = getAgent(new URL(req.url).searchParams.get('providerId'));
    let models: { id: string; label: string; efforts?: string[] }[] = [];
    let warning: string | undefined;
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
        models = (await openCodeModels()).map((id) => ({ id, label: id }));
        if (provider.model && !provider.model.includes('/')) qualifyOpenCodeModel(provider.model, models.map((m) => m.id));
      } catch (error) {
        warning = (error as Error).message;
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
    if (provider.model && provider.kind !== 'opencode' && !models.some((m) => m.id === provider.model)) models.unshift({ id: provider.model, label: provider.model });
    return Response.json({ models, kind: provider.kind, warning });
  });
}
