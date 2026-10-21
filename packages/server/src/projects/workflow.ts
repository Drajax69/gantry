import fs from 'node:fs';
import { parseDocument, stringify } from 'yaml';
import { DEFAULT_WORKFLOW, workflowSchema, parseProjectConfig } from '@gantry/shared';
import type { LoadedProject } from './registry.js';

export function starterWorkflowYaml() {
  return stringify({ workflow: DEFAULT_WORKFLOW });
}

export function workspaceWorkflow(project: LoadedProject) {
  // Existing configs without a graph get the starter layout, without silently
  // enabling execution. Newly initialized workspaces persist the automatic graph.
  return project.config.workflow ?? { ...structuredClone(DEFAULT_WORKFLOW), autoStart: false };
}
export function saveWorkspaceWorkflow(project: LoadedProject, input: unknown) {
  const graph = workflowSchema.parse(input);
  const document = parseDocument(fs.readFileSync(project.configPath, 'utf8'));
  if (document.errors.length) throw new Error('Fix the workspace YAML before saving its graph.');
  document.set('workflow', graph);
  const parsed = parseProjectConfig(document.toJS());
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const temporary = `${project.configPath}.workflow.tmp`;
  fs.writeFileSync(temporary, document.toString(), { mode: fs.statSync(project.configPath).mode });
  fs.renameSync(temporary, project.configPath);
  return graph;
}
