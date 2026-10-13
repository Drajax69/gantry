// Gantry managed node runtime. Registers the checkout's own TypeScript
// loader when present, imports the configured entry module and starts the
// server it exports (initServer() or a listenable `app`).
const path = require('node:path');
const { createRequire } = require('node:module');

const source = process.env.GANTRY_CHECKOUT;
const entry = process.env.GANTRY_ENTRY || 'src/app.ts';
const port = Number(process.env.PORT);

(async () => {
  process.chdir(source);
  const localRequire = createRequire(path.join(source, 'package.json'));
  try {
    localRequire.resolve('ts-node');
    localRequire('ts-node').register({ project: path.join(source, 'tsconfig.json'), transpileOnly: true, files: true });
  } catch {
    /* plain JavaScript checkouts need no loader */
  }
  const target = localRequire(path.resolve(source, entry));
  let server;
  if (typeof target.initServer === 'function') server = target.initServer();
  else if (target.app && typeof target.app.listen === 'function') server = target.app;
  else if (typeof target.default?.listen === 'function') server = target.default;
  else throw new Error(`Entry ${entry} must export initServer() or a listenable app`);
  if (typeof server !== 'function' && typeof server.listen !== 'function') {
    throw new Error(`Entry ${entry} did not produce a listenable server`);
  }
  await new Promise((resolve, reject) => {
    server.once?.('error', reject);
    if (typeof server === 'function') server(port, '127.0.0.1', resolve);
    else server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`[gantry] node entry ready on http://localhost:${port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      setTimeout(() => process.exit(0), 2500).unref();
      server.close?.();
      process.exit(0);
    });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
