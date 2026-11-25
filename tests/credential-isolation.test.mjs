import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { restrictedAgentEnvironment } from '../lib/agent-environment.js';
import { buildAgentRuntimeEnv } from '../lib/presets.js';

test('host credentials and arbitrary environment values are not inherited by ACP agents', () => {
  const host = {
    PATH: '/bin', HOME: '/home/test', LANG: 'C',
    OPENAI_API_KEY: 'host-openai', ANTHROPIC_API_KEY: 'host-anthropic',
    GITHUB_TOKEN: 'host-github', AWS_SECRET_ACCESS_KEY: 'host-aws',
    DSH_DESKTOP_INSTALL_TOKEN: 'host-control',
    DSH_ACP_MCP_AUTHORIZATION: 'old-mcp-token',
    HTTPS_PROXY: 'http://user:password@proxy.invalid',
    ARBITRARY_CONFIG: 'unknown-sensitive-value',
  };
  const env = restrictedAgentEnvironment({ OPENAI_API_KEY: 'agent-only' }, host, 'linux');
  assert.equal(env.PATH, host.PATH);
  assert.equal(env.HOME, host.HOME);
  assert.equal(env.LANG, host.LANG);
  assert.equal(env.OPENAI_API_KEY, 'agent-only');
  for (const key of Object.keys(host).filter(key => !['PATH', 'HOME', 'LANG', 'OPENAI_API_KEY'].includes(key))) {
    assert.equal(env[key], '', key);
  }
  // Simulate a vendored launcher that merges process.env back underneath its
  // explicit environment: the original values must still be absent.
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
    env: { ...host, ...env }, encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  const actual = JSON.parse(child.stdout);
  assert.equal(actual.OPENAI_API_KEY, 'agent-only');
  assert.equal(actual.GITHUB_TOKEN, '');
  assert.equal(actual.ARBITRARY_CONFIG, '');
  assert.equal(actual.DSH_DESKTOP_INSTALL_TOKEN, '');
});

test('Windows case-insensitive overrides do not retain inherited aliases', () => {
  const env = restrictedAgentEnvironment({ OPENAI_API_KEY: 'agent-only', PATH: 'agent-path' },
    { Path: 'host-path', openai_api_key: 'host-secret', Github_Token: 'other-secret' }, 'win32');
  assert.deepEqual(env, { PATH: 'agent-path', OPENAI_API_KEY: 'agent-only', Github_Token: '' });
});

test('runtime environment uses the same restriction while preserving explicit settings', () => {
  const old = process.env.ACP_TEST_UNRELATED_CREDENTIAL;
  process.env.ACP_TEST_UNRELATED_CREDENTIAL = 'host-only';
  try {
    const env = buildAgentRuntimeEnv({ env: { ACP_TEST_EXPLICIT_SETTING: 'agent-only' } });
    assert.equal(env.ACP_TEST_UNRELATED_CREDENTIAL, '');
    assert.equal(env.ACP_TEST_EXPLICIT_SETTING, 'agent-only');
  } finally {
    if (old === undefined) delete process.env.ACP_TEST_UNRELATED_CREDENTIAL;
    else process.env.ACP_TEST_UNRELATED_CREDENTIAL = old;
  }
});
