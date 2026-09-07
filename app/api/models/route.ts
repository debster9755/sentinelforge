import { discoverProviders, listAvailableModels, loadProviderConfig } from '@/lib/providers';

// GET /api/models — probes every configured local LLM provider (Ollama,
// LM Studio, llama.cpp server, vLLM by default) and returns what's actually
// running right now, plus the always-available static reference models so
// the console keeps working with no local server up.
export async function GET() {
  const providers = loadProviderConfig();
  const [health, models] = await Promise.all([discoverProviders(providers), listAvailableModels(providers)]);
  return Response.json({ providers: health, models });
}
