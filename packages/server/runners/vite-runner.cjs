// Gantry managed vite runtime. Boots the checkout's own vite dev server and
// optionally injects the local-preview banner (+ auto-login) without touching
// the checkout. State arrives via GANTRY_* environment variables.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

const source = process.env.GANTRY_CHECKOUT;
const port = Number(process.env.PORT);
const host = '127.0.0.1';
const stateDir = process.env.GANTRY_DATA_DIR;
const readyFile = process.env.GANTRY_READY_FILE;
const banner = process.env.GANTRY_BANNER === '1';

const markReady = () => {
  if (!readyFile) return;
  try {
    fs.writeFileSync(readyFile, JSON.stringify({ pid: process.pid, started: Date.now() }), { mode: 0o600 });
  } catch {
    /* readiness is advisory */
  }
};

const escapeHTML = (value) =>
  String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function bannerPlugin() {
  const title = process.env.GANTRY_BANNER_TITLE || '';
  const branch = process.env.GANTRY_BANNER_BRANCH || '';
  const warning = process.env.GANTRY_BANNER_WARNING || 'Shared data';
  const css = `
#gantry-preview-banner{all:initial;position:fixed;inset:0 0 auto 0;z-index:2147483647;height:32px;box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:0 14px;overflow:hidden;background:#172033;color:#f8fafc;box-shadow:0 3px 12px rgb(15 23 42 / 22%);font:500 12px/1.2 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#gantry-preview-banner *{box-sizing:border-box}
#gantry-preview-banner .gantry-marker{flex:none;padding:4px 7px;border-radius:3px;background:#fbbf24;color:#422006;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
#gantry-preview-banner .gantry-title{min-width:0;overflow:hidden;font-weight:700;text-overflow:ellipsis;white-space:nowrap}
#gantry-preview-banner .gantry-branch{flex:none;color:#cbd5e1;font:500 11px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
#gantry-preview-banner .gantry-warning{flex:none;color:#fcd34d}
#gantry-preview-banner .gantry-auth{display:flex;flex:none;align-items:center;gap:6px;margin-left:auto;color:#cbd5e1;font-size:11px}
#gantry-preview-banner .gantry-auth::before{width:6px;height:6px;border-radius:999px;background:#fbbf24;content:""}
#gantry-preview-banner .gantry-auth[data-state="ready"]::before{background:#4ade80}
#gantry-preview-banner .gantry-auth[data-state="error"]{color:#fecaca}
#gantry-preview-banner .gantry-auth[data-state="error"]::before{background:#f87171}
body{padding-top:32px!important}
@media print{#gantry-preview-banner{display:none!important}body{padding-top:0!important}}`;
  const auth = process.env.GANTRY_LOGIN_MODULE ? `<span class="gantry-auth" data-preview-auth-status data-state="loading">Checking sign-in…</span>` : '';
  const bar = `<aside id="gantry-preview-banner" role="status" aria-label="Local preview information"><span class="gantry-marker">Local preview</span><span class="gantry-title">${escapeHTML(title)}</span><span class="gantry-branch">${escapeHTML(branch)}</span><span class="gantry-warning">${escapeHTML(warning)}</span>${auth}</aside>`;
  return {
    name: 'gantry-preview-banner',
    transformIndexHtml() {
      return [
        { tag: 'style', attrs: { id: 'gantry-preview-styles' }, children: css, injectTo: 'head' },
        { tag: 'aside', attrs: {}, children: bar, injectTo: 'body-prepend' },
      ];
    },
  };
}

function autoLoginPlugin() {
  // Optional, project-provided login module (relative to the checkout). It
  // receives the credentials and establishes the app's own session; Gantry
  // never assumes an auth stack.
  const modulePath = process.env.GANTRY_LOGIN_MODULE || '';
  const credentialsFile = process.env.GANTRY_LOGIN_CREDENTIALS_FILE || '';
  if (!modulePath || !credentialsFile) return null;
  let identity = '';
  try { identity = String(JSON.parse(fs.readFileSync(credentialsFile, 'utf8')).email ?? ''); } catch {}
  const script = `
(async () => {
  const status = document.querySelector('[data-preview-auth-status]');
  const setStatus = (state, message) => { if (status) { status.dataset.state = state; status.textContent = message; } };
  try {
    const credentials = JSON.parse(${JSON.stringify(fs.readFileSync(credentialsFile, 'utf8'))});
    const login = (await import(${JSON.stringify(modulePath)})).default;
    await login(credentials);
    setStatus('ready', ${JSON.stringify(identity)});
  } catch (error) {
    setStatus('error', 'Auto-login failed');
  }
})();`;
  return {
    name: 'gantry-preview-auto-login',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module' }, children: script, injectTo: 'body-prepend' }];
    },
  };
}

(async () => {
  process.chdir(source);
  const localRequire = createRequire(path.join(source, 'package.json'));
  const vitePackage = localRequire.resolve('vite/package.json');
  const manifest = JSON.parse(fs.readFileSync(vitePackage, 'utf8'));
  const exportEntry = manifest.exports?.['.']?.import?.default || manifest.exports?.['.']?.import;
  const viteEntry = typeof exportEntry === 'string' ? path.resolve(path.dirname(vitePackage), exportEntry) : localRequire.resolve('vite');
  const vite = await import(pathToFileURL(viteEntry).href);
  const createServer = vite.createServer || vite.default?.createServer;
  const plugins = [];
  if (banner) plugins.push(bannerPlugin());
  const loginPlugin = autoLoginPlugin();
  if (loginPlugin) plugins.push(loginPlugin);
  const server = await createServer({
    root: source,
    cacheDir: path.join(stateDir, 'vite-cache', process.env.GANTRY_PREVIEW_ID || 'cache'),
    plugins,
    server: { host, port, strictPort: true, open: false },
  });
  await server.listen();
  markReady();
  console.log(`[gantry] vite ready on http://localhost:${port}`);
  const close = () => server.close();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      setTimeout(() => process.exit(0), 2500).unref();
      close();
      process.exit(0);
    });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
