import { decide, type ApprovalRecord, type Decision, type GatewayRequest, type Sensitivity } from '@/lib/policy-engine';
import { loadProviderConfig, listAvailableModels, streamFromProvider } from '@/lib/providers';

type ChatBody = Partial<GatewayRequest> & { prompt: string; modelId?: string; approval?: ApprovalRecord };

const VALID_SENSITIVITY: Sensitivity[] = ['public', 'internal', 'confidential', 'restricted'];

function errorResponse(code: string, message: string, status: number, decisionId: string | null = null) {
  return Response.json({ error: { code, message, decision_id: decisionId, retryable: false } }, { status });
}

// Approval ids consumed by this route, this server process. Not a durable
// store (see README → Known limitations → "Client-side approval demo") —
// it exists so a REQUIRE_APPROVAL request can't be replayed against
// /api/chat twice within one `npm run dev` session, even if a caller
// resends an already-used approval record.
const consumedApprovalIds = new Set<string>();

/** Server-side gate for a REQUIRE_APPROVAL decision: the human must have
 * approved *this exact* request (matching decisionId + requestHash), the
 * client must have already run it through `consumeApproval()` once
 * (`consumedAt` set), it must not be expired, and it must not already have
 * been redeemed against this route. Returns null when the approval clears
 * every check, otherwise a human-readable reason it didn't. */
function rejectApproval(approval: ApprovalRecord | undefined, decision: Decision): string | null {
  if (!approval) return 'Approval is required before a REQUIRE_APPROVAL request can be executed.';
  if (approval.outcome !== 'APPROVED') return 'Approval was not granted.';
  if (approval.decisionId !== decision.decisionId || approval.requestHash !== decision.requestHash) return 'Approval does not match this exact request.';
  if (!approval.consumedAt) return 'Approval must be executed once by the client before it is sent to the gateway.';
  if (approval.expiresAt <= Date.now()) return 'Approval has expired.';
  if (consumedApprovalIds.has(approval.approvalId)) return 'Approval already redeemed once — replay blocked.';
  return null;
}

// POST /api/chat — policy decision first, model call second. This is the
// route that proves the gateway's core claim: no provider is ever invoked
// before the request clears policy, and REQUIRE_APPROVAL/DENY never reach a
// model at all. On ALLOW it streams real tokens (SSE) from whichever local
// provider (Ollama, LM Studio, ...) currently serves the selected model.
export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse('INVALID_JSON', 'Request body must be valid JSON.', 400);
  }
  if (typeof body.prompt !== 'string') return errorResponse('INVALID_SCHEMA', '"prompt" is required and must be a string.', 400);
  if (body.sensitivity && !VALID_SENSITIVITY.includes(body.sensitivity)) return errorResponse('INVALID_SCHEMA', `"sensitivity" must be one of ${VALID_SENSITIVITY.join(', ')}.`, 400);

  const models = await listAvailableModels();
  const gatewayRequest: GatewayRequest = {
    requestId: body.requestId ?? `req-live-${Date.now()}`,
    tenantId: body.tenantId ?? 'acme-demo',
    appId: body.appId ?? 'console',
    role: body.role ?? 'developer',
    prompt: body.prompt,
    requestedTools: body.requestedTools ?? [],
    sensitivity: body.sensitivity ?? 'internal',
    qualityFloor: body.qualityFloor ?? 0.7,
    latencySloMs: body.latencySloMs ?? 2000,
    maxCostUsd: body.maxCostUsd ?? 0.01,
    dataRegion: 'local',
  };

  const decision = decide(gatewayRequest, models);

  if (decision.outcome === 'DENY') return errorResponse('POLICY_DENIED', 'Request cannot be processed under the active policy.', 403, decision.decisionId);

  if (decision.outcome === 'REQUIRE_APPROVAL') {
    // No approval attached at all is the normal first call for this
    // outcome — hand the decision back so the caller can route it to a
    // human, same as before this endpoint understood approvals.
    if (!body.approval) return Response.json({ decision }, { status: 202 });
    const reason = rejectApproval(body.approval, decision);
    if (reason) return errorResponse('APPROVAL_INVALID', reason, 403, decision.decisionId);
    consumedApprovalIds.add(body.approval.approvalId);
    // Falls through to the ALLOW routing/streaming path below — an
    // approved REQUIRE_APPROVAL decision already carries a `selectedRoute`
    // (policy-engine.ts computes routing for both outcomes), so nothing
    // else here needs to know the difference.
  }

  const modelId = body.modelId ?? decision.selectedRoute;
  if (!modelId) return errorResponse('NO_COMPLIANT_ROUTE', 'Policy allowed the request but no route was selected.', 502, decision.decisionId);

  const routedModel = models.find((model) => model.modelId === modelId);
  if (routedModel?.source === 'static') {
    return errorResponse('NO_LOCAL_PROVIDER', `Policy selected "${modelId}", a reference model with no live output. Start a local provider (e.g. \`ollama serve\`) or pass "modelId" for an online model.`, 503, decision.decisionId);
  }

  // Resolve which provider serves modelId *now*, before the streaming
  // Response is returned, instead of re-discovering providers from inside
  // start() below. A model's `provider` field is the provider id (e.g.
  // 'ollama'), set when listAvailableModels() built its ModelProfile.
  const owningProvider = loadProviderConfig().find((p) => p.id === routedModel?.provider);
  if (!owningProvider) return errorResponse('NO_LOCAL_PROVIDER', `No configured provider matches "${routedModel?.provider}" for model "${modelId}".`, 503, decision.decisionId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`event: decision\ndata: ${JSON.stringify(decision)}\n\n`));
      try {
        for await (const chunk of streamFromProvider(owningProvider.baseUrl, modelId, gatewayRequest.prompt)) {
          if (chunk.delta) controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ delta: chunk.delta })}\n\n`));
          if (chunk.done) controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Provider call failed.';
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  // Note: deliberately no `Connection` header — it's hop-by-hop and setting
  // it manually can cause runtimes (workerd included) to buffer or mishandle
  // the streaming response instead of flushing it incrementally.
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
}
