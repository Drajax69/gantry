import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('Gantry ticket, preview and review workflow stays inside Gantry', async ({ page }) => {
  const initialSpaces = await (await page.request.get('/api/spaces')).json();
  await page.goto('/');
  await expect(page.getByLabel('Workspace', { exact:true })).toHaveValue('fixture');
  await page.getByRole('button', {name:'New ticket',exact:true}).click();
  await page.getByLabel('Title', {exact:true}).fill('Draft ticket');
  await page.getByLabel('Notes', {exact:true}).fill('Keep the review in this app.');
  await page.getByRole('button',{name:'Create ticket',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'Draft ticket',exact:true}).first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('Test the unified workspace');
  await page.getByLabel('Notes',{exact:true}).fill('Updated ticket details persist after reload.');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'Test the unified workspace',exact:true}).first()).toBeVisible();
  await page.reload();
  await page.locator('article').filter({hasText:'Test the unified workspace'}).getByRole('button').first().click();
  await expect(page.getByText('Updated ticket details persist after reload.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Create worktrees',exact:true}).click();
  await expect(page.getByText('Ticket worktrees are ready',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close details',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Gantry workspace'}).getByRole('button',{name:/Previews/})).toHaveCount(0);
  await page.getByRole('button',{name:'Preview Test the unified workspace',exact:true}).click();
  await page.getByRole('button',{name:'Logs',exact:true}).click();
  await expect(page.getByText('Fixture preview ready', {exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close details',exact:true}).click();
  await page.getByRole('button',{name:'Open review space for Test the unified workspace',exact:true}).click();
  await expect(page).toHaveURL(/\/space\//);
  await expect(page.getByRole('tab',{name:'fixture #1',exact:true})).toBeVisible();
  await expect(page.getByRole('banner').getByText('PR Lens',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Gantry',exact:true})).toHaveCount(0);
  await expect(page.getByText('Guard add against NaN').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({path:'e2e/.tmp/ticket-review-back.png'});
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page).toHaveURL(/\/\?workspace=fixture&ticket=ticket-1$/);
  await expect(page.getByRole('region',{name:'Ticket board'})).toBeVisible();
  await page.request.patch('/api/spaces',{data:{id:initialSpaces.current,makeCurrent:true}});
});

test('Gantry proxy rejects cross-origin mutations and unsupported routes', async ({ request }) => {
  const crossOrigin = await request.post('/api/gantry/api/projects', {headers:{Origin:'https://untrusted.example'},data:{workspace:'/tmp'}});
  expect(crossOrigin.status()).toBe(403);
  expect((await request.get('/api/gantry/api/private')).status()).toBe(404);
  expect((await request.get('/api/gantry/api/version')).status()).toBe(200);
});

test('Gantry shows a recoverable connection error', async ({ page }) => {
  await page.route('**/api/gantry/api/status', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Gantry is unavailable. Reopen the desktop app, or start Gantry and retry.'})}));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({hasText:'Gantry is unavailable'})).toContainText('Gantry is unavailable');
  await expect(page.getByRole('button',{name:'Refresh Gantry'})).toBeEnabled();
});

test('Gantry follows the review app themes and desktop window sizes', async ({ page }) => {
  await page.goto('/reviews');
  await expect(page.getByPlaceholder(/github.com/)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250); // Let shared control and theme transitions settle for visual review.
  await page.screenshot({path:'e2e/.tmp/incumbent-home.png'});
  await page.goto('/');
  await expect(page.getByLabel('Workspace', {exact:true})).toHaveValue('fixture');
  await page.getByRole('button',{name:'New ticket',exact:true}).click();
  await page.getByLabel('Title', {exact:true}).fill('Keep branch previews stable across restarts');
  await page.getByLabel('Notes', {exact:true}).fill('Reuse managed services when their configuration is unchanged. Verify that the agent can prepare the branch, open a preview, and hand it over for review.');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250); // Let shared control and theme transitions settle for visual review.
  await page.screenshot({path:'e2e/.tmp/unified-tickets-light.png'});
  await page.getByRole('button',{name:'Close details',exact:true}).click();
  await page.getByRole('button',{name:'Toggle theme'}).click();
  await page.getByRole('button',{name:'Edit ticket Test the unified workspace',exact:true}).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.setViewportSize({width:900,height:650});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250); // Let shared control and theme transitions settle for visual review.
  await page.screenshot({path:'e2e/.tmp/unified-tickets-dark-compact.png'});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('navigation',{name:'Gantry workspace'}).getByRole('button',{name:/Previews/})).toHaveCount(0);
  await page.getByRole('button',{name:'Close details',exact:true}).click();
  await page.getByRole('button',{name:'Preview Test the unified workspace',exact:true}).click();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250); // Let shared control and theme transitions settle for visual review.
  await page.screenshot({path:'e2e/.tmp/unified-previews-dark-compact.png'});
  await page.getByRole('button',{name:'Close details',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('navigation',{name:'Gantry workspace'}).getByRole('button',{name:/Reviews/}).click();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250); // Let shared control and theme transitions settle for visual review.
  await page.screenshot({path:'e2e/.tmp/unified-reviews-dark.png'});
});

test('workspace tickets own stable spaces and collect all associated PRs', async ({page,request}) => {
  test.setTimeout(90000);
  const base = await (await request.get('http://127.0.0.1:3458/api/status')).json();
  const originalSpaces = await (await request.get('/api/spaces')).json();
  const ticket = (id:string,projectId:string,branch:string) => ({id,projectId,title:'Shared title',description:'',status:'backlog',scope:'both',branch,pullRequests:[],artifacts:[],run:null});
  const status = {...base,projects:[base.projects[0],{...base.projects[0],id:'other',name:'Other workspace',workspace:'/fixture/other'}],
    tickets:[ticket('linked-one','fixture','ticket/review'),ticket('linked-two','other','ticket/review'),ticket('empty-ticket','fixture','feature/empty')],
    pulls:[{...base.pulls[0],pulls:{frontend:base.pulls[0].pulls.frontend,backend:{number:2,url:'https://github.com/local/fixture/pull/2',title:'Backend fix'}}}],
  };
  try {
    await request.post('http://127.0.0.1:3458/__fixture',{data:{status}});
    await page.goto('/');
    await expect(page.getByRole('region',{name:'Ticket board'})).toBeVisible();
    const first = await (await request.get('/api/gantry/api/status')).json();
    const spaces = await (await request.get('/api/spaces')).json();
    const one = spaces.spaces.find((s:{id:string})=>s.id===first.tickets[0].reviewSpaceId);
    const two = spaces.spaces.find((s:{id:string})=>s.id===first.tickets[1].reviewSpaceId);
    expect(one.id).not.toBe(two.id);
    expect(one.targets).toEqual(['local/fixture/pull/1','local/fixture/pull/2']);
    expect(two.targets).toEqual([]);
    expect(first.tickets[2].reviewSpaceId).toBeTruthy();
    await request.patch('/api/spaces',{data:{id:one.id,active:'local/fixture/pull/1',file:{target:'local/fixture/pull/1',path:'src/math.ts'}}});
    await page.getByRole('button',{name:'Open review space for Shared title',exact:true}).first().click();
    await expect(page).toHaveURL(new RegExp(`/space/${one.id}`));
    await expect(page.getByRole('tab',{name:'fixture #1',exact:true})).toBeVisible();
    await expect(page.getByRole('tab',{name:'fixture #2',exact:true})).toBeVisible();
    // A new PR arrives while the user remains in the space.
    status.tickets[0].pullRequests = [{role:'docs',number:3,url:'https://github.com/local/fixture/pull/3',title:'Docs fix'}] as never[];
    await request.post('http://127.0.0.1:3458/__fixture',{data:{status}});
    await expect(page.getByRole('tab',{name:'fixture #3',exact:true})).toBeVisible({timeout:15000});
    const repeated = await (await request.get('/api/gantry/api/status')).json();
    expect(repeated.tickets[0].reviewSpaceId).toBe(one.id);
    const updated = (await (await request.get('/api/spaces')).json()).spaces.find((s:{id:string})=>s.id===one.id);
    expect(updated.targets).toHaveLength(3);
    expect(updated.files['local/fixture/pull/1']).toBe('src/math.ts');
    status.tickets[0].status = 'done';
    await request.post('http://127.0.0.1:3458/__fixture',{data:{status}});
    const completed = await (await request.get('/api/gantry/api/status')).json();
    expect(completed.tickets[0].reviewSpaceId).toBeUndefined();
    expect((await (await request.get('/api/spaces')).json()).spaces.some((s:{id:string}) => s.id === one.id)).toBe(false);
    expect((await request.patch('/api/spaces',{data:{id:one.id,makeCurrent:true}})).status()).toBe(404);
    await expect(page).toHaveURL(/\/$/, {timeout:15000});
    await expect(page.getByRole('region',{name:'Done',exact:true}).getByRole('button',{name:/Open review space/})).toHaveCount(0);
    await expect(page.getByRole('region',{name:'Done',exact:true}).getByRole('button',{name:/Preview/})).toHaveCount(0);
    status.tickets[0].status = 'backlog';
    await request.post('http://127.0.0.1:3458/__fixture',{data:{status}});
    const reopened = await (await request.get('/api/gantry/api/status')).json();
    expect(reopened.tickets[0].reviewSpaceId).toBe(one.id);
    await page.goto(`/space/${one.id}`);
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await expect(page.getByLabel('Workspace',{exact:true})).toHaveValue('fixture');
    await expect(page.getByRole('region',{name:'Ticket details'})).toBeVisible();
    await page.getByRole('button',{name:'Close details',exact:true}).click();
    await page.getByLabel('Workspace',{exact:true}).selectOption('other');
    await page.getByRole('button',{name:'Open review space for Shared title',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/space/${two.id}`));
    await expect(page.getByRole('tab')).toHaveCount(0);
  } finally {
    await request.post('http://127.0.0.1:3458/__fixture',{data:{status:null}});
    await page.goto('/reviews');
    const current = await (await request.get('/api/spaces')).json();
    for (const space of current.spaces) {
      if (!originalSpaces.spaces.some((s:{id:string}) => s.id === space.id)) await request.delete(`/api/spaces?id=${space.id}`);
    }
    await request.patch('/api/spaces',{data:{id:originalSpaces.current,makeCurrent:true}});
  }
});


test('tickets drag between columns and reopen one external Codex conversation', async ({page,request}) => {
  await page.goto('/');
  const card = page.locator('article').filter({hasText:'Test the unified workspace'});
  await card.dragTo(page.getByRole('region',{name:'Backlog',exact:true}));
  await expect(page.getByRole('region',{name:'Backlog',exact:true}).locator('article')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('region',{name:'Backlog',exact:true}).locator('article')).toHaveCount(1);
  const agents = await (await request.get('/api/agents')).json();
  const codex = agents.agents.find((a:{kind:string}) => a.kind === 'codex') || await (await request.post('/api/agents',{data:{kind:'codex',name:'Codex'}})).json();
  await request.patch('/api/agents',{data:{id:codex.id,current:true}});
  await page.reload();
  const launches = path.resolve('e2e/.tmp/home/external-launches.jsonl');
  await page.getByRole('button',{name:'Open chat for Test the unified workspace'}).click();
  await expect(page.getByText('Opened this ticket in Codex',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const initial = await (await request.post('/api/ticket-chat',{data:{ticketId:'ticket-1',action:'load'}})).json();
  expect(initial.conversation.provider).toBe('codex');
  const id = initial.conversation.sessionId;
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  const protocol = fs.readFileSync(path.resolve('e2e/.tmp/home/codex-protocol.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
  expect(protocol.filter(c=>c.method==='thread/start')).toHaveLength(1);
  expect(protocol.some(c=>c.method==='turn/start')).toBe(false);
  expect(protocol.find(c=>c.method==='thread/start').params.developerInstructions).toContain('Updated ticket details persist after reload.');
  await request.patch('/api/agents',{data:{id:'claude',current:true}});
  const responses = await Promise.all([1,2].map(()=>request.post('/api/ticket-chat',{data:{ticketId:'ticket-1',action:'open'}})));
  for (const response of responses) expect((await response.json()).conversation.sessionId).toBe(id);
  expect(fs.readFileSync(launches,'utf8')).toContain(id);
  await page.reload();
  await page.getByRole('button',{name:'Edit ticket Test the unified workspace'}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Chat',exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:/Ask/})).toHaveCount(0);
  await expect(page.getByText(/Linked to Codex/)).toBeVisible();
  await page.setViewportSize({width:900,height:650});
  await page.screenshot({path:'e2e/.tmp/external-conversation-compact.png'});
  await page.keyboard.press('Escape');
  expect((await request.post('/api/ticket-chat',{headers:{Origin:'https://other.example'},data:{ticketId:'ticket-1',action:'open'}})).status()).toBe(403);
  expect((await request.post('/api/ticket-chat',{data:{ticketId:'ticket-1',action:'send',text:'Do not run'}})).status()).toBe(400);
  await request.patch('/api/agents',{data:{id:agents.current,current:true}});
});

test('Claude conversation uses one session ID and resumes it; launch failures retain association', async ({request}) => {
  const home = path.resolve('e2e/.tmp/home');
  const recordFile = path.join(home,'ticket-conversations/ticket-1.json');
  fs.unlinkSync(recordFile); // Reset only this disposable fixture's association.
  await request.patch('/api/agents',{data:{id:'claude',current:true}});
  fs.writeFileSync(path.join(home,'fail-external-launch'),'fixture');
  expect((await request.post('/api/ticket-chat',{data:{ticketId:'ticket-1',action:'open'}})).ok()).toBe(false);
  const failed = JSON.parse(fs.readFileSync(recordFile,'utf8'));
  fs.unlinkSync(path.join(home,'fail-external-launch'));
  const first = await (await request.post('/api/ticket-chat',{data:{ticketId:'ticket-1',action:'open'}})).json();
  expect(first.conversation.sessionId).toBe(failed.sessionId);
  expect(first.conversation.provider).toBe('claude');
  const sessionDir=path.resolve('e2e/.tmp/claude-config/projects/fixture');
  fs.mkdirSync(sessionDir,{recursive:true});
  fs.writeFileSync(path.join(sessionDir,failed.sessionId+'.jsonl'),'{}');
  const reopened = await (await request.post('/api/ticket-chat',{data:{ticketId:'ticket-1',action:'open'}})).json();
  expect(reopened.conversation.sessionId).toBe(failed.sessionId);
  const calls=fs.readFileSync(path.join(home,'external-launches.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
  expect(JSON.stringify(calls.at(-1))).toContain('--resume');
  expect(JSON.stringify(calls.at(-1))).toContain('Updated ticket details persist after reload.');
  expect(JSON.stringify(calls.at(-1))).toContain(failed.sessionId);
  expect(JSON.stringify(calls.at(-1))).toContain('custom title');
});

test('API-only providers fail clearly without launching or creating an embedded chat', async ({request}) => {
  const home=path.resolve('e2e/.tmp/home');
  fs.unlinkSync(path.join(home,'ticket-conversations/ticket-1.json'));
  const previous = await (await request.get('/api/agents')).json();
  const provider = await (await request.post('/api/agents',{data:{kind:'openai',name:'API fixture',baseUrl:'http://127.0.0.1:9',model:'fixture'}})).json();
  const response=await request.post('/api/ticket-chat',{data:{ticketId:'ticket-1',action:'open'}});
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain('API endpoint');
  expect(fs.existsSync(path.join(home,'ticket-conversations/ticket-1.json'))).toBe(false);
  await request.patch('/api/agents',{data:{id:previous.current,current:true}});
  await request.delete(`/api/agents?id=${provider.id}`);
});

test('ticket colours are distinct, survive moves and reloads, and stay readable in both themes', async ({page,request}) => {
  const status=await (await request.get('http://127.0.0.1:3458/api/status')).json();
  const titles=['Refresh the exam creator','Improve graphs','Make insights clearer','Collaborative exams','Simplify question search','Export answer sheets','Online exam runtime','Preview branch changes','Answer sheet tags','Faster document uploads'];
  const tickets=titles.map((title,i)=>({projectId:'fixture',description:'',scope:'both',run:null,pullRequests:[],artifacts:[],...status.tickets[0],id:`colour-${i}`,title,branch:`ticket/colour-${i}`,status:i<6?'backlog':i<8?'in_progress':'done',position:i}));
  try {
    await request.post('http://127.0.0.1:3458/__fixture',{data:{status:{...status,tickets}}});
    await page.goto('/');
    const cards=page.locator('article[data-ticket-id]');
    await expect(cards).toHaveCount(10);
    await expect.poll(()=>cards.evaluateAll(es=>new Set(es.map(e=>e.getAttribute('style'))).size)).toBe(10);
    const original=await cards.evaluateAll(es=>Object.fromEntries(es.map(e=>[e.getAttribute('data-ticket-id'),e.getAttribute('style')])));
    for(const theme of ['light','dark']) {
      await page.evaluate(theme=>localStorage.setItem('theme',theme),theme);
      await page.reload();
      await expect(cards).toHaveCount(10);
      await expect.poll(()=>cards.evaluateAll(es=>new Set(es.map(e=>e.getAttribute('style'))).size)).toBe(10);
      await page.setViewportSize({width:1440,height:1000});
      await page.screenshot({path:`e2e/.tmp/colour-board-${theme}.png`});
      const minimum=await cards.evaluateAll(es=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;
        const lum=(color:string)=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(v=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
        return Math.min(...es.flatMap(e=>{const bg=lum(getComputedStyle(e).backgroundColor);return [e,e.querySelector('.text-muted-foreground')!,...e.querySelectorAll('.gantry-ticket-actions button:not(:disabled)')].map(el=>{const fg=lum(getComputedStyle(el).color);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);});}));
      });
      expect(minimum).toBeGreaterThanOrEqual(4.5);
    }
    tickets[0].status='in_progress'; tickets.reverse();
    await request.post('http://127.0.0.1:3458/__fixture',{data:{status:{...status,tickets}}});
    await page.reload();
    await expect(cards).toHaveCount(10);
    await expect.poll(()=>cards.evaluateAll(es=>Object.fromEntries(es.map(e=>[e.getAttribute('data-ticket-id'),e.getAttribute('style')])))).toEqual(original);
    await page.setViewportSize({width:900,height:650});
    await page.screenshot({path:'e2e/.tmp/colour-board-compact.png'});
    await page.getByRole('button',{name:/Refresh the exam creator.*ticket\/colour-0/}).click();
    await expect(page.getByRole('dialog').locator('header')).toHaveClass(/gantry-ticket-heading/);
  } finally { await request.post('http://127.0.0.1:3458/__fixture',{data:{status:null}}); }
});
