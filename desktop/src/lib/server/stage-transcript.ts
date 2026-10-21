import 'server-only';
import fs from 'node:fs';
import { claudeTranscriptPath, readWorkflowRollout } from './ticket-conversations';
import { parseClaudeTranscript, parseCodexRollout, parseOpenCodeExport, type StageTranscript } from './stage-transcript-parse';
import { execFile } from './spawn';
import { CLI } from './agents/store';
import type { Attempt } from './workflow-state';

/** Read what happened in a stage's own chat after Gantry handed it to the person. Null for API stages or missing history. */
export async function readStageTranscript(attempt: Attempt, cwd: string): Promise<StageTranscript | null> {
  if (!attempt.sessionId) return null;
  if (attempt.providerKind === 'claude') {
    const file = claudeTranscriptPath(attempt.sessionId);
    return file ? parseClaudeTranscript(await fs.promises.readFile(file, 'utf8')) : null;
  }
  if (attempt.providerKind === 'codex') return parseCodexRollout(await readWorkflowRollout(cwd, attempt.sessionId));
  if (attempt.providerKind === 'opencode') {
    const sessionId = attempt.sessionId;
    const out = await new Promise<string>((resolve, reject) =>
      execFile(CLI.opencode, ['export', sessionId], { cwd, timeout: 15000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout)))),
    );
    return parseOpenCodeExport(out);
  }
  return null;
}
