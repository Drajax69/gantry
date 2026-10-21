import 'server-only';
import { execFile } from '../spawn';
import { CLI } from './store';

export async function openCodeModels(cwd?: string): Promise<string[]> {
  try {
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile(CLI.opencode, ['models'], { cwd, timeout: 15000, maxBuffer: 2_000_000 }, (error, out) => error ? reject(error) : resolve(String(out))),
    );
    return [...new Set(stdout.split('\n').map((line) => line.trim()).filter((line) => /^[\w.-]+\/\S+$/.test(line)))];
  } catch {
    throw new Error('Could not load OpenCode models. Check that OpenCode is installed and run `opencode models` in the workspace, then select a model in the stage dropdown.');
  }
}

/** Old graphs may contain Codex-style bare names. Resolve only an unambiguous catalog match. */
export function qualifyOpenCodeModel(model: string, models: string[]): string {
  if (models.includes(model)) return model;
  const matches = models.filter((id) => id.slice(id.indexOf('/') + 1) === model);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`OpenCode model "${model}" matches multiple providers: ${matches.join(', ')}. Select the intended model in the stage dropdown.`);
  throw new Error(`OpenCode model "${model}" is not available in this workspace. Select a model in the stage dropdown; run \`opencode models\` to check available models.`);
}

export async function resolveOpenCodeModel(model: string, cwd?: string): Promise<string> {
  const value = model.trim();
  if (!value) return '';
  // Explicit provider/model IDs also support custom models absent from the catalog.
  if (/^[\w.-]+\/\S+$/.test(value)) return value;
  return qualifyOpenCodeModel(value, await openCodeModels(cwd));
}
