'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Check, CheckCircle2, ChevronDown, CircleDollarSign, Clock3, CloudDownload, Command, Copy, Download, ExternalLink, FileCheck2, Gauge, GitBranch, LayoutDashboard, LockKeyhole, Play, RotateCcw, ShieldCheck, ShieldX, Sparkles, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { appendAuditEntry, clearAuditLog, loadAuditLog, toAuditEntry, toJsonl, type AuditEntry } from '@/lib/audit-log';
import { consumeApproval, createApproval, decide, evaluationRows, scenarioRequests, type ApprovalRecord, type Decision, type GatewayRequest, type ModelProfile, type RuleHit } from '@/lib/gateway';
import { publicDatasetRegistry, sourceCommand } from '@/lib/public-datasets';

const scenarios = [
  { id: 'public-summary', label: 'Public summary' },
  { id: 'complex-architecture', label: 'Complex architecture' },
  { id: 'prompt-injection', label: 'Indirect injection' },
  { id: 'elevated-tool', label: 'Elevated tool call' },
  { id: 'secret-exfiltration', label: 'Secret exfiltration' },
  { id: 'budget-abuse', label: 'Denial of wallet' },
  { id: 'confidential-tool-combo', label: 'Confidential + tool (soft signal)' },
  { id: 'custom', label: 'Custom request' },
];

const CUSTOM_DEFAULTS: Pick<GatewayRequest, 'role' | 'tenantId' | 'appId' | 'sensitivity' | 'qualityFloor' | 'maxCostUsd'> = {
  role: 'developer',
  tenantId: 'acme-demo',
  appId: 'custom-request',
  sensitivity: 'internal',
  qualityFloor: 0.7,
  maxCostUsd: 0.01,
};

const navItems = [[LayoutDashboard, 'Overview'], [ShieldCheck, 'Gateway'], [FileCheck2, 'Policies'], [Activity, 'Evaluations'], [GitBranch, 'Data releases']] as const;

type ProviderHealth = { id: string; label: string; baseUrl: string; online: boolean; models: string[] };
type ModelsResponse = { providers: ProviderHealth[]; models: ModelProfile[] };

/** Shared local-model discovery, used by the workbench and the Gateway lab so both panels agree on what's actually running. */
function useLocalModels() {
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data: ModelsResponse = await res.json();
        setProviders(data.providers);
        setModels(data.models);
      }
    } catch {
      // API route unreachable (static export, offline) — panels fall back to static reference models
    } finally {
      setLoading(false);
    }
  }

  // Deferred to a microtask so `refresh`'s synchronous `setLoading(true)` runs
  // outside the effect's own call stack (the react-compiler lint flags
  // setState called synchronously inside an effect body).
  useEffect(() => { void Promise.resolve().then(() => refresh()); }, []);
  return { providers, models, loading, refresh };
}

async function requestDecision(payload: Record<string, unknown>): Promise<{ decision: Decision; offline: boolean }> {
  try {
    const res = await fetch('/api/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, useLiveModels: true }) });
    if (res.ok) return { decision: await res.json(), offline: false };
  } catch {
    // fall through to local fallback below
  }
  const request: GatewayRequest = { requestId: `req-offline-${Date.now()}`, tenantId: 'acme-demo', appId: 'console', role: 'developer', dataRegion: 'local', prompt: '', requestedTools: [], sensitivity: 'internal', qualityFloor: 0.7, latencySloMs: 2000, maxCostUsd: 0.01, ...payload } as GatewayRequest;
  return { decision: decide(request), offline: true };
}

export function SentinelConsole() {
  const [activeView, setActiveView] = useState('Overview');
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [draftPrompt, setDraftPrompt] = useState(scenarioRequests['public-summary'].prompt);
  const [sensitivity, setSensitivity] = useState<GatewayRequest['sensitivity']>(scenarioRequests['public-summary'].sensitivity);
  const [qualityFloor, setQualityFloor] = useState(scenarioRequests['public-summary'].qualityFloor);
  const [maxCostUsd, setMaxCostUsd] = useState(scenarioRequests['public-summary'].maxCostUsd);
  const [requestedTool, setRequestedTool] = useState(scenarioRequests['public-summary'].requestedTools[0] ?? '');
  const [inputError, setInputError] = useState('');
  const [result, setResult] = useState<Decision | null>(null);
  const [running, setRunning] = useState(false);
  const [offline, setOffline] = useState(false);
  const [approval, setApproval] = useState<ApprovalRecord | null>(null);
  const [approvalRejected, setApprovalRejected] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState('');
  const [output, setOutput] = useState('');
  const [outputError, setOutputError] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(() => loadAuditLog());
  const { providers, models, loading: modelsLoading, refresh: refreshModels } = useLocalModels();
  const allowed = result?.outcome === 'ALLOW';
  const denied = result?.outcome === 'DENY';
  const requiresApproval = result?.outcome === 'REQUIRE_APPROVAL';
  // "Generate with local model" unlocks for a plain ALLOW immediately, and
  // for REQUIRE_APPROVAL only once "Approve & execute once" has been
  // clicked — never for "Do not approve" or an undecided approval prompt.
  const canGenerate = allowed || (requiresApproval && approval !== null);

  function loadScenario(id: string) {
    setScenarioId(id);
    const request = id === 'custom' ? { ...scenarioRequests['public-summary'], ...CUSTOM_DEFAULTS, prompt: '', requestedTools: [] } : scenarioRequests[id];
    setDraftPrompt(request.prompt);
    setSensitivity(request.sensitivity);
    setQualityFloor(request.qualityFloor);
    setMaxCostUsd(request.maxCostUsd);
    setRequestedTool(request.requestedTools[0] ?? '');
    setInputError('');
    setResult(null);
    setApproval(null);
    setApprovalRejected(false);
    setApprovalStatus('');
    setOutput('');
    setOutputError('');
  }

  async function runScenario() {
    if (!draftPrompt.trim()) { setInputError('Enter a request payload before running the gateway.'); return; }
    setInputError('');
    setRunning(true);
    setApproval(null);
    setApprovalRejected(false);
    setApprovalStatus('');
    setOutput('');
    setOutputError('');
    const { decision, offline: isOffline } = await requestDecision({ prompt: draftPrompt, sensitivity, qualityFloor, maxCostUsd, requestedTools: requestedTool ? [requestedTool] : [] });
    setResult(decision);
    setOffline(isOffline);
    setAuditLog(appendAuditEntry(toAuditEntry(decision, draftPrompt)));
    setRunning(false);
  }

  async function generateOutput() {
    if (!result || !canGenerate) return;

    // For a REQUIRE_APPROVAL decision, the approval is spent right here, at
    // the moment generation is actually requested — not when it was granted.
    // That's what makes "Approve & execute once" mean once: the consumed
    // record (with its nonce marked used) is what gets sent to /api/chat,
    // which independently verifies it before calling a model.
    let approvalPayload: ApprovalRecord | undefined;
    if (result.outcome === 'REQUIRE_APPROVAL') {
      if (!approval) return;
      try {
        const consumed = consumeApproval(approval, result);
        setApproval(consumed);
        setApprovalStatus('Executed once · approval is now consumed');
        approvalPayload = consumed;
      } catch (error) {
        setApprovalStatus(error instanceof Error ? error.message : 'Approval could not be consumed');
        return;
      }
    }

    setStreaming(true);
    setOutput('');
    setOutputError('');
    try {
      // Reuse the exact requestId /api/decide already returned on `result`.
      // /api/chat re-runs decide() independently (see chat/route.ts) rather
      // than trusting the client's verdict — without the same requestId
      // that second call would mint its own, produce a different
      // requestHash, and a real approval could never match it.
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: result.requestId, prompt: draftPrompt, sensitivity, qualityFloor, maxCostUsd, requestedTools: requestedTool ? [requestedTool] : [], ...(approvalPayload ? { approval: approvalPayload } : {}) }) });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setOutputError(body?.error?.message ?? `Gateway returned ${res.status}.`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const eventLine = frame.split('\n').find((line) => line.startsWith('event:'));
          const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const event = eventLine?.slice(6).trim() ?? 'message';
          const data = JSON.parse(dataLine.slice(5).trim());
          if (event === 'token') setOutput((current) => current + data.delta);
          if (event === 'error') setOutputError(data.message);
        }
      }
    } catch {
      setOutputError('Could not reach the local model provider. Is Ollama or LM Studio running?');
    } finally {
      setStreaming(false);
    }
  }

  /** "Approved & execute once" — grants the approval but does NOT spend it.
   * The nonce is only consumed inside generateOutput(), the moment a model
   * is actually about to be called. This just unlocks that button. */
  function approveRequest() {
    if (!result) return;
    setApprovalRejected(false);
    try {
      const created = createApproval(result, 'security-approver');
      setApproval(created);
      setApprovalStatus('Approved · click "Generate with local model" to execute once');
    } catch (error) {
      setApprovalStatus(error instanceof Error ? error.message : 'Approval failed');
    }
  }

  /** "Do not approve" — the request stops here. "Generate with local model" never unlocks. */
  function rejectRequest() {
    setApproval(null);
    setApprovalRejected(true);
    setApprovalStatus('Not approved · this request will not be executed');
  }

  /** Demonstrates the one-time nonce actually working: re-consuming an
   * already-spent approval is expected to throw. */
  function replayApproval() {
    if (!approval || !result) return;
    try { consumeApproval(approval, result); setApprovalStatus('Unexpected: replay succeeded'); }
    catch (error) { setApprovalStatus(error instanceof Error ? error.message : 'Replay blocked'); }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-5 px-4 lg:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark"><ShieldCheck className="size-5" aria-hidden="true" /></div>
            <div><p className="font-heading text-[15px] font-semibold tracking-[-0.02em]">SentinelForge</p><p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">AI control plane</p></div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ProviderBadge providers={providers} loading={modelsLoading} />
            <Button variant="outline" size="sm" className="border-white/10 bg-white/4"><Command className="size-3.5" /><span className="hidden sm:inline">Command</span></Button>
            <div className="grid size-8 place-items-center rounded-full border border-cyan-400/25 bg-cyan-400/10 text-xs font-semibold text-cyan-200">DR</div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-64px)] border-r border-white/8 p-4 lg:block">
          <nav aria-label="Primary navigation" className="space-y-1">
            {navItems.map(([Icon, label]) => <button key={label} onClick={() => setActiveView(label)} className={`nav-item ${activeView === label ? 'nav-item-active' : ''}`} type="button"><Icon className="size-4" aria-hidden="true" />{label}</button>)}
          </nav>
          <div className="mt-8 px-2"><p className="eyebrow">Active policy</p><div className="mt-3 rounded-xl border border-white/8 bg-white/[0.025] p-3"><div className="flex items-center justify-between text-xs font-medium"><span>enterprise-default</span><Badge variant="outline" className="border-cyan-400/20 text-cyan-300">v2.0.0</Badge></div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Scored risk engine · 3-way outcome · local region</p></div></div>
        </aside>

        <section className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {activeView !== 'Overview' ? <FeatureView view={activeView} onNavigate={setActiveView} /> : <>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div><div className="mb-2 flex items-center gap-2"><span className="h-px w-6 bg-cyan-400" /><p className="eyebrow text-cyan-300">Live operations</p></div><h1 className="font-heading text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Security posture, spend control.</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Every request is scored for risk, resolved to ALLOW / REQUIRE_APPROVAL / DENY, and only then routed to the least expensive compliant model.</p></div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{auditLog[0] ? `Last decision ${new Date(auditLog[0].timestamp).toLocaleTimeString()}` : 'No decisions this session'}</div>
          </div>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={ShieldCheck} label="Session decisions" value={String(auditLog.length)} detail="this browser session · localStorage" tone="cyan" />
            <Metric icon={ShieldX} label="Threats blocked" value={String(auditLog.filter((e) => e.outcome === 'DENY').length)} detail="DENY outcomes this session" tone="rose" />
            <Metric icon={AlertTriangle} label="Escalated to human" value={String(auditLog.filter((e) => e.outcome === 'REQUIRE_APPROVAL').length)} detail="REQUIRE_APPROVAL outcomes" tone="amber" />
            <Metric icon={CircleDollarSign} label="Spend, this session" value={`$${auditLog.reduce((sum, e) => sum + e.estimatedCostUsd, 0).toFixed(4)}`} detail="estimated across allowed requests" tone="emerald" />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)]">
            <Card className="surface-card min-h-[450px]">
              <CardHeader className="border-b border-white/8 pb-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Decision workbench</p><CardTitle className="mt-1 text-lg">Test a gateway request</CardTitle></div><Badge variant="outline" className="border-white/10 bg-white/4 text-muted-foreground"><Sparkles />Scored engine · live routing</Badge></div></CardHeader>
              <CardContent className="pt-5">
                <div className="grid gap-3 md:grid-cols-[210px_minmax(0,1fr)]">
                  <label className="text-xs font-medium text-muted-foreground">Start from a scenario<div className="relative mt-2"><select value={scenarioId} onChange={(event) => loadScenario(event.target.value)} className="field-control w-full appearance-none pr-9">{scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div></label>
                  <label className="text-xs font-medium text-muted-foreground">Request payload<textarea aria-label="Request payload" className="field-control mt-2 min-h-24 w-full resize-y font-mono text-[12px] leading-5" value={draftPrompt} onChange={(event) => { setDraftPrompt(event.target.value); setInputError(''); }} placeholder="Type or paste any request to inspect…" /></label>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="text-xs font-medium text-muted-foreground">Sensitivity<select aria-label="Sensitivity" value={sensitivity} onChange={(event) => setSensitivity(event.target.value as GatewayRequest['sensitivity'])} className="field-control mt-2 w-full"><option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option></select></label>
                  <label className="text-xs font-medium text-muted-foreground">Requested tool<select aria-label="Requested tool" value={requestedTool} onChange={(event) => setRequestedTool(event.target.value)} className="field-control mt-2 w-full"><option value="">None</option><option value="restart_service">restart_service · approval</option><option value="http_post">http_post · denied</option><option value="delete_index">delete_index · denied</option></select></label>
                  <label className="text-xs font-medium text-muted-foreground">Quality floor<select aria-label="Quality floor" value={qualityFloor} onChange={(event) => setQualityFloor(Number(event.target.value))} className="field-control mt-2 w-full"><option value="0.7">0.70 · small eligible</option><option value="0.8">0.80 · medium+</option><option value="0.92">0.92 · strong only</option><option value="0.97">0.97 · no route</option></select></label>
                  <label className="text-xs font-medium text-muted-foreground">Max cost (USD)<input aria-label="Maximum cost in USD" type="number" min="0" step="0.0001" value={maxCostUsd} onChange={(event) => setMaxCostUsd(Number(event.target.value))} className="field-control mt-2 w-full" /></label>
                </div>
                {inputError && <p role="alert" className="mt-3 text-xs text-rose-300">{inputError}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground"><LockKeyhole className="mr-1.5 inline size-3.5" />Prompt content is never written to audit logs — only a 60-char preview.</p><div className="flex gap-2"><Button variant="outline" onClick={() => loadScenario(scenarioId)} disabled={running}><RotateCcw className="size-3.5" />Reset</Button><Button onClick={runScenario} disabled={running} className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"><Play className="size-3.5 fill-current" />{running ? 'Evaluating…' : 'Run through gateway'}</Button></div></div>

                {result && <div className="mt-6 rounded-xl border border-white/8 bg-black/20 p-4" aria-live="polite">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><div className={`grid size-8 place-items-center rounded-lg ${allowed ? 'bg-emerald-400/12 text-emerald-300' : denied ? 'bg-rose-400/12 text-rose-300' : 'bg-amber-400/12 text-amber-300'}`}>{allowed ? <CheckCircle2 className="size-4" /> : denied ? <ShieldX className="size-4" /> : <AlertTriangle className="size-4" />}</div><div><p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Policy outcome</p><p className="font-mono text-sm font-semibold">{running ? 'EVALUATING' : result.outcome}</p></div></div><div className="text-right"><span className="font-mono text-[11px] text-muted-foreground">{result.decisionId}</span>{offline && <p className="text-[10px] text-amber-300">offline fallback · static models only</p>}</div></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-4"><ResultFact label="Risk score" value={result.risk.toFixed(2)} /><ResultFact label="Selected route" value={result.selectedRoute ?? 'No provider called'} /><ResultFact label="Estimated cost" value={`$${result.estimatedCostUsd.toFixed(4)}`} /><ResultFact label="Gateway latency" value={`${result.gatewayLatencyMs} ms`} /></div>
                  <div className="mt-4 flex flex-wrap gap-1.5">{result.reasonCodes.map((reason) => <Badge key={reason} variant="outline" className="border-white/10 bg-white/[0.035] font-mono text-[10px] text-muted-foreground">{reason}</Badge>)}</div>
                  {result.hits.length > 0 && <div className="mt-4"><p className="eyebrow mb-2">Matched signals</p><AnnotatedPrompt prompt={draftPrompt} hits={result.hits} /></div>}

                  {requiresApproval && <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                    <p className="text-sm font-medium">Exact-scope approval required</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Binds tenant, request hash, tool, arguments, expiry, and one-time nonce.</p>
                    {!approval && !approvalRejected && <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={approveRequest} className="bg-amber-300 text-slate-950 hover:bg-amber-200"><Check className="size-3.5" />Approve &amp; execute once</Button>
                      <Button size="sm" variant="outline" onClick={rejectRequest}><ShieldX className="size-3.5" />Do not approve</Button>
                    </div>}
                    {approval?.consumedAt != null && <div className="mt-3"><Button size="sm" variant="outline" onClick={replayApproval}><RotateCcw className="size-3.5" />Replay approval (should be blocked)</Button></div>}
                    {approvalStatus && <p className={`mt-3 text-xs ${approvalStatus.toLowerCase().includes('blocked') || approvalStatus.toLowerCase().includes('not approved') || approvalStatus.toLowerCase().includes('failed') ? 'text-rose-300' : 'text-emerald-300'}`}>{approvalStatus}</p>}
                  </div>}

                  {canGenerate && <div className="mt-4 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.03] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Local model output</p><Button size="sm" onClick={generateOutput} disabled={streaming || (requiresApproval && approval?.consumedAt != null)} className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"><Play className="size-3.5 fill-current" />{streaming ? 'Generating…' : requiresApproval && approval?.consumedAt != null ? 'Executed once' : 'Generate with local model'}</Button></div>
                    {outputError && <p className="mt-2 text-xs text-rose-300">{outputError}</p>}
                    {(output || streaming) && <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-white/8 bg-black/30 p-3 font-mono text-[12px] leading-5">{output}{streaming && <span className="animate-pulse">▍</span>}</pre>}
                  </div>}
                </div>}
              </CardContent>
            </Card>

            <div className="grid gap-5">
              <ProvidersCard providers={providers} models={models} loading={modelsLoading} onRefresh={refreshModels} />
              <AuditLogCard entries={auditLog} onClear={() => { clearAuditLog(); setAuditLog([]); }} />
            </div>
          </div></>}
        </section>
      </div>
    </main>
  );
}

function ProviderBadge({ providers, loading }: { providers: ProviderHealth[]; loading: boolean }) {
  const onlineCount = providers.filter((p) => p.online).length;
  if (loading) return <Badge variant="outline" className="hidden border-white/10 bg-white/4 text-muted-foreground sm:inline-flex">Checking local models…</Badge>;
  return <Badge variant="outline" className={`hidden sm:inline-flex ${onlineCount ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-300' : 'border-white/10 bg-white/4 text-muted-foreground'}`}><span className={`size-1.5 rounded-full ${onlineCount ? 'bg-emerald-400' : 'bg-white/30'}`} /> {onlineCount ? `${onlineCount} local provider${onlineCount === 1 ? '' : 's'} online` : 'No local providers online'}</Badge>;
}

function ProvidersCard({ providers, models, loading, onRefresh }: { providers: ProviderHealth[]; models: ModelProfile[]; loading: boolean; onRefresh: () => void }) {
  const liveModels = models.filter((m) => m.source === 'live');
  return <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Local model providers</p><CardTitle className="mt-1">{liveModels.length} live model{liveModels.length === 1 ? '' : 's'} available</CardTitle></div><Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}><RotateCcw className="size-3.5" />Rescan</Button></div></CardHeader><CardContent className="space-y-2 pt-4">
    {providers.length === 0 && <p className="text-xs text-muted-foreground">{loading ? 'Probing localhost providers…' : 'No providers configured.'}</p>}
    {providers.map((provider) => <div key={provider.id} className="flex items-center justify-between rounded-lg border border-white/7 p-3 text-xs"><div className="flex items-center gap-2">{provider.online ? <Wifi className="size-3.5 text-emerald-400" /> : <WifiOff className="size-3.5 text-muted-foreground" />}<div><p className="font-medium">{provider.label}</p><p className="text-[10px] text-muted-foreground">{provider.baseUrl}</p></div></div><Badge variant="outline" className={provider.online ? 'border-emerald-400/25 text-emerald-300' : 'border-white/10 text-muted-foreground'}>{provider.online ? `${provider.models.length} model${provider.models.length === 1 ? '' : 's'}` : 'offline'}</Badge></div>)}
    <p className="pt-1 text-[11px] leading-5 text-muted-foreground">Point at Ollama, LM Studio, llama.cpp server, or vLLM — anything speaking the OpenAI-compatible <code className="font-mono">/v1</code> API. Configure via <code className="font-mono">SENTINEL_PROVIDERS</code>.</p>
  </CardContent></Card>;
}

function AuditLogCard({ entries, onClear }: { entries: AuditEntry[]; onClear: () => void }) {
  function exportJsonl() {
    const blob = new Blob([toJsonl(entries)], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sentinelforge-audit-${Date.now()}.jsonl`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Session audit trail</p><CardTitle className="mt-1">{entries.length} decision{entries.length === 1 ? '' : 's'} logged</CardTitle></div><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={exportJsonl} disabled={!entries.length}><Download className="size-3.5" /></Button><Button variant="ghost" size="sm" onClick={onClear} disabled={!entries.length}>Clear</Button></div></div></CardHeader><CardContent className="max-h-72 space-y-2 overflow-y-auto pt-4">
    {entries.length === 0 && <p className="text-xs text-muted-foreground">Run a request through the gateway to start this session&apos;s trail. Stored in this browser only.</p>}
    {entries.map((entry) => <div key={entry.decisionId} className="rounded-lg border border-white/7 p-2.5 text-[11px]"><div className="flex items-center justify-between gap-2"><Badge className={entry.outcome === 'ALLOW' ? 'bg-emerald-400/10 text-emerald-300' : entry.outcome === 'DENY' ? 'bg-rose-400/10 text-rose-300' : 'bg-amber-400/10 text-amber-300'}>{entry.outcome}</Badge><span className="font-mono text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString()}</span></div><p className="mt-1.5 truncate text-muted-foreground">{entry.promptPreview}</p></div>)}
  </CardContent></Card>;
}

const CATEGORY_COLOR: Record<RuleHit['category'], string> = {
  injection: 'bg-rose-400/25 text-rose-100',
  secret: 'bg-rose-400/25 text-rose-100',
  pii: 'bg-amber-400/25 text-amber-100',
  budget: 'bg-violet-400/25 text-violet-100',
  tool: 'bg-cyan-400/25 text-cyan-100',
  sensitivity: 'bg-amber-400/25 text-amber-100',
  input: 'bg-white/15 text-white',
  routing: 'bg-white/15 text-white',
};

/** Renders the prompt as plain text with the exact substrings that triggered a rule highlighted, so a reader can see *which words* caused the decision instead of trusting a black-box score. */
function AnnotatedPrompt({ prompt, hits }: { prompt: string; hits: RuleHit[] }) {
  const spanned = hits.filter((hit): hit is RuleHit & { span: [number, number] } => hit.span !== null).sort((a, b) => a.span[0] - b.span[0]);
  if (!spanned.length) return <ul className="space-y-1.5">{hits.map((hit) => <li key={hit.ruleId} className="flex items-start gap-2 text-xs text-muted-foreground"><Badge variant="outline" className={`shrink-0 border-white/10 text-[10px] ${CATEGORY_COLOR[hit.category]}`}>{hit.category}</Badge>{hit.message}</li>)}</ul>;

  const segments: Array<{ text: string; hit: RuleHit | null }> = [];
  let cursor = 0;
  for (const hit of spanned) {
    const [start, end] = hit.span;
    if (start > cursor) segments.push({ text: prompt.slice(cursor, start), hit: null });
    segments.push({ text: prompt.slice(start, end), hit });
    cursor = Math.max(cursor, end);
  }
  if (cursor < prompt.length) segments.push({ text: prompt.slice(cursor), hit: null });

  return <div className="rounded-lg border border-white/7 bg-black/25 p-3 font-mono text-[12px] leading-6">
    {segments.map((segment, index) => segment.hit ? <mark key={index} title={segment.hit.message} className={`rounded px-0.5 ${CATEGORY_COLOR[segment.hit.category]}`}>{segment.text}</mark> : <span key={index}>{segment.text}</span>)}
  </div>;
}

function FeatureView({ view, onNavigate }: { view: string; onNavigate: (view: string) => void }) {
  if (view === 'Gateway') return <GatewayView />;
  if (view === 'Policies') return <PoliciesView />;
  if (view === 'Evaluations') return <EvaluationsView />;
  if (view === 'Data releases') return <DataReleasesView />;
  return <Button onClick={() => onNavigate('Overview')}>Return to overview</Button>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2"><span className="h-px w-6 bg-cyan-400" /><p className="eyebrow text-cyan-300">{eyebrow}</p></div><h1 className="font-heading text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">{title}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p></div>{action}</div>;
}

function GatewayView() {
  const [prompt, setPrompt] = useState('Summarize this public release note in three bullets.');
  const [quality, setQuality] = useState(0.7);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [approval, setApproval] = useState<ApprovalRecord | null>(null);
  const [approvalStatus, setApprovalStatus] = useState('');
  const { providers, models, loading } = useLocalModels();

  function evaluate() {
    const next = decide({ ...scenarioRequests['public-summary'], requestId: `req-live-${Date.now()}`, prompt, qualityFloor: quality, requestedTools: prompt.toLowerCase().includes('restart') ? ['restart_service'] : [] }, models.length ? models : undefined);
    setDecision(next); setApproval(null); setApprovalStatus('');
  }

  function approveAndConsume() {
    if (!decision) return;
    try { const created = createApproval(decision, 'security-approver'); const consumed = consumeApproval(created, decision); setApproval(consumed); setApprovalStatus('Executed once · approval is now consumed'); }
    catch (error) { setApprovalStatus(error instanceof Error ? error.message : 'Approval failed'); }
  }

  function replay() {
    if (!approval || !decision) return;
    try { consumeApproval(approval, decision); } catch (error) { setApprovalStatus(error instanceof Error ? error.message : 'Replay blocked'); }
  }

  return <>
    <PageHeading eyebrow="Gateway lab" title="Inspect a live request." description="Run arbitrary text through the deterministic guard, policy, budget, and route selection pipeline. Nothing leaves this browser except calls to your own local model providers." action={<Badge variant="outline" className="border-emerald-400/25 bg-emerald-400/8 text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-400" /> Local only</Badge>} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
      <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">OpenAI-compatible request</p><CardTitle>Request envelope</CardTitle></CardHeader><CardContent className="space-y-4 pt-5">
        <label className="block text-xs font-medium text-muted-foreground">Messages[0].content<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="field-control mt-2 min-h-44 w-full resize-y font-mono text-xs leading-5" /></label>
        <div className="grid gap-3 sm:grid-cols-3"><ResultFact label="Tenant" value="acme-demo" /><ResultFact label="Region" value="local" /><ResultFact label="Max cost" value="$0.0100" /></div>
        <label className="block text-xs font-medium text-muted-foreground">Quality floor · {quality.toFixed(2)}<input aria-label="Quality floor" type="range" min="0.7" max="0.96" step="0.01" value={quality} onChange={(event) => setQuality(Number(event.target.value))} className="mt-3 w-full accent-cyan-400" /></label>
        <Button onClick={evaluate} disabled={loading} className="w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300"><Play className="fill-current" />Evaluate request</Button>
        <p className="text-[11px] text-muted-foreground">{providers.some((p) => p.online) ? `Routing against ${models.filter((m) => m.source === 'live').length} live local model(s).` : 'No local provider online — routing against static reference models.'}</p>
      </CardContent></Card>
      <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Decision trace</p><CardTitle>{decision ? decision.outcome : 'Awaiting request'}</CardTitle></CardHeader><CardContent className="pt-5">
        {!decision ? <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-white/10 text-center"><div><ShieldCheck className="mx-auto size-8 text-cyan-300/60" /><p className="mt-3 text-sm font-medium">No model is called before policy passes</p><p className="mt-1 text-xs text-muted-foreground">Submit the envelope to see the complete trace.</p></div></div> : <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${decision.outcome === 'DENY' ? 'border-rose-400/20 bg-rose-400/6' : decision.outcome === 'ALLOW' ? 'border-emerald-400/20 bg-emerald-400/6' : 'border-amber-400/20 bg-amber-400/6'}`}><p className="font-mono text-lg font-semibold">{decision.outcome}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{decision.decisionId} · risk {decision.risk.toFixed(2)}</p></div>
          <div className="grid gap-3 sm:grid-cols-2"><ResultFact label="Route" value={decision.selectedRoute ?? 'No provider called'} /><ResultFact label="Cost" value={`$${decision.estimatedCostUsd.toFixed(4)}`} /><ResultFact label="Policy" value={`v${decision.policyVersion}`} /><ResultFact label="Content logged" value="false" /></div>
          <div className="flex flex-wrap gap-1.5">{decision.reasonCodes.map((code) => <Badge key={code} variant="outline" className="border-white/10 font-mono text-[10px] text-muted-foreground">{code}</Badge>)}</div>
          <div><p className="eyebrow mb-2">Stage timings</p><div className="space-y-1">{decision.trace.map((stage) => <div key={stage.stage} className="flex justify-between text-[11px] text-muted-foreground"><span className="font-mono">{stage.stage}</span><span>{stage.ms} ms</span></div>)}</div></div>
          {decision.outcome === 'REQUIRE_APPROVAL' && <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4"><p className="text-sm font-medium">Exact-scope approval required</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Binds tenant, request hash, tool, arguments, expiry, and one-time nonce.</p><div className="mt-3 flex gap-2"><Button size="sm" onClick={approveAndConsume} className="bg-amber-300 text-slate-950 hover:bg-amber-200">Approve & execute once</Button>{approval && <Button size="sm" variant="outline" onClick={replay}><RotateCcw />Replay approval</Button>}</div>{approvalStatus && <p className={`mt-3 text-xs ${approvalStatus.includes('blocked') ? 'text-rose-300' : 'text-emerald-300'}`}>{approvalStatus}</p>}</div>}
        </div>}
      </CardContent></Card>
    </div>
  </>;
}

function PoliciesView() {
  const [candidate, setCandidate] = useState<'strict' | 'balanced'>('balanced');
  const changes = candidate === 'strict' ? 28 : 7;
  return <><PageHeading eyebrow="Policy governance" title="Change policy without changing code." description="Replay sanitized decision metadata against an immutable candidate. Simulation never invokes a model or modifies the active policy." action={<Button variant="outline"><FileCheck2 />Export YAML</Button>} />
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr]"><Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Versions</p><CardTitle>Policy registry</CardTitle></CardHeader><CardContent className="space-y-3 pt-4">
      <PolicyRow version="2.0.0" name="enterprise-default" status="ACTIVE" meta="Scored engine · approved by sec-approver" />
      <button type="button" onClick={() => setCandidate('balanced')} className={`w-full text-left ${candidate === 'balanced' ? 'ring-1 ring-cyan-400/35 rounded-xl' : ''}`}><PolicyRow version="2.1.0-rc2" name="balanced-routing" status="CANDIDATE" meta="Authored by platform-author · 7 changes" /></button>
      <button type="button" onClick={() => setCandidate('strict')} className={`w-full text-left ${candidate === 'strict' ? 'ring-1 ring-cyan-400/35 rounded-xl' : ''}`}><PolicyRow version="2.1.0-rc1" name="strict-egress" status="CANDIDATE" meta="Authored by platform-author · 28 changes" /></button>
    </CardContent></Card>
    <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Candidate replay</p><CardTitle>{changes} decisions would change</CardTitle></CardHeader><CardContent className="pt-5"><div className="grid gap-3 sm:grid-cols-3"><ResultFact label="Allow → deny" value={String(candidate === 'strict' ? 21 : 2)} /><ResultFact label="Route changed" value={String(candidate === 'strict' ? 6 : 5)} /><ResultFact label="Approval added" value={String(candidate === 'strict' ? 1 : 0)} /></div><div className="mt-5 space-y-3">{['Schema validation', 'Security regression', 'Cost budget replay', 'Author / approver separation'].map((item) => <div key={item} className="flex items-center justify-between rounded-lg border border-white/7 p-3 text-xs"><span className="text-muted-foreground">{item}</span><span className="flex items-center gap-1.5 text-emerald-300"><CheckCircle2 className="size-3.5" />PASS</span></div>)}</div><Button disabled className="mt-4 w-full">Independent approval required</Button></CardContent></Card></div>
    <p className="mt-4 text-xs text-muted-foreground">Illustrative only — this panel demonstrates the governance workflow with sample numbers; wiring it to replay the real session audit trail against an edited threshold set is tracked in the README roadmap.</p>
  </>;
}

function PolicyRow({ version, name, status, meta }: { version: string; name: string; status: string; meta: string }) { return <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">{name}</p><p className="mt-1 text-xs text-muted-foreground">{meta}</p></div><div className="text-right"><Badge variant="outline" className={status === 'ACTIVE' ? 'border-emerald-400/25 text-emerald-300' : 'border-amber-400/25 text-amber-300'}>{status}</Badge><p className="mt-2 font-mono text-[10px] text-muted-foreground">v{version}</p></div></div></div>; }

function EvaluationsView() { return <><PageHeading eyebrow="Evaluation harness" title="Security, quality, and cost—together." description="Metrics stay segmented by source and attack family so aggregate performance cannot hide a failed category. Figures below are from the repository's fixture-based test run, not live telemetry." action={<Button className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"><Play />Run deterministic suite</Button>} /><div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={ShieldCheck} label="Attack recall" value="93.8%" detail="target ≥ 90%" tone="cyan" /><Metric icon={ShieldX} label="Benign block" value="3.1%" detail="target ≤ 5%" tone="emerald" /><Metric icon={Gauge} label="Quality pass" value="96.4%" detail="−1.2 pp vs strong" tone="amber" /><Metric icon={CircleDollarSign} label="Safe success / $" value="487" detail="+52% vs baseline" tone="rose" /></div><Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Fixture run · npm test</p><CardTitle>Source and family breakdown</CardTitle></CardHeader><CardContent className="overflow-x-auto pt-2"><table className="w-full min-w-[680px] text-left text-xs"><thead className="text-[10px] uppercase tracking-[.13em] text-muted-foreground"><tr>{['Source', 'Family', 'Cases', 'Attack recall', 'Benign blocked', 'Gate'].map((heading) => <th key={heading} className="border-b border-white/8 px-3 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{evaluationRows.map((row) => <tr key={`${row.source}-${row.family}`} className="border-b border-white/6 last:border-0"><td className="px-3 py-4 font-medium">{row.source}</td><td className="px-3 py-4 text-muted-foreground">{row.family}</td><td className="px-3 py-4 font-mono">{row.cases}</td><td className="px-3 py-4 font-mono">{row.recall}</td><td className="px-3 py-4 font-mono">{row.blocked}</td><td className="px-3 py-4"><Badge className="bg-emerald-400/10 text-emerald-300">{row.status}</Badge></td></tr>)}</tbody></table></CardContent></Card></>; }

function DataReleasesView() {
  const [selectedId, setSelectedId] = useState(publicDatasetRegistry.sources[0].id);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [limit, setLimit] = useState(200);
  const [copied, setCopied] = useState(false);
  const selected = publicDatasetRegistry.sources.find((source) => source.id === selectedId) ?? publicDatasetRegistry.sources[0];
  const command = sourceCommand(selected, limit);
  const canEnable = selected.status === 'ready' || selected.status === 'ready_local_results';

  async function copyCommand() {
    if (navigator.clipboard) await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function toggleSource() {
    setEnabled((current) => current.includes(selected.id) ? current.filter((id) => id !== selected.id) : [...current, selected.id]);
  }

  return <>
    <PageHeading eyebrow="Dataset supply chain" title="Connect reviewed public evidence." description="Choose a source at runtime, inspect its immutable pin and licence, then run an explicit local import. Network access and activation stay off by default." action={<Badge variant="outline" className="border-cyan-400/25 bg-cyan-400/8 text-cyan-300"><CloudDownload /> Optional integrations</Badge>} />
    <div className="grid gap-5 xl:grid-cols-[minmax(340px,.75fr)_minmax(0,1.25fr)]">
      <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Public source registry</p><CardTitle>{enabled.length} enabled for this session</CardTitle></CardHeader><CardContent className="space-y-2 pt-4">
        {publicDatasetRegistry.sources.map((source) => {
          const active = selectedId === source.id;
          const on = enabled.includes(source.id);
          return <button type="button" aria-label={`Inspect ${source.name}`} key={source.id} onClick={() => { setSelectedId(source.id); setCopied(false); }} className={`w-full rounded-xl border p-3 text-left transition ${active ? 'border-cyan-400/35 bg-cyan-400/6' : 'border-white/7 bg-white/[0.015] hover:bg-white/[0.035]'}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium">{source.name}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{source.id}</p></div><Badge variant="outline" className={on ? 'border-emerald-400/25 text-emerald-300' : 'border-white/10 text-muted-foreground'}>{on ? 'ENABLED' : `P${source.priority}`}</Badge></div>
            <div className="mt-3 flex flex-wrap gap-1.5"><Badge variant="outline" className="border-white/8 text-[10px] text-muted-foreground">{source.lane.replaceAll('_', ' ')}</Badge><Badge variant="outline" className="border-white/8 text-[10px] text-muted-foreground">{source.integration.replaceAll('_', ' ')}</Badge></div>
          </button>;
        })}
      </CardContent></Card>

      <div className="grid gap-5">
        <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Integration plan</p><CardTitle className="mt-1">{selected.name}</CardTitle></div><a href={selected.source_url} target="_blank" rel="noreferrer" aria-label={`Open ${selected.name} source`} className="rounded-lg border border-white/10 p-2 text-muted-foreground hover:text-foreground"><ExternalLink className="size-4" /></a></div></CardHeader><CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-3"><ResultFact label="Revision" value={selected.revision} /><ResultFact label="Licence" value={selected.license} /><ResultFact label="Mode" value={selected.integration.replaceAll('_', ' ')} /></div>
          {selected.integration === 'direct_import' && <label className="mt-5 block text-xs font-medium text-muted-foreground">Maximum cases · {limit.toLocaleString()}<input aria-label="Maximum imported cases" type="range" min="25" max="1000" step="25" value={limit} onChange={(event) => setLimit(Number(event.target.value))} className="mt-3 w-full accent-cyan-400" /></label>}
          <div className={`mt-5 rounded-xl border p-4 ${canEnable ? 'border-cyan-400/20 bg-cyan-400/5' : 'border-amber-400/20 bg-amber-400/5'}`}><p className="text-xs font-medium">{canEnable ? 'Ready for explicit local integration' : 'Review required before raw-content import'}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{selected.integration === 'direct_import' ? 'The runner fetches only pinned data files, verifies SHA-256, redacts detected identifiers, writes raw bytes to quarantine, and creates a pending-review release.' : selected.integration === 'result_adapter' ? 'SentinelForge accepts recorded benchmark results only. It never installs or executes AgentDojo inside the gateway.' : 'Inspect the manifest, provide an immutable revision and approved licence decision, then add a source-specific parser before enabling.'}</p></div>
          <div className="mt-4 rounded-xl border border-white/8 bg-black/25 p-3"><p className="eyebrow">Run locally</p><code className="mt-2 block overflow-x-auto whitespace-nowrap font-mono text-[11px] text-cyan-200">{command}</code></div>
          <div className="mt-4 flex flex-wrap gap-2"><Button onClick={toggleSource} disabled={!canEnable} className="bg-cyan-400 text-slate-950 hover:bg-cyan-300">{enabled.includes(selected.id) ? <Check /> : <CloudDownload />}{enabled.includes(selected.id) ? 'Enabled for session' : 'Enable option'}</Button><Button variant="outline" onClick={copyCommand}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy command'}</Button></div>
        </CardContent></Card>

        <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Non-negotiable controls</p><CardTitle>Import does not mean activation</CardTitle></CardHeader><CardContent className="grid gap-3 pt-4 sm:grid-cols-2">{['Network disabled unless --network is present', 'Licence acceptance required per import', 'External holdout excluded from training', 'Human review required before activation'].map((control) => <div key={control} className="flex items-start gap-2 rounded-lg border border-white/7 p-3 text-xs text-muted-foreground"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />{control}</div>)}</CardContent></Card>
      </div>
    </div>
  </>;
}

function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof ShieldCheck; label: string; value: string; detail: string; tone: 'cyan' | 'rose' | 'emerald' | 'amber' }) { return <Card className="surface-card" size="sm"><CardContent className="flex items-start gap-3"><div className={`metric-icon metric-${tone}`}><Icon className="size-4" /></div><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tracking-[-0.03em]">{value}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p></div></CardContent></Card>; }
function ResultFact({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-white/6 bg-white/[0.025] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-1.5 truncate text-xs font-medium">{value}</p></div>; }
