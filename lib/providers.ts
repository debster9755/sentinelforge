// Local LLM provider registry. Every provider below speaks the same
// OpenAI-compatible HTTP surface (Ollama, LM Studio, llama.cpp server, vLLM),
// so one adapter covers all of them — the registry is just base URLs.
//
// This is intentionally the only file that knows about HTTP/fetch to real
// model servers. `lib/policy-engine.ts` never imports this module, which is
// what keeps the policy decision provider-agnostic and testable without a
// network.

import type { ModelProfile } from './policy-engine';
import rawStaticProfiles from '../data/model_profiles.json' with { type: 'json' };

export type ProviderConfig = { id: string; label: string; baseUrl: string };

// Ports match each tool's documented default. Override with
// SENTINEL_PROVIDERS (JSON array of ProviderConfig) for a non-default setup.
export const defaultProviders: ProviderConfig[] = [
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { id: 'llama-cpp', label: 'llama.cpp server', baseUrl: 'http://localhost:8080/v1' },
  { id: 'vllm', label: 'vLLM', baseUrl: 'http://localhost:8000/v1' },
];

export function loadProviderConfig(): ProviderConfig[] {
  const raw = process.env.SENTINEL_PROVIDERS;
  if (!raw) return defaultProviders;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // fall through to defaults on malformed env config
  }
  return defaultProviders;
}

type StaticProfileRow = { model_id: string; provider: string; quality_tier: 1 | 2 | 3; input_cost_per_million: number; output_cost_per_million: number; p50_latency_ms: number; supports_tools: boolean };

// Reference token counts used to turn per-million pricing into a per-request
// estimate. This is the same proxy the routing algorithm in docs/SPEC.md
// describes for local/fake providers.
const REFERENCE_INPUT_TOKENS = 800;
const REFERENCE_OUTPUT_TOKENS = 300;
const qualityByTier = { 1: 0.76, 2: 0.86, 3: 0.96 } as const;

// Static reference profiles that keep the demo fully deterministic and
// network-free when no local server is running. These replace the previous
// `fake-small/medium/strong` constants but keep the same three quality tiers,
// now sourced from data/model_profiles.json instead of being duplicated here.
export function staticModelProfiles(): ModelProfile[] {
  return (rawStaticProfiles as StaticProfileRow[]).map((entry) => ({
    modelId: entry.model_id,
    provider: entry.provider,
    quality: qualityByTier[entry.quality_tier],
    tier: entry.quality_tier,
    cost: Math.round(((entry.input_cost_per_million * REFERENCE_INPUT_TOKENS + entry.output_cost_per_million * REFERENCE_OUTPUT_TOKENS) / 1_000_000) * 1e6) / 1e6,
    latency: entry.p50_latency_ms,
    supportsTools: entry.supports_tools,
    source: 'static' as const,
  }));
}

type OpenAIModelsResponse = { data?: Array<{ id: string }> };

async function probeProvider(provider: ProviderConfig, timeoutMs = 1500): Promise<ModelProfile[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${provider.baseUrl}/models`, { signal: controller.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as OpenAIModelsResponse;
    return (body.data ?? []).map((model) => modelToProfile(provider, model.id));
  } catch {
    return []; // provider not running — this is the expected common case, not an error
  } finally {
    clearTimeout(timer);
  }
}

type ModelHint = { quality?: number; tier?: 1 | 2 | 3; cost?: number; latency?: number };

// Built-in tier mapping for the Qwen3 family pulled via `ollama pull`. This is
// what makes qwen3:4b / qwen3:8b / qwen3:14b step directly into the
// fake-small / fake-medium / fake-strong slots: matching each model's quality
// to the corresponding static tier (0.76 / 0.86 / 0.96) means a request that
// used to need "the medium tier" now needs "quality >= 0.86" — satisfied by
// qwen3:8b — and since a live model's cost defaults to $0, it always beats
// the static profile of the same tier on cost. No name-based special case in
// the routing algorithm itself; this is just accurate tier data for models we
// know about. Override any entry (or add your own) via SENTINEL_MODEL_HINTS —
// env values win over these defaults.
const DEFAULT_MODEL_HINTS: Record<string, ModelHint> = {
  'qwen3:4b': { tier: 1, quality: 0.76, latency: 220 }, // -> replaces fake-small
  'qwen3:8b': { tier: 2, quality: 0.86, latency: 480 }, // -> replaces fake-medium
  'qwen3:14b': { tier: 3, quality: 0.96, latency: 900 }, // -> replaces fake-strong
};

// Heuristic quality/cost estimate for a live local model we have no pricing
// data for. Local inference cost is a compute proxy, not a real invoice —
// see docs/SPEC.md's routing algorithm note on this. Adjust
// SENTINEL_MODEL_HINTS (JSON: { "<substring>": { quality, tier, cost, latency } })
// to override any model by name, including the Qwen3 defaults above.
export function modelToProfile(provider: ProviderConfig, modelId: string): ModelProfile {
  const hints: Record<string, ModelHint> = { ...DEFAULT_MODEL_HINTS, ...loadModelHints() };
  const hint = Object.entries(hints).find(([key]) => modelId.toLowerCase().includes(key.toLowerCase()))?.[1];
  const sizeMatch = modelId.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  const paramsB = sizeMatch ? Number(sizeMatch[1]) : undefined;
  const tier: 1 | 2 | 3 = hint?.tier ?? (paramsB === undefined ? 2 : paramsB < 4 ? 1 : paramsB < 20 ? 2 : 3);
  const quality = hint?.quality ?? { 1: 0.72, 2: 0.85, 3: 0.93 }[tier];
  return {
    modelId,
    provider: provider.id,
    quality,
    tier,
    cost: hint?.cost ?? 0, // local compute has no per-token billing; 0 by default
    latency: hint?.latency ?? 400,
    supportsTools: true,
    source: 'live',
  };
}

function loadModelHints(): Record<string, ModelHint> {
  const raw = process.env.SENTINEL_MODEL_HINTS;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export type ProviderHealth = { id: string; label: string; baseUrl: string; online: boolean; models: string[] };

/** Probes every configured provider in parallel and returns which are online and what they serve. */
export async function discoverProviders(providers: ProviderConfig[] = loadProviderConfig()): Promise<ProviderHealth[]> {
  return Promise.all(
    providers.map(async (provider) => {
      const models = await probeProvider(provider);
      return { id: provider.id, label: provider.label, baseUrl: provider.baseUrl, online: models.length > 0, models: models.map((m) => m.modelId) };
    }),
  );
}

/** All models available right now: live local models first (cheapest real option), static reference models as a always-available fallback. */
export async function listAvailableModels(providers: ProviderConfig[] = loadProviderConfig()): Promise<ModelProfile[]> {
  const live = (await Promise.all(providers.map((p) => probeProvider(p)))).flat();
  return [...live, ...staticModelProfiles()];
}

export type ChatChunk = { delta: string; done: boolean; usage?: { promptTokens: number; completionTokens: number } };

/** Streams a chat completion from whichever provider currently serves `modelId`. Throws if no configured provider reports that model. */
export async function* streamChat(modelId: string, prompt: string, providers: ProviderConfig[] = loadProviderConfig()): AsyncGenerator<ChatChunk> {
  const health = await discoverProviders(providers);
  const owner = health.find((p) => p.online && p.models.includes(modelId));
  if (!owner) throw new Error(`No online local provider currently serves model "${modelId}".`);

  const res = await fetch(`${owner.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: prompt }], stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`Provider ${owner.id} returned ${res.status} for model "${modelId}".`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') {
        yield { delta: '', done: true };
        return;
      }
      try {
        const parsed = JSON.parse(payload);
        const delta: string = parsed.choices?.[0]?.delta?.content ?? '';
        if (delta) yield { delta, done: false };
      } catch {
        // ignore malformed SSE frames (keep-alive comments, partial JSON)
      }
    }
  }
  yield { delta: '', done: true };
}
