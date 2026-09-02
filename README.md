# SentinelForge

SentinelForge is a zero-key AI security and FinOps gateway demo. It evaluates every request through deterministic security policy, selects the cheapest compliant local model profile, enforces exact-scope human approval for elevated tools, and exposes the evidence behind every decision.

No paid services, model keys, telemetry endpoints, or external APIs are used. All decision logic and demo data run locally in the browser.

## What works

- Deterministic `ALLOW`, `DENY`, and `REQUIRE_APPROVAL` outcomes with stable reason codes
- Injection, secret-extraction, tool-authorization, size, budget, quality, and route-eligibility checks
- Cost/latency/quality routing across `fake-small`, `fake-medium`, and `fake-strong`
- One-time exact-bound approval with expiry, binding validation, and replay rejection
- Interactive overview, gateway lab, policy simulation, evaluation, and dataset-release views
- Metadata-only audit decisions (`contentLogged: false`)
- Deterministic test suite for golden, adversarial, fail-closed, approval, and metamorphic behavior

The UI is a safe portfolio simulator. It does not claim to replace enterprise IAM, DLP, WAF, model evaluation, or human security review.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Verify

```bash
npm test
npm run lint
npm run build
```

## Demo flow

1. On **Overview**, replay a public summary and see `fake-small` selected.
2. Replay a complex architecture request and see `fake-strong` selected.
3. Replay indirect injection or secret extraction and see denial before any provider call.
4. Open **Gateway**, enter a request containing “restart,” approve the exact scope once, then replay the approval to verify it is blocked.
5. Inspect **Policies**, **Evaluations**, and **Data releases** for immutable evidence and activation gates.

## Architecture

```text
Request → input guard → deterministic policy → approval interrupt
                                              ↓
Audit ← output guard ← fake local provider ← compliant route selector

Pinned source → quarantine → canonical validation → dedupe/split → release gates
```

Core decision logic lives in [`lib/gateway.ts`](lib/gateway.ts). Product and security source documents are preserved in [`docs/`](docs/), and canonical sample contracts are in [`data/`](data/).

## GitHub publishing

This folder is ready to become its own repository:

```bash
git init
git add .
git commit -m "Build SentinelForge AI security and FinOps gateway"
gh repo create sentinelforge --public --source=. --remote=origin --push
```

GitHub authentication is required only for the final `gh repo create` command.

## Security note

The dependency lockfile is committed for repeatability. Before deploying publicly, review `npm audit` output and update the pinned Sites/Vinext scaffold when patched compatible releases are available. Do not use `npm audit fix --force` without reviewing framework compatibility.

## License

MIT. Public dataset integrations remain disabled by default; their own component licences and attribution requirements still apply.
