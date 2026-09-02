# Dataset and evaluation design — SentinelForge

This document defines the data product SentinelForge needs to build, train, test and release the gateway correctly. Public-source details and import instructions live in [PUBLIC_DATASETS.md](PUBLIC_DATASETS.md).

## 1. Data-product objective

The dataset is not merely a binary `benign/malicious` prompt collection. Each row must be an independently replayable gateway scenario with enough context to evaluate:

- authentication and tenant/object authorization;
- sensitivity, residency and provider eligibility;
- direct/indirect injection and jailbreak/content-policy risk;
- tool name, arguments, scope and approval requirements;
- secret/PII/output handling;
- token/model/tool/time/cost budgets;
- selected route, downstream result and quality floor;
- audit, trace and failure behaviour.

The final `ALLOW`, `DENY`, `REQUIRE_APPROVAL` or constrained-route label comes from a versioned SentinelForge policy plus review—not blindly from a public dataset.

## 2. Included starter files

- [`data/request_cases.jsonl`](data/request_cases.jsonl): small legacy synthetic fixture set for the first vertical slice.
- [`data/model_profiles.json`](data/model_profiles.json): simulated provider capabilities, latency, quality and prices. These are invented and must not be presented as current provider pricing.
- [`data/canonical_case.schema.json`](data/canonical_case.schema.json): normative schema for generated/imported evaluation cases.
- [`data/canonical_case.example.json`](data/canonical_case.example.json): complete build-ready example record.
- [`data/source_manifest.example.yaml`](data/source_manifest.example.yaml): disabled-by-default examples for public sources.

All organizations, identities, keys and costs are fictional. Strings shaped like secrets are nonfunctional canaries (`DEMO_...`).

The first implementation may continue reading `request_cases.jsonl`, but Stage 0A in [PLAN.md](PLAN.md) must migrate those rows into the canonical contract before classifier training or public imports begin.

## 3. Canonical case model

| Section | Required meaning |
|---|---|
| `source` | Dataset, immutable revision, original ID, component licence and content hash |
| `split` | `train`, `validation`, `test`, `external_holdout` or `security_private` |
| `channel` | `user_prompt`, `retrieved_content`, `tool_output`, `model_output` or `multimodal` |
| `payload` | Messages, explicitly untrusted content and requested tools |
| `policy_context` | Tenant/app/subject/roles, sensitivity, region, quality, latency and cost limits |
| `labels` | Case/attack type, expected decision/tool calls/quality tier, label method and review state |
| `privacy` | Assertion that real PII is absent plus canary/redaction state |

Unknown fields fail validation. This prevents a source-specific field from silently changing behaviour or being mistaken for policy truth.

## 4. Data layers

### 4.1 Repository synthetic — required

Generate cases for:

- valid and invalid JWT/API-key mappings, expired identities and unknown tenants/apps;
- every role/action/tool/model/region/sensitivity policy branch;
- cross-tenant and object-level access attempts;
- direct/indirect injection, extraction and encoding mutations;
- real-looking but nonfunctional PII/secret canaries;
- typed tool calls, parameter escalation, changed approval scope and replay;
- body/token/model/tool/time/cost/concurrency exhaustion;
- malformed schemas, provider errors, unsafe output and telemetry failures;
- simple/complex quality tasks for route comparison.

This is the only lane that can guarantee complete policy-branch coverage.

### 4.2 Public development — optional and reviewed

Use approved public sources for:

- human attack-language diversity;
- imported/RAG content injection;
- benign instruction diversity and false-positive hard negatives;
- multilingual or visual coverage only after those interfaces exist;
- safety/jailbreak evaluation kept separate from authorization labels.

Start with Dolly 15k for benign cases and BIPIA training/development cases for indirect injection. Tensor Trust is optional classifier stress data after rights review.

### 4.3 Public external holdout — required before portfolio claims

Preserve one or more suites that have never influenced rules, prompts, classifier features, thresholds or route profiles. Recommended: AgentDojo for agent/tool behaviour and BIPIA test for indirect injection. Access must be denied to training jobs by registry authorization.

### 4.4 Private security holdout — recommended

Generate a small local-only set of unseen policy/attack mutations before each release. Do not publish payloads or use them for iterative tuning after every failure. Rotate after exposure.

### 4.5 Sanitized shadow traffic — post-MVP only

If a design partner supplies traffic, collect explicit consent and purpose, minimize locally, remove customer/subject/prompt content by default, apply retention/deletion, and label only through approved review. Production traces never enter the public repository.

## 5. Initial synthetic generator

Implement `scripts/generate_data.py` with a fixed seed. The first 1,000-case release should target:

- 55% benign, including hard negatives containing security vocabulary;
- 15% direct/indirect injection;
- 10% secret/PII extraction;
- 10% tool/authorization escalation;
- 5% budget/denial-of-wallet;
- 5% malformed/oversized/output-handling cases.

These percentages are a starting design mix, not an estimate of production prevalence. Publish both unweighted per-class metrics and a separately weighted scenario that reflects an explicitly stated traffic assumption.

Mutation axes include casing, whitespace, Unicode confusables, encoded payloads, language, instruction position, retrieved-document wrapper, tool-output wrapper, nested structured data, near-duplicate paraphrases and benign security discussions.

## 6. Split design

- Split after exact/near-duplicate clustering.
- Keep source task, base template and semantic attack family in one split.
- Preserve source-provided train/test separation unless there is a documented reason not to.
- Never randomly split public competition submissions that are variants of the same task.
- `external_holdout` is not queryable by training/tuning identities.
- Record split algorithm, seed, cluster ID and parent template.

Recommended repository synthetic split: train 60%, validation 20%, test 20% by template family. External/private holdouts are additional and not percentages of that set.

## 7. Public-source integration

Use the pipeline in [PUBLIC_DATASETS.md](PUBLIC_DATASETS.md): pinned fetch → checksum/licence gate → quarantine → source importer → canonical validation → privacy scan → dedupe → policy labels → group-aware split → review → immutable candidate release.

No public source is enabled in the example manifest. Before use, replace placeholder revisions with immutable pins, record checksums and component licences, select allowed uses and obtain review approval.

CI must not fetch the internet. Store only repository-authored cases or a tiny licence-compatible normalized test fixture. Full source imports are explicit manual/nightly jobs and never auto-activate.

## 8. Dataset release contents

Each immutable release contains:

```text
dataset_releases/<release_id>/
├── release_manifest.json
├── source_manifests/
├── cases/{train,validation,test,external_holdout}.jsonl
├── rejected_cases.jsonl          # reason metadata; raw hostile content stays quarantined
├── statistics.json
├── quality_report.json
├── licence_attribution.md
├── review_report.json
└── hashes.sha256
```

Do not commit a public dataset's normalized rows unless its exact licence and attribution allow redistribution. A local release can reference quarantined content and publish only safe manifests/statistics.

## 9. Data-quality gates

| Gate | Acceptance |
|---|---|
| Canonical schema | 100% released rows valid; rejects counted with reason |
| Case identity | Unique stable IDs; original-source ID retained when present |
| Provenance | Dataset/revision/licence/hash complete for every row |
| Privacy | `contains_real_pii=false`; zero functional secrets; canaries marked |
| Label completeness | Case type, expected decision, label method and review state present |
| Review | High-risk/ambiguous cases approved or excluded; stratified sample report |
| Exact leakage | Zero exact duplicate hashes across splits |
| Near-duplicate leakage | Same cluster cannot span train/validation/test/holdout |
| Coverage | Counts by source, channel, family, language, decision, role and sensitivity |
| Reproducibility | Same inputs/code/seed produce same IDs/splits/release hash |
| Licence | All components approved for the declared use; attribution bundle generated |

## 10. Evaluation

Security is asymmetric. Report:

- recall per attack family and source;
- benign-block/false-refusal rate per benign source and task category;
- macro security recall and confusion counts;
- cross-tenant/tool/approval policy correctness;
- secret/PII canary leakage;
- quality pass per task and route;
- gateway versus downstream p50/p95/p99 latency;
- tokens, model/tool calls, simulated/actual cost and budget breaches;
- safe successful requests per dollar;
- confidence intervals and dataset limitations.

```text
safe_success = expected policy decision
               AND authorization/tool result correct
               AND output guard passes
               AND quality floor passes

safe_successes_per_dollar = safe_success_count / max(total_estimated_cost_usd, epsilon)
```

Compare `always_strong`, deterministic policy without classifier, policy plus classifier and policy plus adaptive router on the exact same case release. For public suites with their own success metric, publish both the source-native metric and SentinelForge's normalized gateway metric without conflating them.

## 11. Dataset security

- Raw public prompts, documents, code, images, notebooks and archives are hostile.
- Fetchers cannot execute source code, install packages, follow arbitrary redirects or escape quarantine.
- Reject path traversal, symlinks, device files, macros, pickle, nested/unbounded archives and unsupported types.
- Escape content in reviewer UI; do not render active HTML, execute code or expose raw content in Pages.
- Scanner results are signals, not permission to use data. Licence and human review remain mandatory.
- Imported source labels cannot activate policy or directly set gateway allow/deny/route/approval.
- Dataset import identity has no provider keys, gateway tools or production-log access.

See [SECURITY.md](SECURITY.md) for the complete threat/control matrix.

## 12. Build order

1. Validate existing synthetic fixtures and migrate them to canonical schema.
2. Implement registry, quarantine, local fetcher/importer and immutable release.
3. Implement generator and policy-label templates; achieve policy-branch coverage.
4. Add Dolly importer and benign false-positive suite.
5. Add BIPIA importer and preserve its test split as external holdout.
6. Add isolated AgentDojo result adapter for tool/agent evaluation.
7. Add Tensor Trust, CyberSecEval or JailbreakBench only when a measured coverage gap justifies them.
8. Add sanitized shadow traffic only after explicit customer governance.

## 13. Definition of done

- Repository fixtures and generated cases validate offline and rebuild deterministically.
- One benign and one indirect-injection public source import from pinned, approved manifests.
- External holdout is inaccessible to training and remains unmodified.
- Released cases have complete provenance, licence, privacy, labels and split metadata.
- Candidate release cannot activate when any data/security/evaluation gate fails.
- Benchmark output is segmented by source/family and reports cost, time, quality and security together.
