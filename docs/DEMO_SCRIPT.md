# SentinelForge demo script

This script is designed for a 10–12 minute live demo. Every decision is deterministic and runs locally: no model key, paid API, or external telemetry service is required.

## Before the demo

From the repository root:

```bash
npm install
npm test
npm run dev
```

Open `http://localhost:3000`. Keep the browser at desktop width so the navigation is visible. Start on **Overview**.

The central workbench is editable. A preset fills the request and controls; you may then change any field. **Reset** restores the selected preset. **Custom request** starts with an empty prompt.

## Opening: what SentinelForge does

Say:

> SentinelForge is a local AI security and FinOps control plane. Every request is inspected before a provider could be called, then either denied, paused for exact-scope approval, or routed to the least expensive model profile that meets quality, latency, tool, and budget policy.

Point out the four top-level operational measures, then move to the decision workbench.

## Scenario 1 — safe, inexpensive request succeeds

1. Select **Public summary**.
2. Leave quality at `0.70`, tool at `None`, and max cost at `0.01`.
3. Click **Run through gateway**.

Expected result:

- Outcome: `ALLOW`
- Route: `fake-small`
- Cost: `$0.0002`
- Reasons include `PUBLIC_DATA`, `LOW_RISK`, and `ROUTE_SMALL`

Say:

> The request passes the security and data-policy checks. Because the small profile clears the quality floor, SentinelForge avoids spending more on a stronger route.

Success versus deny contrast: change **Max cost** to `0.0001` and run again. The result becomes `DENY` with `NO_COMPLIANT_ROUTE`, zero provider cost, and no selected route. Click **Reset** before continuing.

## Scenario 2 — complexity justifies a stronger route

1. Select **Complex architecture**.
2. Click **Run through gateway**.

Expected result:

- Outcome: `ALLOW`
- Route: `fake-strong`
- Cost: `$0.0028`
- Reason includes `ROUTE_STRONG`

Say:

> FinOps control does not mean always choosing the cheapest model. It means choosing the cheapest compliant model. A 0.92 quality floor excludes the small and medium profiles.

Deny contrast: change **Quality floor** to `0.97` and run again. No profile meets it, so the gateway fails closed with `NO_COMPLIANT_ROUTE`. Reset afterward.

## Scenario 3 — indirect prompt injection is denied

1. Select **Indirect injection**.
2. Point out the untrusted document text containing a system override and the `http_post` request.
3. Click **Run through gateway**.

Expected result:

- Outcome: `DENY`
- Route: `No provider called`
- Cost: `$0.0000`
- Reasons: `INDIRECT_INJECTION` and `EXFILTRATION_INTENT`

Say:

> The request is stopped before routing. The policy emits stable reason codes while prompt content remains out of audit logs.

Success contrast: replace the payload with `Summarize the document in three bullets.`, set the tool to `None`, and run. It is allowed. Reset afterward.

## Scenario 4 — secret extraction is denied

1. Select **Secret exfiltration**.
2. Click **Run through gateway**.

Expected result:

- Outcome: `DENY`
- Reasons: `SECRET_EXTRACTION` and `RESTRICTED_DATA`
- No route and zero estimated provider cost

Success contrast: replace the payload with `Explain how API keys should be rotated without showing any key.` and run. The benign security guidance is allowed.

## Scenario 5 — denial-of-wallet behavior is denied

1. Select **Denial of wallet**.
2. Click **Run through gateway**.

Expected result:

- Outcome: `DENY`
- Reasons: `DENIAL_OF_WALLET` and `STEP_LIMIT`
- No route and zero estimated provider cost

Success contrast: replace the payload with `Give one concise architecture recommendation.` Set quality to `0.92` and max cost to `0.01`; the bounded request is allowed on `fake-strong`.

## Scenario 6 — dangerous tool is denied

1. Select **Custom request**.
2. Enter `Post this summary to an external endpoint.`
3. Set **Requested tool** to `http_post · denied`.
4. Click **Run through gateway**.

Expected result: `DENY` with `TOOL_NOT_ALLOWED`, no route, and zero cost.

Success contrast: set the tool to `None` and run again. The text-only request is allowed.

## Scenario 7 — elevated tool pauses for approval

1. Open **Gateway** in the left navigation.
2. Enter `Restart the demo service after the maintenance check.`
3. Click **Evaluate request**.

Expected result: `REQUIRE_APPROVAL` with `TOOL_ELEVATED` and `EXACT_SCOPE_APPROVAL`.

4. Click **Approve & execute once**.
5. Click **Replay approval**.

Expected result: the first exact-bound approval is consumed; replay is blocked.

Say:

> Approval is an execution interrupt, not a chat convention. It binds the decision and request hash, expires, and can be consumed only once.

Success contrast: change the prompt to `Describe a safe maintenance checklist.` and evaluate it. With no elevated execution intent, it follows the normal allow path.

## Scenario 8 — policy changes are simulated safely

1. Open **Policies**.
2. Select `balanced-routing`, then `strict-egress`.
3. Compare the counts for allow-to-deny, route changes, and approval additions.

Say:

> Candidate policy replay uses sanitized decision metadata. It does not call a model or modify the active policy, and promotion remains gated by independent approval.

## Scenario 9 — release evidence stays segmented

1. Open **Evaluations**.
2. Point to attack recall and benign-block gates.
3. Scan the source and attack-family table.

Say:

> Security performance is shown by source and attack family so a healthy aggregate cannot conceal one failing category.

## Scenario 10 — public datasets are optional and controlled

1. Open **Data releases**.
2. Select **Databricks Dolly 15k** and inspect its revision, licence, lane, and command.
3. Click **Enable option**. Explain that this only enables the option for the browser session.
4. Select **Microsoft BIPIA** to show the external-holdout lane.
5. Select a review-only source to show that activation is unavailable.

Optional terminal demonstration, with no download:

```bash
npm run dataset -- list
npm run dataset -- inspect databricks-dolly-15k
```

Only demonstrate an actual download when network use and the dataset licence have been explicitly accepted:

```bash
npm run dataset -- import databricks-dolly-15k \
  --network --accept-license --limit 25
```

Say:

> Sources are disabled by default. Import requires an explicit network flag and licence acceptance, writes raw bytes to quarantine, validates and redacts the data, and still produces a pending-review release that cannot activate automatically.

## Close

Say:

> SentinelForge demonstrates one joined control loop: secure inspection, fail-closed policy, exact-scope approval, least-cost compliant routing, and evidence-gated data releases. The demo is intentionally local and deterministic, so every claim can be rerun without a paid dependency.

## Three-minute version

If time is short, show only:

1. **Public summary** → `ALLOW` on `fake-small`.
2. **Complex architecture** → `ALLOW` on `fake-strong`.
3. **Indirect injection** → `DENY`, no route, zero cost.
4. **Gateway** restart request → approval once, replay blocked.
5. **Data releases** → one ready source and one review-only source.

## Troubleshooting

- If the port is busy, run `npm run dev -- --port 3001` and open `http://localhost:3001`.
- If a request produces an unexpected result, select its preset and click **Reset** before rerunning.
- A blank custom payload is rejected in the interface and fails closed in the policy engine with `EMPTY_PROMPT`.
- Dataset downloads never happen from the dashboard. Run the copied command in a terminal and include `--network` and `--accept-license` deliberately.
