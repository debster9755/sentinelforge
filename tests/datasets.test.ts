import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import registry from '../data/public-datasets.json' with { type: 'json' };
import { normalizeAgentDojo, normalizeBipia, normalizeDolly, validateCanonicalCase } from '../scripts/dataset-lib.mjs';

const source = (id: string) => registry.sources.find((item) => item.id === id)!;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('registry exposes every public source from the product guide and keeps them disabled', () => {
  assert.equal(registry.default_enabled, false);
  assert.deepEqual(registry.sources.map((item) => item.id), ['databricks-dolly-15k', 'microsoft-bipia', 'ethz-agentdojo', 'tensor-trust', 'purple-llama-cyberseceval', 'jailbreakbench']);
});

test('Dolly importer produces deterministic canonical benign cases', () => {
  const first = normalizeDolly(fixture('dolly.jsonl'), source('databricks-dolly-15k'), 2);
  const second = normalizeDolly(fixture('dolly.jsonl'), source('databricks-dolly-15k'), 2);
  assert.equal(first.length, 2);
  assert.deepEqual(first, second);
  assert.equal(first[0].labels.expected_decision, 'ALLOW');
  assert.equal(first[0].split, 'train');
});

test('BIPIA importer redacts identifiers and isolates cases in external holdout', () => {
  const cases = normalizeBipia(fixture('bipia-context.jsonl'), fixture('bipia-attacks.json'), source('microsoft-bipia'), 1);
  assert.equal(cases[0].split, 'external_holdout');
  assert.equal(cases[0].labels.expected_decision, 'DENY');
  assert.match(cases[0].payload.untrusted_content, /\[REDACTED_EMAIL\]/);
  assert.match(cases[0].payload.untrusted_content, /\[REDACTED_NUMBER\]/);
  assert.doesNotMatch(cases[0].payload.untrusted_content, /demo\.user|4111 1111|David|Ganesha Dirschka/);
  assert.equal(cases[0].privacy.contains_real_pii, false);
  assert.equal(validateCanonicalCase(cases[0]), true);
});

test('AgentDojo adapter consumes recorded results without executing a benchmark', () => {
  const cases = normalizeAgentDojo(fixture('agentdojo-results.jsonl'), source('ethz-agentdojo'), 10);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].source.revision, 'v0.1.35');
  assert.ok(cases[0].labels.attack_families.includes('agent_tool_injection'));
});

test('CLI refuses network imports unless explicitly enabled', () => {
  const result = spawnSync(process.execPath, ['scripts/dataset-cli.mjs', 'import', 'databricks-dolly-15k', '--accept-license'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Network access is disabled by default/);
});

test('manifest-only sources cannot be imported before review', () => {
  const result = spawnSync(process.execPath, ['scripts/dataset-cli.mjs', 'import', 'tensor-trust', '--network', '--accept-license'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /manifest-only/);
});
