import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_AGENT_PRESETS,
  groupAntigravityModels,
  normalizeAgentRecord,
  resolveAntigravityGroupedSelection,
  splitAntigravityModelId,
} from '../lib/presets.js';

const PER_EFFORT_MODELS = [
  { id: 'gemini-4-argon-high', name: 'Gemini 4 Argon (High)', defaultEffort: 'high' },
  { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)', defaultEffort: 'medium' },
  { id: 'gemini-4-argon-low', name: 'Gemini 4 Argon (Low)', defaultEffort: 'low' },
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)', defaultEffort: 'high' },
  {
    id: 'gemini-4-neon-low',
    name: 'Gemini 4 Neon (Low)',
    options: [{ id: 'mode', type: 'select', options: [{ id: 'default', name: 'Default' }] }],
    inputModalities: ['text', 'image'],
    discovered: true,
  },
  { id: 'gemini-4-neon-high', name: 'Gemini 4 Neon (High)', discovered: true },
];

test('groupAntigravityModels folds per-effort ids into one row per base model', () => {
  const grouped = groupAntigravityModels(PER_EFFORT_MODELS);
  const argon = grouped.find((m) => m.id === 'gemini-4-argon');
  assert.ok(argon, 'argon group exists');
  assert.equal(argon.name, 'Gemini 4 Argon');
  assert.equal(argon.defaultEffort, 'high');
  assert.deepEqual(argon.efforts.map((e) => e.id), ['low', 'medium', 'high']);
  const neon = grouped.find((m) => m.id === 'gemini-4-neon');
  assert.ok(neon, 'neon group exists');
  assert.equal(neon.name, 'Gemini 4 Neon');
  assert.deepEqual(neon.efforts.map((e) => e.id), ['low', 'high']);
  assert.equal(neon.discovered, true, 'discovered flag survives grouping');
  // The preferred member's session options carry over.
  assert.deepEqual(neon.options, PER_EFFORT_MODELS[4].options);
  assert.deepEqual(neon.inputModalities, ['text', 'image']);
  // Non-variant ids pass through untouched.
  assert.deepEqual(grouped.filter((m) => m.id === 'default'), []);
  assert.equal(grouped.some((m) => !m.efforts), false);
});

test('groupAntigravityModels is idempotent and passes unknown ids through', () => {
  const once = groupAntigravityModels(PER_EFFORT_MODELS);
  const twice = groupAntigravityModels(once);
  assert.deepEqual(twice, once);
  const odd = groupAntigravityModels([{ id: 'default', name: 'Default' }, { id: 'some-agent-model', name: 'Other' }]);
  assert.deepEqual(odd, [{ id: 'default', name: 'Default' }, { id: 'some-agent-model', name: 'Other' }]);
  assert.deepEqual(groupAntigravityModels([]), []);
  assert.deepEqual(groupAntigravityModels(undefined), []);
});

test('splitAntigravityModelId recognizes the advertised effort suffixes', () => {
  assert.deepEqual(splitAntigravityModelId('gemini-4-argon-high'), { base: 'gemini-4-argon', effort: 'high' });
  assert.deepEqual(splitAntigravityModelId('gemini-4-neon-xhigh'), { base: 'gemini-4-neon', effort: 'xhigh' });
  assert.equal(splitAntigravityModelId('gemini-4-argon'), null);
  assert.equal(splitAntigravityModelId('opencode/beam-free'), null);
});

test('resolveAntigravityGroupedSelection folds base+effort onto the advertised id', () => {
  const known = new Set(['gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high']);
  const models = [{ id: 'gemini-4-argon', defaultEffort: 'high' }];
  assert.deepEqual(
    resolveAntigravityGroupedSelection({ modelId: 'gemini-4-argon', effort: 'medium', known, models }),
    { modelId: 'gemini-4-argon-medium', effort: 'medium' },
  );
  // No explicit effort: the grouped entry's default effort wins.
  assert.deepEqual(
    resolveAntigravityGroupedSelection({ modelId: 'gemini-4-argon', known, models }),
    { modelId: 'gemini-4-argon-high', effort: 'high' },
  );
  // Default effort falls back to the best advertised variant without an entry.
  assert.deepEqual(
    resolveAntigravityGroupedSelection({ modelId: 'gemini-4-argon', known, models: [] }),
    { modelId: 'gemini-4-argon-high', effort: 'high' },
  );
  // A real id folds its own effort so the generic effort check never throws.
  assert.deepEqual(
    resolveAntigravityGroupedSelection({ modelId: 'gemini-4-argon-high', known, models }),
    { modelId: 'gemini-4-argon-high', effort: 'high' },
  );
  // An explicit different effort switches variants.
  assert.deepEqual(
    resolveAntigravityGroupedSelection({ modelId: 'gemini-4-argon-high', effort: 'low', known, models }),
    { modelId: 'gemini-4-argon-low', effort: 'low' },
  );
  // An effort the account does not offer keeps the requested id so the
  // session layer can fail with a precise message instead of a silent change.
  assert.deepEqual(
    resolveAntigravityGroupedSelection({ modelId: 'gemini-4-argon-high', effort: 'xhigh', known, models }),
    { modelId: 'gemini-4-argon-high', effort: 'high' },
  );
  // No fold when the base id itself is advertised.
  assert.equal(resolveAntigravityGroupedSelection({ modelId: 'gemini-4-argon', known: new Set(['gemini-4-argon']), models: [] }), null);
  assert.equal(resolveAntigravityGroupedSelection({ modelId: 'gemini-4-argon', known: new Set(), models: [] }), null);
  // Unknown base ids leave the failure to ACP-side validation.
  assert.equal(
    resolveAntigravityGroupedSelection({ modelId: 'gemini-9-ghost', known, models: [] }),
    null,
  );
});

test('normalizeAgentRecord migrates stored antigravity records to grouped ids', () => {
  const preset = BUILTIN_AGENT_PRESETS.find((p) => p.id === 'antigravity');
  const record = normalizeAgentRecord(
    {
      id: 'antigravity',
      enabled: true,
      models: PER_EFFORT_MODELS,
      favoriteModels: ['gemini-4-argon-high', 'gemini-3.8-flash-high'],
      hiddenModels: ['gemini-4-neon-low'],
    },
    preset,
  );
  const ids = record.models.map((m) => m.id);
  assert.deepEqual(ids, ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-4-neon']);
  assert.deepEqual(record.favoriteModels, ['gemini-4-argon', 'gemini-3.8-flash']);
  assert.deepEqual(record.hiddenModels, ['gemini-4-neon']);
  // Grouped entries keep a default effort the composer can preselect.
  for (const model of record.models) assert.ok(model.defaultEffort);
});

test('non-antigravity agents are not grouped', () => {
  const preset = BUILTIN_AGENT_PRESETS.find((p) => p.id === 'codex');
  const record = normalizeAgentRecord(
    {
      id: 'codex',
      models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', defaultEffort: 'high' }],
    },
    preset,
  );
  assert.deepEqual(record.models.map((m) => m.id), ['gpt-6.1-sol']);
});
