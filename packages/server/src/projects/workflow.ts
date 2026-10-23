import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseDocument, stringify } from 'yaml';
import { DEFAULT_WORKFLOW, workflowSchema, workflowTemplateSchema, parseProjectConfig } from '@gantry/shared';
import type { LoadedProject } from './registry.js';

export function starterWorkflowYaml() {
  return stringify({ workflow: DEFAULT_WORKFLOW });
}

export function workspaceWorkflow(project: LoadedProject, templateId?: unknown) {
  if (templateId !== undefined && templateId !== 'default') {
    const template = project.config.workflowTemplates.find(template => template.id === templateId);
    if (!template) throw Object.assign(new Error('Workspace graph template not found.'), { statusCode: 400 });
    return structuredClone(template.graph);
  }
  // Existing configs without a graph get the starter layout, without silently
  // enabling execution. Newly initialized workspaces persist the automatic graph.
  return project.config.workflow ?? { ...structuredClone(DEFAULT_WORKFLOW), autoStart: false };
}

export function workspaceWorkflowTemplates(project: LoadedProject) {
  return [{ id: 'default', name: 'Default', graph: workspaceWorkflow(project) }, ...project.config.workflowTemplates];
}

export function saveWorkspaceWorkflowTemplate(project: LoadedProject, input: unknown, id?: string) {
  const template = workflowTemplateSchema.parse({ ...(input as object), id: id ?? randomUUID() });
  const document = parseDocument(fs.readFileSync(project.configPath, 'utf8'));
  if (document.errors.length) throw new Error('Fix the workspace YAML before saving its graph.');

  // Read the current file so another template saved since project loading is retained.
  const current = parseProjectConfig(document.toJS());
  if (!current.ok) throw new Error(current.errors.join('\n'));
  const templates = current.config.workflowTemplates;
  const index = templates.findIndex(existing => existing.id === template.id);
  if (id && index < 0) throw Object.assign(new Error('Workspace graph template not found.'), { statusCode: 404 });

  if (index >= 0) document.setIn(['workflowTemplates', index], template);
  else if (document.has('workflowTemplates')) document.addIn(['workflowTemplates'], template);
  else document.set('workflowTemplates', [template]);

  writeWorkflowDocument(project, document);
  return template;
}

export function saveWorkspaceWorkflow(project: LoadedProject, input: unknown) {
  const graph = workflowSchema.parse(input);
  const document = parseDocument(fs.readFileSync(project.configPath, 'utf8'));
  if (document.errors.length) throw new Error('Fix the workspace YAML before saving its graph.');
  document.set('workflow', graph);
  writeWorkflowDocument(project, document);
  return graph;
}

function writeWorkflowDocument(project: LoadedProject, document: ReturnType<typeof parseDocument>) {
  const parsed = parseProjectConfig(document.toJS());
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const temporary = `${project.configPath}.workflow.tmp`;
  fs.writeFileSync(temporary, document.toString(), { mode: fs.statSync(project.configPath).mode });
  fs.renameSync(temporary, project.configPath);
}
