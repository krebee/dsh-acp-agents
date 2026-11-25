import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { confirmModelAction, showDesktopSecret, controlConfig } from '../lib/desktop-confirm.js';
import { INTERNAL_SECRETS_KEY } from '../lib/internal-secret.mjs';
import { approvalPolicyOf, acpRuntimePolicy } from '../lib/host-contract.js';
import { createTaskCheckout, removeTaskCheckout } from '../lib/isolation.js';

test('desktop confirmation only trusts successful loopback responses and never follows redirects', async (t) => {
  const previousUrl = process.env.DSH_DESKTOP_INSTALL_URL;
  const previousSecrets = Object.getOwnPropertyDescriptor(globalThis, INTERNAL_SECRETS_KEY);
  Object.defineProperty(globalThis, INTERNAL_SECRETS_KEY, { configurable: true, value: new Map([['DSH_DESKTOP_INSTALL_TOKEN', 'test-only-token']]) });
  t.after(() => {
    if (previousUrl === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
    else process.env.DSH_DESKTOP_INSTALL_URL = previousUrl;
    if (previousSecrets) Object.defineProperty(globalThis, INTERNAL_SECRETS_KEY, previousSecrets);
    else delete globalThis[INTERNAL_SECRETS_KEY];
  });
  let calls = 0;
  let response = new Response(JSON.stringify({ ok: true }), { status: 200 });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.match(url, /^http:\/\/127\.0\.0\.1:12345\/desktop\//);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer test-only-token');
    return response;
  });
  for (const url of ['https://example.invalid', 'http://localhost.example.invalid', 'file:///tmp/control', 'http://user:pass@127.0.0.1:12345', 'http://127.0.0.1:12345/?x=1']) {
    process.env.DSH_DESKTOP_INSTALL_URL = url;
    assert.equal(controlConfig(), null);
    assert.deepEqual(await confirmModelAction({}), { ok: false });
  }
  assert.equal(calls, 0);
  process.env.DSH_DESKTOP_INSTALL_URL = 'http://127.0.0.1:12345/';
  assert.deepEqual(await confirmModelAction({}), { ok: true });
  for (const status of [302, 401, 403, 500]) {
    response = new Response(JSON.stringify({ ok: true }), { status });
    assert.deepEqual(await confirmModelAction({}), { ok: false });
  }
  response = new Response(JSON.stringify({ ok: 'true' }), { status: 200 });
  assert.deepEqual(await showDesktopSecret({ secret: 'test-only' }), { ok: false });
  response = new Response('not JSON', { status: 200 });
  assert.deepEqual(await confirmModelAction({}), { ok: false });
});

test('missing host approval service cannot activate unrestricted no-prompt mode', () => {
  const policy = approvalPolicyOf(undefined, {});
  assert.equal(policy, 'ask');
  const runtime = acpRuntimePolicy({ cwd: process.cwd(), sandboxMode: 'danger-full-access', readOnly: false, ask: policy !== 'never' });
  assert.equal(runtime.runtimeMode, 'approval-required');
  assert.equal(runtime.approvalPolicy, 'on-request');
  assert.equal(approvalPolicyOf({ policyOf: () => 'never' }, {}), 'never');
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-security-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(repo);
  fs.mkdirSync(outside);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, stdio: 'ignore' });
  git('init');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'test');
  git('add', 'tracked.txt');
  git('commit', '-m', 'initial');
  return { repo, outside };
}

test('worktree creation and cleanup reject linked roots and preserve external files', async (t) => {
  const { repo, outside } = fixture(t);
  const worktrees = path.join(repo, '.agent-worktrees');
  fs.mkdirSync(path.join(outside, 'task'));
  const marker = path.join(outside, 'task', 'keep.txt');
  fs.writeFileSync(marker, 'keep');
  fs.symlinkSync(outside, worktrees, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createTaskCheckout(repo, 'new-task'), /real repository directory/);
  assert.equal(await removeTaskCheckout(repo, path.join(worktrees, 'task')), false);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');
  assert.equal(fs.existsSync(path.join(outside, 'new-task')), false);
});

test('worktree cleanup preserves unregistered directories and still removes legitimate checkouts', async (t) => {
  const { repo } = fixture(t);
  await assert.rejects(createTaskCheckout(repo, '../outside'), /Invalid task worktree id/);
  const task = await createTaskCheckout(repo, 'valid-task');
  assert.equal(fs.readFileSync(path.join(task.cwd, 'tracked.txt'), 'utf8'), 'test');
  assert.equal(await removeTaskCheckout(repo, task.cwd), true);
  assert.equal(fs.existsSync(task.cwd), false);
  const unregistered = path.join(repo, '.agent-worktrees', 'unregistered');
  fs.mkdirSync(unregistered);
  const marker = path.join(unregistered, 'keep.txt');
  fs.writeFileSync(marker, 'keep');
  await assert.rejects(createTaskCheckout(repo, 'unregistered'), /already exists/);
  assert.equal(await removeTaskCheckout(repo, unregistered), false);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');
});
