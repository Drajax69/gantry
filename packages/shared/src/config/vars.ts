/**
 * `${var}` interpolation shared by config values, prompt templates and the UI.
 *
 * Syntax:
 *   ${port}            service context: allocated port
 *   ${workspace}       workspace root
 *   ${project.id}      project fields
 *   ${repo.<id>}       repository absolute path
 *   ${repoDir.<id>}    repository directory name
 *   ${env:NAME}        environment variable (missing -> error listing the name)
 *   ${artifactDir}     ticket evidence directory
 *   ${branch}          ticket branch
 *
 * `$$` escapes to a literal `$`. Unknown variables raise a helpful error that
 * lists the closest available names.
 */

export type Vars = Record<string, string>;

export class VarError extends Error {
  readonly variable: string;
  constructor(variable: string, available: string[]) {
    super(
      `Unknown variable \${${variable}}. Available variables: ${available.sort().join(', ') || '(none)'}` +
        (variable.startsWith('env:')
          ? ` — set the "${variable.slice(4)}" environment variable or add it to a private env file.`
          : ''),
    );
    this.name = 'VarError';
    this.variable = variable;
  }
}

const VAR_PATTERN = /\$\$|\$\{([^}]+)\}/g;

export function availableVarNames(vars: Vars): string[] {
  return Object.keys(vars);
}

/** Escape a literal for safe inclusion in a rendered template. */
export function escapeVarValue(value: string): string {
  return value;
}

export function interpolate(input: string, vars: Vars): string {
  return input.replace(VAR_PATTERN, (match, name: string | undefined) => {
    if (name === undefined) return '$'; // `$$` -> literal dollar
    if (name.startsWith('env:')) {
      const key = name.slice(4);
      const value = process.env[key];
      if (value === undefined || value === '') {
        throw new VarError(name, availableVarNames(vars));
      }
      return value;
    }
    if (!(name in vars)) throw new VarError(name, availableVarNames(vars));
    return String(vars[name] ?? '');
  });
}

/** True when a template references at least one variable. */
export function referencesVars(input: string): boolean {
  VAR_PATTERN.lastIndex = 0;
  return VAR_PATTERN.test(input.replace(/\$\$/g, ''));
}
