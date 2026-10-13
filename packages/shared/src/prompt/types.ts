import type { Vars } from '../config/vars.js';

/**
 * Prompt templates use the same `${var}` interpolation as the rest of the
 * configuration, so there is exactly one substitution engine to validate.
 */

export const BUILTIN_TEMPLATES = ['builtin:default', 'builtin:paper-setter-legacy'] as const;
export type BuiltinTemplateId = (typeof BUILTIN_TEMPLATES)[number];

/** The layers composed, in render order. */
export type PromptLayer =
  | { kind: 'base' }
  | { kind: 'project-template'; id: string }
  | { kind: 'repo-instructions'; files: string[] }
  | { kind: 'agent-notes'; agentId: string }
  | { kind: 'safety-policy' }
  | { kind: 'ticket' }
  | { kind: 'ticket-additions' };

export interface PromptRenderResult {
  prompt: string;
  layers: PromptLayer[];
  warnings: string[];
}

/** Names a prompt template may reference; validated when templates are saved. */
export function promptVarNames(input: {
  repoIds: string[];
  serviceIds: string[];
  testRecordPrefix: string;
  manualTestFile: string;
}): string[] {
  return [
    'ticket.title',
    'ticket.description',
    'ticket.scope',
    'ticket.scopeDescription',
    'ticket.branch',
    'ticket.notes', // alias of description (legacy compatibility)
    'workspace',
    'artifactDir',
    'branch',
    'previewUrl',
    'safety.testRecordPrefix',
    'safety.manualTestFile',
    ...input.repoIds.flatMap((id) => [`repo.${id}`, `repoDir.${id}`]),
    ...input.serviceIds.map((id) => `url.${id}`),
    ...input.serviceIds.map((id) => `path.${id}`),
    'env:ANY', // documented: ${env:NAME} reads a named environment variable
    ...Object.keys({ testRecordPrefix: input.testRecordPrefix, manualTestFile: input.manualTestFile }),
  ];
}

export type { Vars };
