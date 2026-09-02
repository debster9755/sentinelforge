# Coding-agent specification — SentinelForge AI Gateway

## 0. Instruction to the coding agent

Implement this specification as the source of truth. Work one milestone from `PLAN.md` at a time. Before changing code, link the change to requirement IDs below. Do not add a cloud dependency, external key, autonomous permission, or raw-prompt telemetry unless the spec is amended. Stop a milestone if its exit tests fail.

Normative words `MUST`, `SHALL`, and `MUST NOT` are acceptance requirements.

## 1. System boundary

The system accepts model-style requests, authenticates identity, evaluates security and routing policy, optionally invokes one bounded model adapter, validates output, and records a sanitized trace. The policy engine—not an LLM—makes the final allow/deny/route/approval decision.

## 2. Required repository layout

```text
app/{api,auth,classifiers,policy,routing,providers,guards,telemetry,storage}/
app/datasets/{fetchers,importers,contracts,registry,quarantine,privacy,dedupe,labeling,splitting}/
policies/default.yaml
evals/{golden,adversarial,runner.py,thresholds.yaml}/
tests/{unit,contract,integration,security,performance}/
ui/                 # simple dashboard
docs/{architecture.md,threat-model.md,adr/}
data/{canonical_case.schema.json,source_manifest.example.yaml}
dataset_releases/   # generated; manifests/statistics only in git unless licence permits fixtures
docker-compose.yml  Makefile  pyproject.toml  .env.example
```

## 3. Functional requirements

| ID | Requirement |
|---|---|
| FR-001 | The API SHALL expose `POST /v1/decide`, `POST /v1/chat/completions`, `GET /v1/decisions/{id}`, `POST /v1/approvals/{id}`, `GET /healthz`, and `GET /metrics`. |
| FR-002 | Every non-health request MUST resolve `tenant_id`, `app_id`, `subject_id`, roles, and correlation ID from a signed local test token or API-key mapping. Missing/invalid identity returns 401. |
| FR-003 | Input classification SHALL return sensitivity, attack labels/scores, requested tools, estimated tokens, and an explanation code. It MUST combine deterministic rules with an optional classifier behind `RiskClassifier`. |
| FR-004 | `PolicyEngine.evaluate(context)` SHALL return exactly one typed decision: `DENY`, `ALLOW`, `REQUIRE_APPROVAL`, or `ALLOW_WITH_ROUTE_CONSTRAINTS`. No model-generated text may override it. |
| FR-005 | Policy SHALL support tenant/app, sensitivity, region, tool allowlist, maximum tokens, maximum calls, per-request budget, and minimum quality tier. Unknown tools/providers are denied. |
| FR-006 | `Router.rank(request, eligible_models)` SHALL return candidates with estimated cost, predicted latency, quality score, reason codes, and selected candidate. Tie-breaking MUST be deterministic. |
| FR-007 | The default providers SHALL be `FakeSmall`, `FakeStrong`, and optional `Ollama`. Provider adapters MUST implement the same timeout, usage, error, and cancellation contract. |
| FR-008 | Output guards SHALL validate declared JSON schema, scan for fixture secrets/PII, enforce maximum output size, and escape unsafe rich content. Failure returns a safe structured refusal/fallback. |
| FR-009 | Approval records MUST include decision ID, approver, scope, expiry, nonce/idempotency key, and outcome. Approval cannot widen the original request. |
| FR-010 | Every request SHALL emit one end-to-end trace and immutable logical audit event with identity metadata, policy/model versions, reason codes, token/cost estimates, timings, and outcome; content is off by default. |
| FR-011 | Policy simulation SHALL replay fixture or sanitized decision metadata against a candidate policy without invoking a paid/external model. |
| FR-012 | Evaluation SHALL compute attack recall, benign-block rate, quality pass, average/p95 overhead, cost/request, safe successes per dollar, and per-class confusion counts. |
| FR-013 | Every generated or imported evaluation row SHALL validate against `data/canonical_case.schema.json` before it can enter a dataset release. Rejected rows remain quarantined with reason codes. |
| FR-014 | `SourceManifest` SHALL require immutable revision, source URI, importer version, allowed uses, component-level licence records, content-risk class, target split, owner/review status and checksum policy. Sources are disabled by default. |
| FR-015 | Fetchers SHALL support pinned Git, public Hugging Face and local/offline sources. They MUST write only to an isolated quarantine directory, enforce size/type limits and MUST NOT execute source code or install dependencies. |
| FR-016 | Source-specific importers SHALL preserve original IDs/task labels and emit canonical drafts. They cannot call a model, modify policy, choose the final security decision or activate a release. |
| FR-017 | Policy-label enrichment SHALL deterministically add tenant/app/role, sensitivity, requested-tool constraints, expected decision, approval, route quality, latency and cost labels; human review is required for ambiguous/high-risk labels. |
| FR-018 | Split assignment SHALL group by source task, normalized attack template and near-duplicate cluster. Exact duplicates across splits are prohibited; external holdout cannot be read by training/tuning jobs. |
| FR-019 | Dataset release SHALL be immutable and include source/derived version, manifest and importer hashes, seed, case counts, distributions, rejected/quarantined counts, licence/attribution records, privacy results, review results and content Merkle/hash inventory. |
| FR-020 | Dataset activation SHALL require schema, provenance, licence, privacy, dedupe/leakage, label-completeness, coverage and evaluation gates plus an authorized human approval. Rollback changes only the active release pointer. |
| FR-021 | Evaluation SHALL report security and quality metrics by dataset source, channel, attack family, language, expected decision, sensitivity and role in addition to aggregate results. |
| FR-022 | Import/evaluation CI SHALL be network-disabled. Full public imports run only in an explicit manual/nightly job; core PR CI uses repository-authored or licence-approved normalized fixtures. |
| FR-023 | Runtime human approval SHALL be accepted only from an authorized approver and SHALL bind the immutable decision/request hash, tenant, subject, action/tool, normalized arguments, policy version, scope, expiry and nonce. Consume is transactional and one-time; reject, expiry, replay, self-approval where prohibited, or any binding mismatch fails closed. |
| FR-024 | Production policy activation SHALL require all automated schema/simulation/security/quality/performance gates plus an authenticated human `policy_approver` distinct from the `policy_author`. Local demo fixtures SHALL prove separation of duties. |
| FR-025 | New public-source enablement and dataset activation SHALL require recorded human licence/security review. Dataset release approval MUST be performed by an authorized identity that is not the importing service; human approval MUST NOT waive a failed automated gate. |

## 4. Data contracts

### Request envelope

```json
{
  "request_id": "req-001",
  "messages": [{"role": "user", "content": "Summarize the public policy"}],
  "requested_tools": [],
  "quality_floor": 0.75,
  "latency_slo_ms": 2000,
  "max_cost_usd": 0.01,
  "data_region": "local",
  "response_schema": null
}
```

Unknown fields SHALL be rejected at trust boundaries. Message count, per-message length, total bytes, and nesting SHALL have configured limits.

### Decision record

```json
{
  "decision_id": "dec-001",
  "request_id": "req-001",
  "outcome": "ALLOW",
  "reason_codes": ["PUBLIC_DATA", "LOW_RISK", "ROUTE_SMALL"],
  "selected_route": "fake-small",
  "policy_version": "1.0.0",
  "classifier_version": "rules-1",
  "estimated_cost_usd": 0.0002,
  "actual_cost_usd": 0.0,
  "gateway_latency_ms": 18,
  "content_logged": false
}
```

Tables: `tenants`, `applications`, `model_profiles`, `policy_versions`, `decisions`, `approvals`, `eval_runs`. Tenant-scoped tables MUST carry `tenant_id`; repository methods MUST require it.

### Human-approval contract

Approval is an authorization interrupt, not a policy override. `ApprovalRecord` MUST include `approval_id`, `decision_id`, immutable request hash, tenant/app/subject, normalized action/tool/arguments hash, policy version, requested scope, approver identity/role, outcome, reason, created/expiry/consumed timestamps, nonce and idempotency key. The approval endpoint MUST re-authenticate/re-authorize the approver, compare every binding with the pending decision, consume approval transactionally, emit an audit event and then resume only the original operation.

Automated `DENY`, failed release gates, expired decisions and changed requests are not approvable. Emergency deny and kill-switch actions require no approval. Approval payloads cannot directly select a provider, edit policy, alter a dataset split, change a budget or suppress output/audit controls.

### Evaluation-case and dataset-release contracts

The canonical row contract is normative in [`data/canonical_case.schema.json`](data/canonical_case.schema.json). Source-provided truth and SentinelForge policy truth MUST remain distinct:

- `source.*` records original dataset, immutable revision, original ID, component licence and content hash;
- `payload.*` records user messages, untrusted retrieved/tool/model content and requested tools;
- `policy_context.*` records synthetic or approved enterprise context;
- `labels.*` records case/attack type, expected decision/tool calls/quality tier and label method/review;
- `privacy.*` asserts that no released row contains real PII and records canary/redaction status.

`DatasetRelease` MUST contain `release_id`, schema version, parent release, source manifests, importer versions, created/approved identity and time, case IDs/hashes by split, distribution statistics, data-quality results, evaluation result, licence/attribution bundle and activation status.

### Dataset APIs and commands

Administrative endpoints (local admin role only):

- `POST /v1/datasets/sources/inspect` — read manifest and return pin/licence/risk plan; no fetch.
- `POST /v1/datasets/imports` — start explicit quarantined import; idempotency key required.
- `GET /v1/datasets/imports/{id}` — state, counts and rejection reasons; never raw hostile content by default.
- `POST /v1/datasets/releases` — build a candidate immutable release from approved imports.
- `GET /v1/datasets/releases/{id}` — manifest, data card and gate results.
- `POST /v1/datasets/releases/{id}/activate` — authorized activation only after every gate passes.
- `POST /v1/datasets/releases/{id}/rollback` — point to a previously passing release.

The equivalent CLI SHALL support `dataset inspect`, `dataset import`, `dataset validate`, `dataset release`, `dataset evaluate`, `dataset activate` and `dataset rollback`. Network access requires an explicit flag and is false by default.

### Import state machine

```text
PROPOSED → INSPECTED → FETCHED_QUARANTINED → NORMALIZED → SCANNED
→ DEDUPED → POLICY_LABELED → SPLIT → REVIEWED → CANDIDATE_RELEASE
→ EVALUATED → APPROVED → ACTIVE
```

Any state may transition to `REJECTED`; only transient failures may retry. `ACTIVE` is immutable. A new version creates a new release. Import jobs cannot call gateway providers or tools.

## 5. Routing algorithm

1. Remove models violating sensitivity, residency, capability, context, or health constraints.
2. Predict cost from versioned input/output token estimates and a price profile; local fake/Ollama cost is a configurable compute proxy.
3. Discard candidates below `quality_floor` or above hard budget/SLO where predictions exist.
4. Score remaining candidates:

```text
score = w_cost * normalized_cost
      + w_latency * normalized_latency
      + w_quality * max(0, quality_floor - predicted_quality)
```

5. Select lowest score; if empty, fail closed with `NO_COMPLIANT_ROUTE`.

The router MUST log reason codes, not hidden reasoning. The first MVP may use static quality/latency profiles learned from fixture replay.

## 6. Policy and agent boundary

A small LangGraph flow MAY generate policy-test suggestions or summarize evaluation failures. Its tools are read-only: `get_policy`, `get_eval_summary`, `list_failed_cases`. It cannot publish policies. Publishing requires deterministic schema validation, a signed user action, and evaluation thresholds. Maximum graph steps: 6; maximum model calls: 3; timeout: 30 seconds; no network tools.

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-001 | CI and the full deterministic evaluation MUST run with no external key/network dependency. |
| NFR-002 | Gateway p95 overhead SHALL be ≤120 ms for 1,000 sequential local fake-provider requests on the documented reference machine. |
| NFR-003 | All writes SHALL be idempotent by request or approval key. Timeouts/cancellations MUST release resources. |
| NFR-004 | Logs MUST be structured and free of fixture secrets. Trace context SHALL cross API, policy, provider, and guard spans. |
| NFR-005 | Unit coverage target ≥85% for policy/routing/guard modules; all branches for deny and approval paths must be tested. |
| NFR-006 | Dependency versions SHALL be locked; generated SBOM and license list SHALL be CI artifacts. |
| NFR-007 | Error responses MUST use stable codes and never expose stack traces, policy internals that aid evasion, or provider credentials. |
| NFR-008 | The same source manifests, importer versions and seed MUST reproduce the same normalized case IDs, split assignment and release hashes. |
| NFR-009 | Raw public content MUST be stored outside serving indexes and rendered only as escaped text to authorized reviewers; import has no gateway/provider/tool credentials. |
| NFR-010 | Dataset jobs MUST enforce download/file/uncompressed-size, row, field-length, nesting, runtime, memory and concurrency limits and reject unsupported archives/types. |
| NFR-011 | Licence/attribution metadata SHALL be queryable/exportable per source component and release. Unreviewed or incompatible sources cannot activate. |
| NFR-012 | Training/tuning processes MUST receive only explicitly allowed splits through a split-scoped registry API; filesystem path discovery is not an access-control mechanism. |

## 8. API error contract

```json
{
  "error": {
    "code": "POLICY_DENIED",
    "message": "Request cannot be processed under the active policy.",
    "decision_id": "dec-002",
    "retryable": false
  }
}
```

Use 400 invalid schema, 401 unauthenticated, 403 policy denial, 409 idempotency conflict, 413 size limit, 422 semantic validation, 429 quota/budget, 502 provider failure, 504 timeout.

## 9. Harness and test requirements

- **Golden:** benign routing and output-schema cases with deterministic expected outcomes.
- **Adversarial:** direct/indirect injection, secret extraction, tool escalation, encoded payload, oversized input, cross-tenant ID, and budget exhaustion.
- **Metamorphic:** appending irrelevant benign text must not change a security decision; case/spacing variants of seeded attacks should remain blocked.
- **Contract:** every provider gets identical request, timeout, usage, and error tests.
- **Replay:** each decision can be re-evaluated against a new policy without executing a model.
- **Failure injection:** provider timeout, malformed output, database unavailable, classifier unavailable, trace exporter unavailable.
- **Release thresholds:** taken from PRD; failure returns non-zero and uploads a machine-readable report.
- **Public-source contracts:** recorded tiny fixtures test Dolly/BIPIA row mapping and AgentDojo run-result mapping without a network fetch.
- **Dataset supply chain:** wrong checksum, moving revision, unsupported archive, path traversal, decompression bomb, malicious filename, source-code payload and licence failure remain quarantined.
- **Data quality:** schema/provenance/label completeness, exact and near-duplicate reports, group-aware split invariants, privacy/secret scan and deterministic rebuild.
- **Benchmark integrity:** training job cannot read external holdout; a near-duplicate injected across splits blocks release; results are segmented by source and family.

## 10. Security acceptance

Implement all controls and tests in `SECURITY.md`. Required hard assertions include cross-tenant denial, deny-by-default unknown tool/provider, no payload logging by default, approval authorization/scope/expiry/one-time consume, separation of policy author/approver and dataset importer/release approver, egress-disabled fake-provider CI, prompt injection unable to mutate policy, secrets scan clean, public content unable to execute during import, external holdout inaccessible to training, and a failing policy/dataset candidate unable to activate even with an approval attempt.

## 11. Done

The MVP is done only when a clean checkout can start locally, validate repository fixtures, import one public benign source and one public injection source from explicitly enabled pinned manifests, keep AgentDojo/BIPIA test or an equivalent suite isolated as external holdout, run the four seeded demos, produce a source/family-segmented benchmark, pass all gates without model keys, and build a sanitized static Pages bundle.
