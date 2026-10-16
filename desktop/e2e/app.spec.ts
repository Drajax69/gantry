import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

// The Mac app shell: boots the bundled server and opens the UI in its own window.
// Opt in with E2E_APP=1 after `npm run app:bundle` (it needs the standalone server).
test.skip(!process.env.E2E_APP, "set E2E_APP=1 to test the Electron app");

test("the app starts its own server and opens the UI", async () => {
  const bin = path.resolve(__dirname, "bin");
  const app = await electron.launch({
    args: [path.resolve(__dirname, ".."), ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
    env: {
      ...process.env, PR_LENS_USER_DATA: path.resolve(__dirname, ".tmp", "electron-profile"),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      PR_LENS_GANTRY_DISABLED: "1",
      SHELL: "/bin/false", // use PATH as given instead of a login shell's
      PR_LENS_HOME: path.resolve(__dirname, ".tmp", "home"),
    },
  });
  const win = await app.firstWindow();
  await expect(win.getByPlaceholder(/github.com/)).toBeVisible({ timeout: 30_000 });
  // The top bar makes room for the macOS traffic lights.
  await expect(win.locator("html")).toHaveClass(/electron/);
  const bar = win.locator(".app-bar").first();
  await expect(bar).toHaveCSS("padding-left", "88px");
  await expect(bar).toHaveCSS("-webkit-app-region", "drag");
  await win.getByPlaceholder(/github.com/).fill("https://github.com/local/fixture/pull/1");
  await win.getByRole("button", { name: "Open", exact: true }).click();
  await expect(win.getByRole("tab", { name: "fixture #1", exact: true })).toBeVisible();
  await win.screenshot({ path: path.resolve(__dirname, ".tmp", "app.png") });

  // GitHub links leave the app for the default browser instead of navigating the window.
  const opened = await app.evaluate(({ shell }) => {
    const calls: string[] = [];
    shell.openExternal = async (url: string) => void calls.push(url);
    (globalThis as unknown as { __opened: string[] }).__opened = calls;
    return true;
  });
  expect(opened).toBe(true);
  await win.getByRole("tabpanel", { name: "local/fixture/pull/1" }).getByLabel("Open on GitHub").first().click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened))
    .toEqual([expect.stringContaining("github.com/local/fixture")]);
  expect(win.url()).toContain("127.0.0.1");
  await app.close();
});

test("Gantry deep links open reviews on launch and in an existing window", async () => {
  const bin = path.resolve(__dirname, "bin");
  const app = await electron.launch({
    args: [path.resolve(__dirname, ".."), "pr-lens://review/local/fixture/pull/1"],
    env: {
      ...process.env, PR_LENS_USER_DATA: path.resolve(__dirname, ".tmp", "electron-profile"),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      PR_LENS_GANTRY_DISABLED: "1",
      SHELL: "/bin/false",
      PR_LENS_HOME: path.resolve(__dirname, ".tmp", "home"),
    },
  });
  try {
    const win = await app.firstWindow();
    await expect(win).toHaveURL(/\/local\/fixture\/pull\/1(?:\?|$)/);
    await expect(win.getByRole("tree", { name: "Changed files" })).toBeVisible();
    const origin = new URL(win.url()).origin;
    await win.goto(origin + "/reviews");
    await app.evaluate(({ app }) => {
      app.emit("open-url", { preventDefault() {} }, "pr-lens://review/local/fixture/pull/1");
    });
    await expect(win).toHaveURL(/\/local\/fixture\/pull\/1(?:\?|$)/);
    await expect(win.getByRole("tree", { name: "Changed files" })).toBeVisible();
    for (const link of [
      "pr-lens://review/evil/repo/pull/1?redirect=https://example.com",
      "pr-lens://review/local/fixture/pull/0",
      "https://example.com", "pr-lens://settings/",
    ]) {
      await app.evaluate(({ app }, url) => {
        app.emit("open-url", { preventDefault() {} }, url);
      }, link);
      expect(new URL(win.url()).pathname).toBe("/local/fixture/pull/1");
    }
    await win.goto(origin + "/reviews");
    await app.evaluate(({ app }) => {
      app.emit("second-instance", {}, ["pr-lens", "pr-lens://review/local/fixture/pull/1"]);
    });
    await expect(win).toHaveURL(/\/local\/fixture\/pull\/1(?:\?|$)/);
  } finally {
    await app.close();
  }
});

test("the desktop app starts its bundled Gantry service", async () => {
  const net = await import('node:net');
  const port = await new Promise<number>((resolve) => {
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1', () => {
      const port = (listener.address() as import('node:net').AddressInfo).port;
      listener.close(() => resolve(port));
    });
  });
  const app = await electron.launch({
    args: [path.resolve(__dirname, '..')],
    env: { ...process.env, PR_LENS_USER_DATA: path.resolve(__dirname, ".tmp", "electron-profile"), SHELL:'/bin/false', PR_LENS_GANTRY_DISABLED:'0',
      PR_LENS_GANTRY_URL:`http://127.0.0.1:${port}`,
      GANTRY_DATA_DIR:path.resolve(__dirname,'.tmp','gantry-app'),
      PR_LENS_HOME:path.resolve(__dirname,'.tmp','home'),
    },
  });
  try {
    const win = await app.firstWindow();
    await expect(win).toHaveURL(/\/$/);
    await expect(win.getByRole('heading',{name:'Connect your first workspace'})).toBeVisible();
    expect((await fetch(`http://127.0.0.1:${port}/api/version`)).status).toBe(200);
    const fs = await import('node:fs/promises');
    const { execFileSync } = await import('node:child_process');
    const workspace = path.resolve(__dirname, '.tmp', 'gantry-workspace');
    await fs.mkdir(workspace, { recursive: true });
    execFileSync('git', ['clone', path.resolve(__dirname, '.tmp', 'work'), path.join(workspace, 'repo')]);
    execFileSync('git', ['checkout', 'main'], {cwd:path.join(workspace,'repo')});
    await fs.writeFile(path.join(workspace, 'repo', 'package.json'), '{}');
    await fs.writeFile(path.join(workspace, 'repo', 'app.cjs'), "exports.app=require('node:http').createServer((_req,res)=>res.end('bundled-node-ok'));");
    await fs.writeFile(path.join(workspace, 'gantry.yaml'), JSON.stringify({
      apiVersion:'gantry.dev/v1', project:{id:'native-fixture',name:'Native fixture',portBase:23000},
      repositories:[{id:'repo',path:'repo'}],
      services:[{id:'api',repository:'repo',runtime:'node',entry:'app.cjs',healthUrl:'http://127.0.0.1:${port}/'}],
    }));
    const base = `http://127.0.0.1:${port}`;
    const added = await fetch(base+'/api/projects', {method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({workspace})});
    expect(added.ok).toBe(true);
    await expect.poll(async () => {
      const state = await (await fetch(base+'/api/status')).json();
      return state.previews[0]?.services[0]?.state;
    }, {timeout:30000}).toBe('ready');
    const state = await (await fetch(base+'/api/status')).json();
    expect(await (await fetch(`http://127.0.0.1:${state.previews[0].services[0].port}/`)).text()).toBe('bundled-node-ok');

  } finally {
    // Preview processes intentionally outlive Gantry, so stop the fixture first.
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(base+'/api/status').catch(() => null);
    if (response?.ok) {
      const state = await response.json();
      for (const preview of state.previews) for (const service of preview.services) if (service.pid) { try { process.kill(-service.pid, 'SIGTERM'); } catch { /* already stopped */ } }
      for (const project of state.projects) await fetch(`${base}/api/projects/${project.id}`, {method:'DELETE',headers:{'Content-Type':'application/json',Origin:base},body:'{}'});
    }
    await app.close();
  }
  await expect.poll(async () => {
    try { await fetch(`http://127.0.0.1:${port}/api/version`); return true; } catch { return false; }
  }).toBe(false);
});
