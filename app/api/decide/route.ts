import { decide, type GatewayRequest, type Sensitivity } from '@/lib/policy-engine';
import { listAvailableModels, staticModelProfiles } from '@/lib/providers';

type DecideBody = Partial<GatewayRequest> & { prompt: string; useLiveModels?: boolean };

const VALID_SENSITIVITY: Sensitivity[] = ['public', 'internal', 'confidential', 'restricted'];

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message, decision_id: null, retryable: false } }, { status });
}

// POST /api/decide — runs the policy engine only. No model is ever called
// here; this is the endpoint the console workbench and any external
// integration call to get an ALLOW / REQUIRE_APPROVAL / DENY verdict for a
// user-supplied prompt and request context.
export async function POST(request: Request) {
  let body: DecideBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse('INVALID_JSON', 'Request body must be valid JSON.', 400);
  }

  if (typeof body.prompt !== 'string') return errorResponse('INVALID_SCHEMA', '"prompt" is required and must be a string.', 400);
  if (body.sensitivity && !VALID_SENSITIVITY.includes(body.sensitivity)) return errorResponse('INVALID_SCHEMA', `"sensitivity" must be one of ${VALID_SENSITIVITY.join(', ')}.`, 400);

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

  const models = body.useLiveModels ? await listAvailableModels() : staticModelProfiles();
  const decision = decide(gatewayRequest, models);
  return Response.json(decision);
}
