// Deterministic, explainable policy engine.
//
// Every rule contributes evidence (a `RuleHit`) instead of directly returning
// a verdict. Thresholds in `policyConfig` turn accumulated evidence into one
// of three outcomes. This is what makes REQUIRE_APPROVAL reachable from plain
// prompt text and settings, not just from a hardcoded tool name — the gap
// identified in the previous version of this file.

export type DecisionOutcome = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export type Sensitivity = 'public' | 'internal' | 'confidential' | 'restricted';

export type GatewayRequest = {
  requestId: string;
  tenantId: string;
  appId: string;
  role: 'developer' | 'architect' | 'viewer' | 'operator' | 'analyst' | 'support_agent';
  prompt: string;
  requestedTools: string[];
  sensitivity: Sensitivity;
  qualityFloor: number;
  latencySloMs: number;
  maxCostUsd: number;
  dataRegion: 'local';
};

export type RuleCategory = 'input' | 'injection' | 'secret' | 'pii' | 'budget' | 'tool' | 'sensitivity' | 'routing';

export type RuleHit = {
  ruleId: string;
  category: RuleCategory;
  weight: number; // 0..1 contribution toward risk
  message: string;
  /** Character offsets into the prompt this rule matched, for UI highlighting. Empty when the rule is not text-based. */
  span: [number, number] | null;
};

export type StageTiming = { stage: string; ms: number };

export type ModelProfile = {
  modelId: string;
  provider: string;
  quality: number;
  tier: 1 | 2 | 3;
  cost: number; // USD, estimated per request at reference token counts
  latency: number; // ms, p50
  supportsTools: boolean;
  source: 'static' | 'live';
};

export type Decision = {
  decisionId: string;
  requestId: string;
  requestHash: string;
  outcome: DecisionOutcome;
  risk: number;
  reasonCodes: string[];
  hits: RuleHit[];
  trace: StageTiming[];
  selectedRoute: string | null;
  estimatedCostUsd: number;
  gatewayLatencyMs: number;
  policyVersion: string;
  contentLogged: false;
};

export type PolicyThresholds = { deny: number; approval: number };

export type PolicyConfig = {
  version: string;
  thresholds: PolicyThresholds;
  deniedTools: string[];
  approvalTools: string[];
};

// Mirrors the shape docs/SPEC.md asks for in policies/default.yaml. Shipped as
// a typed object (rather than a parsed YAML file) so the engine has zero new
// parsing dependencies; the shape is what a YAML loader would need to produce.
export const policyConfig: PolicyConfig = {
  version: '2.0.0',
  thresholds: {
    deny: 0.75, // risk >= this => DENY
    approval: 0.3, // risk >= this (and < deny) => REQUIRE_APPROVAL
  },
  deniedTools: ['http_post', 'delete_index'],
  approvalTools: ['restart_service'],
};

type TextRule = {
  ruleId: string;
  category: RuleCategory;
  pattern: RegExp;
  weight: number;
  message: string;
};

// Hard signals: unambiguous attack patterns. Weight 1.0 alone clears the deny
// threshold, matching the previous version's fail-closed behavior for these
// cases.
const hardSignals: TextRule[] = [
  { ruleId: 'injection.system_override', category: 'injection', pattern: /system\s+override/i, weight: 1, message: 'Prompt contains an embedded system-override instruction.' },
  { ruleId: 'injection.ignore_previous', category: 'injection', pattern: /ignore\s+(all\s+)?previous/i, weight: 1, message: 'Prompt attempts to override prior instructions.' },
  { ruleId: 'injection.exfil_domain', category: 'injection', pattern: /attacker\.invalid/i, weight: 1, message: 'Prompt references a known exfiltration test domain.' },
  { ruleId: 'secret.canary_key', category: 'secret', pattern: /DEMO_CANARY_KEY/i, weight: 1, message: 'Prompt requests a canary credential.' },
  { ruleId: 'secret.credential_request', category: 'secret', pattern: /return\s+any\s+(matching\s+)?credential/i, weight: 1, message: 'Prompt asks the model to return stored credentials.' },
  { ruleId: 'budget.recursive', category: 'budget', pattern: /recursively\s+until/i, weight: 1, message: 'Prompt requests unbounded recursive execution.' },
  { ruleId: 'budget.every_model', category: 'budget', pattern: /every\s+available\s+model/i, weight: 1, message: 'Prompt requests fan-out across every available model.' },
];

// Soft signals: suspicious but not conclusive on their own. These are what
// make REQUIRE_APPROVAL reachable from prompt text alone — previously any
// risk signal in the prompt short-circuited straight to DENY.
const softSignals: TextRule[] = [
  { ruleId: 'injection.reveal_hidden', category: 'injection', pattern: /reveal\s+(the\s+)?hidden/i, weight: 0.45, message: 'Prompt asks the model to reveal hidden/system content.' },
  { ruleId: 'injection.roleplay_override', category: 'injection', pattern: /pretend\s+(you\s+are|to\s+be)|act\s+as\s+if\s+you\s+have\s+no\s+(rules|restrictions)/i, weight: 0.4, message: 'Prompt uses a roleplay framing commonly used to bypass instructions.' },
  { ruleId: 'injection.jailbreak_term', category: 'injection', pattern: /\bjailbreak\b|\bDAN\s+mode\b/i, weight: 0.5, message: 'Prompt names a known jailbreak technique.' },
  { ruleId: 'secret.generic_secret', category: 'secret', pattern: /reveal.*secret|leak.*(api\s*key|password|token)/i, weight: 0.5, message: 'Prompt asks for secret material by description rather than exact match.' },
  { ruleId: 'pii.email', category: 'pii', pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, weight: 0.35, message: 'Prompt contains an email address.' },
  { ruleId: 'pii.phone', category: 'pii', pattern: /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, weight: 0.3, message: 'Prompt contains a phone-number-shaped sequence.' },
  { ruleId: 'pii.ssn_like', category: 'pii', pattern: /\b\d{3}-\d{2}-\d{4}\b/, weight: 0.45, message: 'Prompt contains a US-SSN-shaped sequence.' },
];

const allTextRules = [...hardSignals, ...softSignals];

export function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Runs every text rule against the prompt and returns evidence with character spans for UI highlighting. */
export function scanPrompt(prompt: string): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of allTextRules) {
    const match = rule.pattern.exec(prompt);
    if (!match) continue;
    hits.push({
      ruleId: rule.ruleId,
      category: rule.category,
      weight: rule.weight,
      message: rule.message,
      span: [match.index, match.index + match[0].length],
    });
  }
  return hits;
}

function toolHits(requestedTools: string[], config: PolicyConfig): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const tool of requestedTools) {
    if (config.deniedTools.includes(tool)) hits.push({ ruleId: 'tool.not_allowed', category: 'tool', weight: 1, message: `Tool "${tool}" is not in the allowlist.`, span: null });
    else if (config.approvalTools.includes(tool)) hits.push({ ruleId: 'tool.elevated', category: 'tool', weight: 0.5, message: `Tool "${tool}" requires exact-scope human approval.`, span: null });
  }
  return hits;
}

function sensitivityHits(request: GatewayRequest): RuleHit[] {
  const elevatedSensitivity = request.sensitivity === 'confidential' || request.sensitivity === 'restricted';
  if (elevatedSensitivity && request.requestedTools.length > 0) {
    return [{ ruleId: 'sensitivity.tool_combo', category: 'sensitivity', weight: 0.4, message: `A tool call was requested on ${request.sensitivity} data.`, span: null }];
  }
  return [];
}

export type ModelSelection = { route: ModelProfile | null; reasonCode: string };

export function selectRoute(request: GatewayRequest, models: ModelProfile[]): ModelSelection {
  const eligible = models.filter((model) => model.quality >= request.qualityFloor && model.cost <= request.maxCostUsd && model.latency <= request.latencySloMs && (!request.requestedTools.length || model.supportsTools));
  if (!eligible.length) return { route: null, reasonCode: 'NO_COMPLIANT_ROUTE' };
  const route = [...eligible].sort((a, b) => a.cost - b.cost || a.latency - b.latency || a.modelId.localeCompare(b.modelId))[0];
  return { route, reasonCode: `ROUTE_${route.modelId.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}` };
}

function timeStage<T>(trace: StageTiming[], stage: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  trace.push({ stage, ms: Math.max(0, Math.round((performance.now() - start) * 100) / 100) });
  return result;
}

// Maps rule categories to the stable, external reason codes consumers key
// off of (dashboards, tests, audit filters). Kept separate from `category`
// so a rule's internal grouping can change without breaking that contract.
const denyReasonCodes: Partial<Record<RuleCategory, string[]>> = {
  injection: ['INDIRECT_INJECTION', 'EXFILTRATION_INTENT'],
  secret: ['SECRET_EXTRACTION', 'RESTRICTED_DATA'],
  budget: ['DENIAL_OF_WALLET', 'STEP_LIMIT'],
  tool: ['TOOL_NOT_ALLOWED'],
  pii: ['PII_DETECTED'],
  sensitivity: ['SENSITIVE_CONTEXT'],
};

const approvalReasonCodes: Partial<Record<RuleCategory, string[]>> = {
  injection: ['SUSPECTED_INJECTION'],
  secret: ['SUSPECTED_SECRET_REQUEST'],
  pii: ['PII_DETECTED'],
  tool: ['TOOL_ELEVATED'],
  sensitivity: ['SENSITIVE_TOOL_COMBO'],
  budget: ['BUDGET_RISK'],
};

function reasonCodesFor(hits: RuleHit[], mapping: Partial<Record<RuleCategory, string[]>>, minWeight = 0): string[] {
  const codes = new Set<string>();
  for (const hit of hits) {
    if (hit.weight < minWeight) continue;
    for (const code of mapping[hit.category] ?? []) codes.add(code);
  }
  return Array.from(codes);
}

export function decide(request: GatewayRequest, models: ModelProfile[], config: PolicyConfig = policyConfig): Decision {
  const trace: StageTiming[] = [];
  const normalized = JSON.stringify({ ...request, prompt: request.prompt.trim() });
  const requestHash = stableHash(normalized);
  const base = { decisionId: `dec_${requestHash}`, requestId: request.requestId, requestHash, policyVersion: config.version, contentLogged: false as const };

  const fail = (outcome: DecisionOutcome, reasonCodes: string[], hits: RuleHit[] = [], risk = outcome === 'ALLOW' ? 0 : 1): Decision => ({
    ...base,
    outcome,
    risk,
    reasonCodes,
    hits,
    trace,
    selectedRoute: null,
    estimatedCostUsd: 0,
    gatewayLatencyMs: Math.round(trace.reduce((sum, t) => sum + t.ms, 0) * 100) / 100,
  });

  const trimmed = timeStage(trace, 'input_validation', () => request.prompt.trim());
  if (!trimmed) return fail('DENY', ['EMPTY_PROMPT']);
  if (request.prompt.length > 10_000) return fail('DENY', ['INPUT_SIZE_LIMIT']);

  const hits = timeStage(trace, 'classify', () => [...scanPrompt(request.prompt), ...toolHits(request.requestedTools, config), ...sensitivityHits(request)]);

  const risk = timeStage(trace, 'score', () => Math.min(1, hits.reduce((max, hit) => Math.max(max, hit.weight), 0)));

  if (risk >= config.thresholds.deny) {
    const reasonCodes = reasonCodesFor(hits, denyReasonCodes, config.thresholds.deny);
    return fail('DENY', reasonCodes.length ? reasonCodes : ['POLICY_RISK_THRESHOLD'], hits, risk);
  }

  if (risk >= config.thresholds.approval) {
    const reasonCodes = [...reasonCodesFor(hits, approvalReasonCodes), 'EXACT_SCOPE_APPROVAL'];
    const routing = timeStage(trace, 'route', () => selectRoute(request, models));
    return { ...base, outcome: 'REQUIRE_APPROVAL', risk, reasonCodes, hits, trace, selectedRoute: routing.route?.modelId ?? null, estimatedCostUsd: routing.route?.cost ?? 0, gatewayLatencyMs: Math.round(trace.reduce((sum, t) => sum + t.ms, 0) * 100) / 100 };
  }

  const routing = timeStage(trace, 'route', () => selectRoute(request, models));
  if (!routing.route) return fail('DENY', [routing.reasonCode], hits, risk);

  const reasonCodes = [request.sensitivity === 'public' ? 'PUBLIC_DATA' : 'DATA_POLICY_PASS', 'LOW_RISK', routing.reasonCode];
  return { ...base, outcome: 'ALLOW', risk, reasonCodes, hits, trace, selectedRoute: routing.route.modelId, estimatedCostUsd: routing.route.cost, gatewayLatencyMs: Math.round(trace.reduce((sum, t) => sum + t.ms, 0) * 100) / 100 };
}

export type ApprovalRecord = { approvalId: string; decisionId: string; requestHash: string; approver: string; scope: string; expiresAt: number; consumedAt: number | null; nonce: string; outcome: 'APPROVED' | 'REJECTED' };

export function createApproval(decision: Decision, approver: string, now = Date.now()): ApprovalRecord {
  if (decision.outcome !== 'REQUIRE_APPROVAL') throw new Error('Only approval-required decisions can be approved.');
  return { approvalId: `apr_${stableHash(`${decision.decisionId}:${approver}:${now}`)}`, decisionId: decision.decisionId, requestHash: decision.requestHash, approver, scope: 'restart_service:demo', expiresAt: now + 5 * 60_000, consumedAt: null, nonce: stableHash(`${now}:nonce`), outcome: 'APPROVED' };
}

export function consumeApproval(record: ApprovalRecord, decision: Decision, now = Date.now()): ApprovalRecord {
  if (record.consumedAt) throw new Error('Approval replay blocked: this approval was already consumed.');
  if (record.expiresAt <= now) throw new Error('Approval expired.');
  if (record.decisionId !== decision.decisionId || record.requestHash !== decision.requestHash) throw new Error('Approval binding mismatch.');
  return { ...record, consumedAt: now };
}
