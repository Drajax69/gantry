import fs from 'node:fs';
import { parseDocument } from 'yaml';
import { parseProjectConfig, validateConfigReferences } from '@gantry/shared';
import type { LoadedProject } from './registry.js';
import { templateBody, validateTemplate } from '../prompts/engine.js';

export function workspacePrompt(project: LoadedProject) {
  return { prompt: templateBody(project.config, project.config.project.defaultPromptTemplate).body };
}

/** Edit only the prompt in the local workspace config, preserving YAML comments. */
export function saveWorkspacePrompt(project: LoadedProject, prompt: unknown) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100_000) throw new Error('Enter a prompt between 1 and 100,000 characters.');
  const document = parseDocument(fs.readFileSync(project.configPath, 'utf8'));
  if (document.errors.length) throw new Error('Fix the workspace YAML before saving its prompt.');
  const id = 'workspace-chat';
  const templates = (document.toJS().promptTemplates ?? []).filter((t: { id: string }) => t.id !== id);
  document.set('promptTemplates', [...templates, { id, label: 'Workspace chat', body: prompt }]);
  document.setIn(['project', 'defaultPromptTemplate'], id);
  const parsed = parseProjectConfig(document.toJS());
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const errors = [...validateConfigReferences(parsed.config), ...validateTemplate(parsed.config, id)];
  if (errors.length) throw new Error(errors.join('\n'));
  const temporary = `${project.configPath}.prompt.tmp`;
  fs.writeFileSync(temporary, document.toString(), { mode: fs.statSync(project.configPath).mode });
  fs.renameSync(temporary, project.configPath);
  return { prompt };
}
