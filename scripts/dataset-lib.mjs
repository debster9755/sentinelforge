import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function redact(text) {
  let value = String(text ?? '');
  const names = new Set();
  for (const pattern of [/\b(?:Hi|Hey there|Dear)\s+([A-Z][a-z]{2,})\b/g, /\b(?:paid by|paid to)\s+([A-Z][a-z]{2,})\b/gi, /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)'s\b/g]) {
    for (const match of value.matchAll(pattern)) names.add(match[1]);
  }
  value = value
    .replace(/EMAIL_FROM:[^|\n]+/gi, 'EMAIL_FROM:[REDACTED_SENDER]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g, '[REDACTED_NUMBER]')
    .replace(/[•*]{2}\d{4}/g, '[REDACTED_ACCOUNT]')
    .replace(/\b\d{1,5}\s+[A-Za-z0-9 .'-]+\s(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?)\b[^|\n]*\b\d{5}(?:-\d{4})?\b/gi, '[REDACTED_ADDRESS]')
    .replace(/\b[A-Z][a-z]+\s+[A-Z][a-z]+'s\s+(?=(?:debit|credit|account))/g, '[REDACTED_NAME] ')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED_SECRET]');
  for (const name of [...names].sort((a, b) => b.length - a.length)) value = value.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '[REDACTED_NAME]');
  return value;
}

export function canonicalCase({ id, source, originalId, content, untrustedContent = null, split, caseType, attackFamilies, expectedDecision, tier, license }) {
  const safeContent = redact(content).slice(0, 100000);
  const safeUntrusted = untrustedContent == null ? null : redact(untrustedContent).slice(0, 500000);
  const contentHash = sha256(JSON.stringify({ safeContent, safeUntrusted }));
  return {
    schema_version: '1.0.0', case_id: id,
    source: { dataset: source.id, revision: source.revision, original_id: String(originalId), license_id: license ?? source.license, content_sha256: contentHash },
    split, channel: safeUntrusted ? 'retrieved_content' : 'user_prompt',
    payload: { messages: [{ role: 'user', content: safeContent }], untrusted_content: safeUntrusted, requested_tools: [] },
    policy_context: { tenant_id: 'public-eval-tenant', app_id: 'dataset-evaluation', subject_id: 'dataset-importer', roles: ['security_evaluator'], sensitivity: 'internal', region: 'local', quality_floor: 0.8, latency_slo_ms: 2000, max_cost_usd: 0.01 },
    labels: { case_type: caseType, attack_families: attackFamilies, expected_decision: expectedDecision, expected_tool_calls: [], minimum_quality_tier: tier, label_method: 'policy_template', review_status: 'pending' },
    privacy: { contains_real_pii: false, contains_canary: false, redaction_status: safeContent !== content || safeUntrusted !== untrustedContent ? 'redacted' : 'not_required' }
  };
}

export function normalizeDolly(raw, source, limit = 200) {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean).slice(0, limit);
  return lines.map((line, index) => {
    const row = JSON.parse(line);
    const content = [row.instruction, row.context].filter(Boolean).join('\n\nContext:\n');
    return canonicalCase({ id: `dolly-${String(index).padStart(6, '0')}-${sha256(content).slice(0, 10)}`, source, originalId: index, content, split: 'train', caseType: 'benign', attackFamilies: [], expectedDecision: 'ALLOW', tier: row.category === 'creative_writing' ? 2 : 1 });
  });
}

export function normalizeBipia(contextRaw, attacksRaw, source, limit = 200) {
  const contexts = contextRaw.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const attackGroups = JSON.parse(attacksRaw);
  const attacks = Object.entries(attackGroups).flatMap(([family, values]) => values.map((value) => ({ family, value })));
  const count = Math.min(limit, contexts.length * attacks.length);
  return Array.from({ length: count }, (_, index) => {
    const context = contexts[index % contexts.length];
    const attack = attacks[index % attacks.length];
    const prompt = context.question || 'Answer the question using the imported document.';
    const untrusted = `${context.context}\n\n[UNTRUSTED_INSTRUCTION]\n${attack.value}`;
    return canonicalCase({ id: `bipia-email-test-${String(index).padStart(6, '0')}-${sha256(untrusted).slice(0, 10)}`, source, originalId: `email-test-${index}`, content: prompt, untrustedContent: untrusted, split: 'external_holdout', caseType: 'attack', attackFamilies: ['indirect_prompt_injection', String(attack.family).toLowerCase().replace(/[^a-z0-9]+/g, '_')], expectedDecision: 'DENY', tier: 2 });
  });
}

export function normalizeAgentDojo(raw, source, limit = 200) {
  const parsed = raw.trim().startsWith('[') ? JSON.parse(raw) : raw.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return parsed.slice(0, limit).map((row, index) => {
    const suite = row.suite ?? row.suite_name ?? 'unknown-suite';
    const task = row.user_task ?? row.user_task_id ?? row.task_id ?? index;
    const injected = row.injection_task ?? row.injection_task_id ?? row.attack ?? null;
    const securityPassed = row.security ?? row.security_passed ?? row.attack_success === false;
    return canonicalCase({ id: `agentdojo-${sha256(`${suite}:${task}:${injected ?? 'clean'}`).slice(0, 16)}`, source, originalId: `${suite}:${task}`, content: `Replay recorded AgentDojo task ${task} from suite ${suite}.`, untrustedContent: injected ? `Recorded injection task: ${String(injected)}` : null, split: 'external_holdout', caseType: injected ? 'attack' : 'benign', attackFamilies: injected ? ['agent_tool_injection'] : [], expectedDecision: securityPassed ? 'DENY' : 'REQUIRE_APPROVAL', tier: 2 });
  });
}

export async function fetchArtifact(artifact, destination) {
  const response = await fetch(artifact.url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Fetch failed with HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared && declared > artifact.max_bytes) throw new Error(`Artifact exceeds ${artifact.max_bytes} bytes`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > artifact.max_bytes) throw new Error(`Artifact exceeds ${artifact.max_bytes} bytes`);
  const actual = sha256(bytes);
  if (actual !== artifact.sha256) throw new Error(`Checksum mismatch for ${artifact.name}: expected ${artifact.sha256}, got ${actual}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
  return { bytes, sha256: actual };
}

export async function writeRelease(root, source, cases, importedArtifacts) {
  for (const item of cases) validateCanonicalCase(item);
  if (new Set(cases.map((item) => item.case_id)).size !== cases.length) throw new Error('Duplicate case IDs block release creation');
  const contentHash = sha256(cases.map((item) => JSON.stringify(item)).join('\n'));
  const releaseId = `${source.id}-${source.revision.slice(0, 12)}-${contentHash.slice(0, 12)}`;
  const releaseDir = path.join(root, 'dataset_releases', releaseId);
  const split = source.lane === 'external_holdout' ? 'external_holdout' : 'train';
  await mkdir(path.join(releaseDir, 'cases'), { recursive: true });
  await writeFile(path.join(releaseDir, 'cases', `${split}.jsonl`), `${cases.map((item) => JSON.stringify(item)).join('\n')}\n`, { flag: 'wx' });
  const redacted = cases.filter((item) => item.privacy.redaction_status === 'redacted').length;
  const manifest = { release_id: releaseId, schema_version: '1.0.0', source_id: source.id, source_revision: source.revision, created_at: new Date().toISOString(), status: 'IMPORTED_PENDING_REVIEW', activation_allowed: false, case_count: cases.length, split, content_sha256: contentHash, artifacts: importedArtifacts, privacy: { redacted_cases: redacted, contains_real_pii: false }, gates: { schema: 'PASS', provenance: 'PASS', checksum: 'PASS', privacy: redacted ? 'PASS_WITH_REDACTION' : 'PASS', licence_review: 'PENDING_HUMAN', stratified_review: 'PENDING_HUMAN', activation: 'BLOCKED' } };
  await writeFile(path.join(releaseDir, 'release_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { releaseDir, manifest };
}

export async function readRegistry(root) {
  return JSON.parse(await readFile(path.join(root, 'data', 'public-datasets.json'), 'utf8'));
}

export function validateCanonicalCase(item) {
  if (item.schema_version !== '1.0.0') throw new Error('Unsupported canonical schema version');
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(item.case_id)) throw new Error(`Invalid case ID: ${item.case_id}`);
  if (!/^[a-f0-9]{64}$/.test(item.source?.content_sha256 ?? '')) throw new Error(`Invalid content hash for ${item.case_id}`);
  if (!['train', 'validation', 'test', 'external_holdout', 'security_private'].includes(item.split)) throw new Error(`Invalid split for ${item.case_id}`);
  if (!['ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'ALLOW_WITH_ROUTE_CONSTRAINTS'].includes(item.labels?.expected_decision)) throw new Error(`Invalid decision for ${item.case_id}`);
  if (item.privacy?.contains_real_pii !== false) throw new Error(`Privacy gate failed for ${item.case_id}`);
  if (!Array.isArray(item.payload?.messages) || item.payload.messages.length === 0) throw new Error(`Messages required for ${item.case_id}`);
  return true;
}
