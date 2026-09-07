import assert from 'node:assert/strict';
import test from 'node:test';
import { modelToProfile, staticModelProfiles, type ProviderConfig } from '../lib/providers.ts';

const ollama: ProviderConfig = { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1' };

test('qwen3:4b takes over the fake-small tier: same quality, zero cost', () => {
  const profile = modelToProfile(ollama, 'qwen3:4b');
  const fakeSmall = staticModelProfiles().find((m) => m.modelId === 'fake-small')!;
  assert.equal(profile.tier, 1);
  assert.equal(profile.quality, fakeSmall.quality);
  assert.equal(profile.cost, 0);
  assert.ok(profile.cost < fakeSmall.cost, 'a live model must win the cost tie-break against its static equivalent');
});

test('qwen3:8b takes over the fake-medium tier', () => {
  const profile = modelToProfile(ollama, 'qwen3:8b');
  const fakeMedium = staticModelProfiles().find((m) => m.modelId === 'fake-medium')!;
  assert.equal(profile.tier, 2);
  assert.equal(profile.quality, fakeMedium.quality);
  assert.equal(profile.cost, 0);
});

test('qwen3:14b takes over the fake-strong tier', () => {
  const profile = modelToProfile(ollama, 'qwen3:14b');
  const fakeStrong = staticModelProfiles().find((m) => m.modelId === 'fake-strong')!;
  assert.equal(profile.tier, 3);
  assert.equal(profile.quality, fakeStrong.quality);
  assert.equal(profile.cost, 0);
});

test('an unrecognized live model falls back to the size-based heuristic, not a Qwen3 default', () => {
  const profile = modelToProfile(ollama, 'llama3.1:70b');
  assert.equal(profile.tier, 3); // 70b params -> heuristic tier 3
  assert.equal(profile.source, 'live');
});

test('SENTINEL_MODEL_HINTS overrides a built-in Qwen3 default', () => {
  process.env.SENTINEL_MODEL_HINTS = JSON.stringify({ 'qwen3:8b': { tier: 3, quality: 0.99 } });
  try {
    const profile = modelToProfile(ollama, 'qwen3:8b');
    assert.equal(profile.tier, 3);
    assert.equal(profile.quality, 0.99);
  } finally {
    delete process.env.SENTINEL_MODEL_HINTS;
  }
});

test('the three installed Qwen3 tags are quality-ordered so routing always picks the smallest sufficient model', () => {
  const small = modelToProfile(ollama, 'qwen3:4b');
  const medium = modelToProfile(ollama, 'qwen3:8b');
  const strong = modelToProfile(ollama, 'qwen3:14b');
  assert.ok(small.quality < medium.quality && medium.quality < strong.quality);
  assert.ok(small.latency < medium.latency && medium.latency < strong.latency);
});
