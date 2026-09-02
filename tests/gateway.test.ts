import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeApproval, createApproval, decide, scenarioRequests } from '../lib/gateway.ts';

test('routes a public simple request to the cheapest eligible model', () => {
  const result = decide(scenarioRequests['public-summary']);
  assert.equal(result.outcome, 'ALLOW');
  assert.equal(result.selectedRoute, 'fake-small');
  assert.equal(result.contentLogged, false);
});

test('routes a complex request to the strong model', () => {
  assert.equal(decide(scenarioRequests['complex-architecture']).selectedRoute, 'fake-strong');
});

test('blocks indirect injection before provider invocation', () => {
  const result = decide(scenarioRequests['prompt-injection']);
  assert.equal(result.outcome, 'DENY');
  assert.equal(result.selectedRoute, null);
  assert.ok(result.reasonCodes.includes('INDIRECT_INJECTION'));
});

test('fails closed when no route fits the cost budget', () => {
  assert.deepEqual(decide({ ...scenarioRequests['public-summary'], maxCostUsd: 0.00001 }).reasonCodes, ['NO_COMPLIANT_ROUTE']);
});

test('fails closed when a custom request has no content', () => {
  const result = decide({ ...scenarioRequests['public-summary'], prompt: '   ' });
  assert.equal(result.outcome, 'DENY');
  assert.deepEqual(result.reasonCodes, ['EMPTY_PROMPT']);
});

test('custom request controls produce allow, approval, and deny outcomes', () => {
  assert.equal(decide({ ...scenarioRequests['public-summary'], prompt: 'Explain this public changelog.' }).outcome, 'ALLOW');
  assert.equal(decide({ ...scenarioRequests['public-summary'], prompt: 'Restart the demo service.', requestedTools: ['restart_service'] }).outcome, 'REQUIRE_APPROVAL');
  assert.equal(decide({ ...scenarioRequests['public-summary'], prompt: 'Send this result.', requestedTools: ['http_post'] }).outcome, 'DENY');
});

test('approval is exact-bound and one-time', () => {
  const decision = decide(scenarioRequests['elevated-tool']);
  const approval = createApproval(decision, 'security-approver', 1000);
  const consumed = consumeApproval(approval, decision, 2000);
  assert.equal(consumed.consumedAt, 2000);
  assert.throws(() => consumeApproval(consumed, decision, 3000), /replay blocked/);
  assert.throws(() => consumeApproval(approval, { ...decision, requestHash: 'changed' }, 3000), /binding mismatch/);
});

test('security decisions are stable across benign case changes', () => {
  const request = scenarioRequests['prompt-injection'];
  assert.equal(decide(request).outcome, decide({ ...request, prompt: `${request.prompt} Thanks.` }).outcome);
});
