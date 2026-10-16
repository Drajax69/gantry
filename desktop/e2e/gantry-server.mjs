// Disposable offline service for the combined workspace browser tests.
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
let tickets = [];
let workspacePrompt = 'Implement ${ticket.title} in the prepared worktrees.';
const project = { id: 'fixture', name: 'Fixture workspace', workspace: '/fixture/workspace', defaultAgent: 'generic', scopes: [{id:'both',label:'Frontend + backend'}], environments: [], agents: [{ id:'generic', capabilities:{ available:true,label:'Test agent' } }] };
let overrides = null;
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const send = (value, status = 200) => { res.statusCode = status; res.end(JSON.stringify(value)); };
  if (req.url === '/api/version') return send({ version:'0.1.0' });
  if (req.url === '/api/status' && overrides) return send(overrides);
  if (req.url === '/api/status') return send({ version:'0.1.0', projects:[project], tickets, jobs:[], previews:[{ id:'preview-1', projectId:'fixture', branch:'ticket/review', status:'ready', paused:false, checkouts:[], services:[{id:'frontend',state:'ready',port:6500,openLink:'http://127.0.0.1:6500',logUrl:'/logs/preview/preview-1/frontend'}] }], pulls:[{id:'pull-1',projectId:'fixture',branch:'ticket/review',ready:true,blockers:[],pulls:{frontend:{number:1,title:'Guard add against NaN',url:'https://github.com/local/fixture/pull/1'}}}] });
  if (req.url?.startsWith('/logs/')) { res.setHeader('Content-Type','text/plain'); return res.end('Fixture preview ready'); }
  let raw=''; for await (const chunk of req) raw+=chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (req.url === '/api/projects/fixture/chat-prompt') { if (req.method === 'POST') workspacePrompt=body.prompt; return send({prompt:workspacePrompt}); }
  if (req.url === "/__fixture") { overrides = body.status ?? null; return send({ok:true}); }
  if (req.url === '/api/projects/fixture/tickets') {
    const ticket = { ...body,id:'ticket-1',projectId:'fixture',status:'backlog',branch:'ticket/review',run:null,pullRequests:[],artifacts:[] };
    tickets = [ticket]; return send(ticket);
  }
  if (['/api/tickets/ticket-1/prepare', '/api/tickets/ticket-1/workspace'].includes(req.url)) {
    const cwd = path.resolve('e2e/.tmp/work');
    if (req.url.endsWith('/prepare')) {
      try { execFileSync('git', ['-C', cwd, 'checkout', '-b', tickets[0].branch], {stdio:'pipe'}); } catch { /* branch already exists */ }
      tickets[0].status = 'in_progress';
    }
    return send({ ticket: tickets[0], prompt:workspacePrompt.replace('${ticket.title}', tickets[0].title), project, checkouts: [{repositoryId:'frontend',path:cwd}] });
  }
  if (req.url === '/api/tickets/ticket-1/prompt') return send({agentId:'generic',prompt:'Implement the fixture ticket.'});
  if (req.url === '/api/tickets/ticket-1/update') { Object.assign(tickets[0],body); return send(tickets[0]); }
  if (req.url === '/api/tickets/ticket-1/start') { tickets[0].run = {agent:'generic',state:'running',logUrl:'/logs/run/run-1'}; return send({ok:true,jobId:'job-1'}); }
  if (req.url === '/api/tickets/ticket-1/handoff') { tickets[0].run.state='ready'; return send({ok:true,deepLink:null}); }
  if (req.url === '/api/tickets/ticket-1/delete') { tickets=[]; return send({ok:true}); }
  if (req.url?.startsWith('/api/previews/') || req.url?.endsWith('/refresh')) return send({ok:true});
  send({error:'Unsupported fixture request'},404);
});
server.listen(3458,'127.0.0.1');
