import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Agents are global, so these tests leave Claude as the current agent when they finish.
const TMP = path.resolve(__dirname, ".tmp");
const sha = () => fs.readFileSync(path.join(TMP, "feature.sha"), "utf8").trim();

function calls(name: string): { args: string[]; prompt: string; cwd: string }[] {
  const f = path.join(TMP, "home", `${name}-calls.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const composer = (page: Page) => page.getByPlaceholder("Ask about the whole change…");
async function ask(page: Page, text: string) {
  if (!(await composer(page).isVisible())) await page.getByRole("button", { name: "Questions about the whole change" }).click();
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

async function useClaude(page: Page) {
  const { agents } = await (await page.request.get("/api/agents")).json();
  const claude = agents.find((a: { kind: string }) => a.kind === "claude");
  await page.request.patch("/api/agents", { data: { id: claude.id, current: true } });
}

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ request }) => {
  const { agents } = await (await request.get("/api/agents")).json();
  for (const a of agents) if (a.kind !== "claude") await request.delete(`/api/agents?id=${a.id}`);
});

test("add Codex, switch to it, and it answers with prior context", async ({ page }) => {
  // A Claude answer first, so Codex joins a chat in progress.
  await page.goto(`/local/fixture/commit/${sha()}`);
  await expect(page.getByRole("button", { name: "Agent: Claude" })).toBeVisible();
  await ask(page, "What does this commit do?");
  await expect(page.getByText("Looks fine.")).toBeVisible();

  await page.getByLabel("Settings").click();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await page.getByRole("button", { name: "Codex" }).click();
  await page.getByRole("button", { name: "Add and use" }).click();
  const card = page.locator("div", { has: page.getByRole("button", { name: "Edit Codex" }) }).last();
  await expect(card).toContainText("In use");
  await expect(card).toContainText("codex-cli 0.0.0-fixture");

  await page.goto(`/local/fixture/commit/${sha()}`);
  await expect(page.getByRole("button", { name: "Agent: Codex" })).toBeVisible();
  await ask(page, "Second opinion?");
  await expect(page.getByText("Codex here:")).toBeVisible();
  await expect(page.getByText("git diff HEAD~1 -- src/math.ts").last()).toBeAttached();

  const first = calls("codex").at(-1)!;
  expect(first.args).toEqual(expect.arrayContaining(["exec", "--json", "--ignore-user-config", "--ignore-rules", "--sandbox", "workspace-write"]));
  expect(first.args).not.toContain("resume");
  // Codex gets the review instructions and the earlier Claude exchange.
  expect(first.prompt).toContain("You are helping someone review code in local/fixture");
  expect(first.prompt).toContain("What does this commit do?");
  expect(first.prompt).toContain("Looks fine.");
  expect(first.cwd).toContain("worktrees");

  // The follow-up resumes Codex's own session.
  await ask(page, "And again?");
  await expect(page.getByText("Codex again: still fine.")).toBeVisible();
  const second = calls("codex").at(-1)!;
  expect(second.args).toEqual(expect.arrayContaining(["resume", "thread-fixture", "-"]));
  expect(second.prompt).toContain("And again?");
  expect(second.prompt).toContain("editable local checkout");

  // Answers say who wrote them, and switching back is one click in the chat header.
  await expect(page.getByText("Codex", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Agent: Codex" }).click();
  await page.getByRole("menuitemradio", { name: /Claude/ }).click();
  await expect(page.getByRole("button", { name: "Agent: Claude" })).toBeVisible();
  const before = calls("claude").length;
  await ask(page, "Back to Claude?");
  await expect(page.getByText("Following up.").last()).toBeVisible();
  expect(calls("claude").length).toBe(before + 1);
  // Claude resumes its own session, untouched by the Codex detour.
  expect(calls("claude").at(-1)!.args).toEqual(expect.arrayContaining(["--resume", "sess-fixture"]));
});

test("an own provider answers through an OpenAI-compatible API with repo tools", async ({ page }) => {
  // A tiny fake provider: first it asks to read a file, then answers from what it read.
  const seen: { auth?: string; body: { model: string; messages: { role: string; content: string | null }[] } }[] = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
      return;
    }
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push({ auth: req.headers.authorization, body });
      res.setHeader("Content-Type", "text/event-stream");
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const toolResult = body.messages.find((m: { role: string }) => m.role === "tool");
      if (!toolResult) {
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: '{"path":' } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"src/math.ts"}' } }] } }] });
        send({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      } else {
        const guarded = toolResult.content.includes("Guard against NaN");
        send({ choices: [{ delta: { content: guarded ? "Read it: " : "Couldn't read it. " } }] });
        send({ choices: [{ delta: { content: "the NaN guard is at `src/math.ts:3`." } }] });
        send({ choices: [{ delta: {}, finish_reason: "stop" }] });
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  try {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Own provider" }).click();
    await page.getByLabel("Name").fill("Local fake");
    await page.getByLabel("Base URL").fill(base);
    await page.getByLabel("API key").fill("sk-test-123");
    await page.getByLabel("Model").fill("fake-model");
    await page.getByRole("button", { name: "Add and use" }).click();
    await page.getByRole("button", { name: "Test Local fake" }).click();
    await expect(page.getByText("Connected to 127.0.0.1")).toBeVisible();

    // The key stays on the server.
    const list = await (await page.request.get("/api/agents")).json();
    expect(JSON.stringify(list)).not.toContain("sk-test-123");

    await page.goto(`/local/fixture/commit/${sha()}`);
    await expect(page.getByRole("button", { name: "Agent: Local fake" })).toBeVisible();
    await ask(page, "Where is the guard?");
    await expect(page.getByText("Read it: the NaN guard is at")).toBeVisible();
    await expect(page.getByText("read_file src/math.ts")).toBeAttached();

    expect(seen[0].auth).toBe("Bearer sk-test-123");
    expect(seen[0].body.model).toBe("fake-model");
    // The provider sees the whole conversation so far, including other agents' answers.
    const contents = seen[0].body.messages.map((m) => m.content ?? "").join("\n");
    expect(contents).toContain("Codex here:");
    expect(contents).toContain("Where is the guard?");
  } finally {
    server.close();
    await useClaude(page);
  }
});

test("repo tools stay inside the checkout", async ({ page }) => {
  // Same provider shape, but it tries to read outside the repo and to write with git.
  let results: string[] = [];
  let step = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      results = body.messages.filter((m: { role: string }) => m.role === "tool").map((m: { content: string }) => m.content);
      res.setHeader("Content-Type", "text/event-stream");
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const calls = [
        ["read_file", { path: "../../../../etc/passwd" }],
        ["read_file", { path: ".git/config" }],
        ["git", { args: ["diff", "--output=/tmp/pwned", "HEAD~1"] }],
        ["git", { args: ["diff", "--no-index", "/etc/hostname", "README.md"] }],
        ["git", { args: ["push"] }],
      ];
      if (step < calls.length) {
        const [name, args] = calls[step++];
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${step}`, function: { name, arguments: JSON.stringify(args) } }] } }] });
      } else {
        send({ choices: [{ delta: { content: "Done probing." } }] });
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  try {
    const agent = await (await page.request.post("/api/agents", { data: { kind: "openai", name: "Prober", baseUrl: base, model: "m" } })).json();
    expect(agent.id).toBeTruthy();
    await page.goto(`/local/fixture/commit/${sha()}`);
    await ask(page, "Probe");
    await expect(page.getByText("Done probing.")).toBeVisible();
    expect(results).toEqual([
      expect.stringContaining("outside the repository"),
      expect.stringContaining("off limits"),
      expect.stringContaining("isn't allowed"),
      expect.stringContaining("isn't allowed"),
      expect.stringContaining("only diff, log, show and blame"),
    ]);
    expect(fs.existsSync("/tmp/pwned")).toBe(false);
  } finally {
    server.close();
    await useClaude(page);
  }
});

test('agents edit local files and refresh preserves their changes', async ({ page }) => {
  let step = 0;
  let results: string[] = [];
  const actions = [
    ['write_file', {path:'local-edit.txt',content:'Before edit\n'}],
    ['edit_file', {path:'local-edit.txt',old_text:'Before',new_text:'After'}],
    ['read_file', {path:'local-edit.txt'}],
    ['write_file', {path:'../outside.txt',content:'escape'}],
    ['write_file', {path:'.git/unsafe',content:'escape'}],
  ];
  const server = http.createServer((req,res) => {
    let raw=''; req.on('data',d => raw+=d); req.on('end',()=> {
      const body=JSON.parse(raw);
      results=body.messages.filter((m:{role:string})=>m.role==='tool').map((m:{content:string})=>m.content);
      res.setHeader('Content-Type','text/event-stream');
      if(step<actions.length) {
        const [name,args]=actions[step++];
        res.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:`edit${step}`,function:{name,arguments:JSON.stringify(args)}}]}}]})}\n\n`);
      } else res.write(`data: ${JSON.stringify({choices:[{delta:{content:'Local edits saved.'}}]})}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try {
    const baseUrl=`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    await page.request.post('/api/agents',{data:{kind:'openai',name:'Editor',baseUrl,model:'fixture'}});
    const id=`local/fixture/commit/${sha()}`;
    await page.goto('/'+id);
    await ask(page,'Create and update the local notes file.');
    await expect(page.getByText('Local edits saved.',{exact:true})).toBeVisible();
    expect(results[0]).toContain('Saved local-edit.txt');
    expect(results[1]).toContain('Saved local-edit.txt');
    expect(results[2]).toContain('After edit');
    expect(results[3]).toContain('outside the repository');
    expect(results[4]).toContain('off limits');
    const checkout=calls('codex')[0].cwd;
    const file=path.join(checkout,'local-edit.txt');
    expect(fs.readFileSync(file,'utf8')).toBe('After edit\n');
    // Modify a tracked file too: checkout --force would silently lose this.
    const tracked=path.join(checkout,'src/math.ts');
    const original=fs.readFileSync(tracked,'utf8');
    fs.writeFileSync(tracked,original+'\n// Local fix\n');
    try {
      const refreshed=await page.request.get(`/api/target?id=${encodeURIComponent(id)}&refresh=1`);
      expect(refreshed.ok()).toBe(true);
      expect(fs.readFileSync(tracked,'utf8')).toContain('// Local fix');
      expect(fs.readFileSync(file,'utf8')).toBe('After edit\n');
    } finally { fs.writeFileSync(tracked,original); fs.rmSync(file); }
  } finally { server.close(); await useClaude(page); }
});
