import path from 'node:path';

/** Windows PATH is case-insensitive and uses semicolons, including drive paths. */
export function binaryCandidates(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const search = Object.entries(env).find(([key]) => windows ? key.toUpperCase() === 'PATH' : key === 'PATH')?.[1] ?? '';
  const extensions = windows && !paths.extname(name) ? ['.exe', '.cmd', '.bat', '.com', ''] : [''];
  return search.split(paths.delimiter).filter(Boolean).flatMap(dir => extensions.map(extension => paths.join(dir.replace(/^"|"$/g, ''), name + extension)));
}
