import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const id = 'local/fixture/pull/1';
const root = path.resolve('e2e/.tmp');
const checkout = path.join(root,'home/worktrees/local_fixture_pull_1');
const remote = path.join(root,'remote.git');
const git = (cwd:string,...args:string[]) => execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();

test('local deletions, edits and new files are visible, and commit and push updates the PR',async({page,request})=>{
  fs.rmSync(path.join(root,'home/pr-state'),{force:true});
  await request.get(`/api/target?id=${id}&refresh=1`);
  git(checkout,'config','user.name','Test'); git(checkout,'config','user.email','test@example.com');
  git(checkout,'config',`url.file://${remote}.insteadOf`,'https://github.com/local/fixture.git');
  // Offline GitHub: mirror a pushed branch to its pull-request ref.
  fs.writeFileSync(path.join(remote,'hooks/post-receive'),'#!/bin/sh\nwhile read old new ref; do\n if [ "$ref" = "refs/heads/feature" ]; then git update-ref refs/pull/1/head "$new"; fi\ndone\n',{mode:0o755});
  fs.unlinkSync(path.join(checkout,'src/util.py'));
  fs.appendFileSync(path.join(checkout,'src/math.ts'),'\n// Locally corrected\n');
  fs.writeFileSync(path.join(checkout,'new-note.txt'),'Ready to publish\n');
  const beforeIndex=git(checkout,'write-tree');
  const local=await (await request.get(`/api/local-changes?id=${id}`)).json();
  expect(local.files.map((f:{path:string;status:string})=>[f.path,f.status])).toEqual(expect.arrayContaining([['src/util.py','D'],['src/math.ts','M'],['new-note.txt','A']]));
  expect(git(checkout,'write-tree')).toBe(beforeIndex);
  const deleted=await (await request.get(`/api/file?id=${id}&path=src/util.py&mode=diff&source=local`)).json();
  expect(deleted.rows.some((r:{k:string;text:string})=>r.k==='del'&&r.text.includes('greet'))).toBe(true);
  const pr=await (await request.get(`/api/file?id=${id}&path=src/util.py&mode=full`)).json();
  expect(pr.lines).not.toBeNull();
  await page.goto('/'+id);
  await expect(page.getByRole('button',{name:'Local changes (3)',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Commit and push',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('src/util.py');
  await page.setViewportSize({width:1000,height:700});
  await page.screenshot({path:path.join(root,'publish-dialog.png')});
  await page.getByLabel('Commit message').fill('Remove unused helper and update local notes');
  await page.getByRole('dialog').getByRole('button',{name:'Commit and push',exact:true}).click();
  await expect(page.getByText('Changes pushed to the PR',{exact:true})).toBeVisible();
  expect(git(remote,'rev-parse','feature')).toBe(git(checkout,'rev-parse','HEAD'));
  expect(git(checkout,'status','--porcelain')).toBe('');
  await expect(page.getByRole('button',{name:'Local changes (0)',exact:true})).toBeVisible();
  expect((await (await request.get(`/api/local-changes?id=${id}`)).json()).commits).toBe(0);
});

test('stale snapshots and cross-origin requests cannot publish; failed pushes retain retryable commits',async({request})=>{
  fs.writeFileSync(path.join(checkout,'retry.txt'),'First version\n');
  const snapshot=await (await request.get(`/api/local-changes?id=${id}`)).json();
  const data={id,tree:snapshot.tree,head:snapshot.head,message:'Retryable commit'};
  expect((await request.post('/api/local-changes',{headers:{Origin:'https://other.example'},data})).status()).toBe(403);
  fs.appendFileSync(path.join(checkout,'retry.txt'),'Updated version\n');
  expect((await request.post('/api/local-changes',{data})).status()).toBe(409);
  const updated=await (await request.get(`/api/local-changes?id=${id}`)).json();
  fs.writeFileSync(path.join(remote,'hooks/pre-receive'),'#!/bin/sh\nexit 1\n',{mode:0o755});
  const failed=await request.post('/api/local-changes',{data:{...data,tree:updated.tree,head:updated.head}});
  expect(failed.status()).toBe(409);
  expect((await failed.json()).error).toContain('commit is saved locally');
  const commit=git(checkout,'rev-parse','HEAD');
  // A remote refresh must never reset an unpushed commit.
  expect((await request.get(`/api/target?id=${id}&refresh=1`)).ok()).toBe(true);
  expect(git(checkout,'rev-parse','HEAD')).toBe(commit);
  fs.unlinkSync(path.join(remote,'hooks/pre-receive'));
  const retry=await (await request.get(`/api/local-changes?id=${id}`)).json();
  expect(retry.commits).toBe(1);
  expect((await request.post('/api/local-changes',{data:{...data,tree:retry.tree,head:retry.head,message:''}})).ok()).toBe(true);
  expect(git(remote,'rev-parse','feature')).toBe(commit);
});

test('remote advances are rejected without losing local edits',async({request})=>{
  const work=path.join(root,'work');
  git(work,'fetch',remote,'feature'); git(work,'reset','--hard','FETCH_HEAD');
  fs.writeFileSync(path.join(work,'remote-only.txt'),'Someone else committed this\n');
  git(work,'add','.'); git(work,'commit','-m','Remote advance'); git(work,'push',remote,'HEAD:refs/heads/feature');
  fs.writeFileSync(path.join(checkout,'local-only.txt'),'Keep this edit\n');
  const local=await (await request.get(`/api/local-changes?id=${id}`)).json();
  const head=git(checkout,'rev-parse','HEAD');
  const response=await request.post('/api/local-changes',{data:{id,tree:local.tree,head:local.head,message:'Must not push'}});
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain('new or conflicting commits');
  expect(git(checkout,'rev-parse','HEAD')).toBe(head);
  expect(fs.readFileSync(path.join(checkout,'local-only.txt'),'utf8')).toBe('Keep this edit\n');
});
