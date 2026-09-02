'use client';

import { useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, ChevronDown, CircleDollarSign, Clock3, Command, Database, FileCheck2, Gauge, GitBranch, LayoutDashboard, LockKeyhole, Play, RotateCcw, ShieldCheck, ShieldX, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { consumeApproval, createApproval, decide, evaluationRows, scenarioRequests, type ApprovalRecord, type Decision } from '@/lib/gateway';

const scenarios = [
  { id: 'public-summary', label: 'Public summary' },
  { id: 'complex-architecture', label: 'Complex architecture' },
  { id: 'prompt-injection', label: 'Indirect injection' },
  { id: 'elevated-tool', label: 'Elevated tool call' },
  { id: 'secret-exfiltration', label: 'Secret exfiltration' },
  { id: 'budget-abuse', label: 'Denial of wallet' },
];

const navItems = [[LayoutDashboard, 'Overview'], [ShieldCheck, 'Gateway'], [FileCheck2, 'Policies'], [Activity, 'Evaluations'], [GitBranch, 'Data releases']] as const;

export function SentinelConsole() {
  const [activeView, setActiveView] = useState('Overview');
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [result, setResult] = useState<Decision>(() => decide(scenarioRequests['public-summary']));
  const [running, setRunning] = useState(false);
  const selected = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0];
  const selectedRequest = scenarioRequests[selected.id];
  const allowed = result.outcome === 'ALLOW';
  const denied = result.outcome === 'DENY';

  function runScenario() {
    setRunning(true);
    window.setTimeout(() => { setResult(decide(selectedRequest)); setRunning(false); }, 520);
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
            <Badge variant="outline" className="hidden border-emerald-500/25 bg-emerald-500/8 text-emerald-300 sm:inline-flex"><span className="size-1.5 rounded-full bg-emerald-400" /> All systems nominal</Badge>
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
          <div className="mt-8 px-2"><p className="eyebrow">Active policy</p><div className="mt-3 rounded-xl border border-white/8 bg-white/[0.025] p-3"><div className="flex items-center justify-between text-xs font-medium"><span>enterprise-default</span><Badge variant="outline" className="border-cyan-400/20 text-cyan-300">v1.4.2</Badge></div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">18 rules · content logging off · local region</p></div></div>
        </aside>

        <section className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {activeView !== 'Overview' ? <FeatureView view={activeView} onNavigate={setActiveView} /> : <>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div><div className="mb-2 flex items-center gap-2"><span className="h-px w-6 bg-cyan-400" /><p className="eyebrow text-cyan-300">Live operations</p></div><h1 className="font-heading text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Security posture, spend control.</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Every model request is authenticated, inspected, policy-bound, and routed to the least expensive compliant model.</p></div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />Updated 8 seconds ago</div>
          </div>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={ShieldCheck} label="Protected requests" value="12,842" detail="99.18% allowed safely" tone="cyan" />
            <Metric icon={ShieldX} label="Threats blocked" value="104" detail="+16% vs prior window" tone="rose" />
            <Metric icon={CircleDollarSign} label="Cost avoided" value="$1,284" detail="34.2% below baseline" tone="emerald" />
            <Metric icon={Gauge} label="Gateway p95" value="68 ms" detail="52 ms under SLO" tone="amber" />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)]">
            <Card className="surface-card min-h-[450px]">
              <CardHeader className="border-b border-white/8 pb-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Decision workbench</p><CardTitle className="mt-1 text-lg">Replay a gateway scenario</CardTitle></div><Badge variant="outline" className="border-white/10 bg-white/4 text-muted-foreground"><Sparkles />Zero-key simulation</Badge></div></CardHeader>
              <CardContent className="pt-5">
                <div className="grid gap-3 md:grid-cols-[210px_minmax(0,1fr)]">
                  <label className="text-xs font-medium text-muted-foreground">Scenario<div className="relative mt-2"><select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)} className="field-control w-full appearance-none pr-9">{scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div></label>
                  <label className="text-xs font-medium text-muted-foreground">Request payload<textarea className="field-control mt-2 min-h-24 w-full resize-none font-mono text-[12px] leading-5" value={selectedRequest.prompt} readOnly /></label>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground"><LockKeyhole className="mr-1.5 inline size-3.5" />Prompt content is never written to audit logs.</p><Button onClick={runScenario} disabled={running} className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"><Play className="size-3.5 fill-current" />{running ? 'Evaluating…' : 'Run through gateway'}</Button></div>
                <div className="mt-6 rounded-xl border border-white/8 bg-black/20 p-4" aria-live="polite">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><div className={`grid size-8 place-items-center rounded-lg ${allowed ? 'bg-emerald-400/12 text-emerald-300' : denied ? 'bg-rose-400/12 text-rose-300' : 'bg-amber-400/12 text-amber-300'}`}>{allowed ? <CheckCircle2 className="size-4" /> : denied ? <ShieldX className="size-4" /> : <LockKeyhole className="size-4" />}</div><div><p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Policy outcome</p><p className="font-mono text-sm font-semibold">{running ? 'EVALUATING' : result.outcome}</p></div></div><span className="font-mono text-[11px] text-muted-foreground">{result.decisionId}</span></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3"><ResultFact label="Selected route" value={running ? '—' : result.selectedRoute ?? 'No provider called'} /><ResultFact label="Estimated cost" value={running ? '—' : `$${result.estimatedCostUsd.toFixed(4)}`} /><ResultFact label="Gateway latency" value={running ? '—' : `${result.gatewayLatencyMs} ms`} /></div>
                  <div className="mt-4 flex flex-wrap gap-1.5">{!running && result.reasonCodes.map((reason) => <Badge key={reason} variant="outline" className="border-white/10 bg-white/[0.035] font-mono text-[10px] text-muted-foreground">{reason}</Badge>)}</div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-5">
              <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Routing efficiency</p><CardTitle className="mt-1">Spend follows complexity</CardTitle></CardHeader><CardContent className="pt-5"><div className="flex items-end justify-between"><div><p className="text-3xl font-semibold tracking-tight">34.2%</p><p className="mt-1 text-xs text-muted-foreground">estimated cost reduction</p></div><Badge className="bg-emerald-400/10 text-emerald-300">Healthy</Badge></div><div className="mt-5 space-y-3"><RouteBar label="fake-small" value={63} color="bg-cyan-400" /><RouteBar label="fake-medium" value={25} color="bg-violet-400" /><RouteBar label="fake-strong" value={12} color="bg-amber-400" /></div></CardContent></Card>
              <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Release evidence</p><CardTitle className="mt-1">All mandatory gates pass</CardTitle></CardHeader><CardContent className="space-y-3 pt-4">{['Attack recall ≥ 90%', 'Benign block ≤ 5%', 'Cross-split leakage = 0', 'Independent approval recorded'].map((gate) => <div key={gate} className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">{gate}</span><CheckCircle2 className="size-4 text-emerald-400" /></div>)}<Button variant="ghost" size="sm" className="mt-1 w-full justify-between text-cyan-300 hover:bg-cyan-400/8 hover:text-cyan-200">Review evidence bundle<ArrowRight /></Button></CardContent></Card>
            </div>
          </div></>}
        </section>
      </div>
    </main>
  );
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

  function evaluate() {
    const next = decide({ ...scenarioRequests['public-summary'], requestId: `req-live-${Date.now()}`, prompt, qualityFloor: quality, requestedTools: prompt.toLowerCase().includes('restart') ? ['restart_service'] : [] });
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
    <PageHeading eyebrow="Gateway lab" title="Inspect a live request." description="Run arbitrary text through the deterministic guard, policy, budget, and route selection pipeline. Nothing leaves this browser." action={<Badge variant="outline" className="border-emerald-400/25 bg-emerald-400/8 text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-400" /> Local only</Badge>} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
      <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">OpenAI-compatible request</p><CardTitle>Request envelope</CardTitle></CardHeader><CardContent className="space-y-4 pt-5">
        <label className="block text-xs font-medium text-muted-foreground">Messages[0].content<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="field-control mt-2 min-h-44 w-full resize-y font-mono text-xs leading-5" /></label>
        <div className="grid gap-3 sm:grid-cols-3"><ResultFact label="Tenant" value="acme-demo" /><ResultFact label="Region" value="local" /><ResultFact label="Max cost" value="$0.0100" /></div>
        <label className="block text-xs font-medium text-muted-foreground">Quality floor · {quality.toFixed(2)}<input aria-label="Quality floor" type="range" min="0.7" max="0.96" step="0.01" value={quality} onChange={(event) => setQuality(Number(event.target.value))} className="mt-3 w-full accent-cyan-400" /></label>
        <Button onClick={evaluate} className="w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300"><Play className="fill-current" />Evaluate request</Button>
      </CardContent></Card>
      <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Decision trace</p><CardTitle>{decision ? decision.outcome : 'Awaiting request'}</CardTitle></CardHeader><CardContent className="pt-5">
        {!decision ? <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-white/10 text-center"><div><ShieldCheck className="mx-auto size-8 text-cyan-300/60" /><p className="mt-3 text-sm font-medium">No model is called before policy passes</p><p className="mt-1 text-xs text-muted-foreground">Submit the envelope to see the complete trace.</p></div></div> : <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${decision.outcome === 'DENY' ? 'border-rose-400/20 bg-rose-400/6' : decision.outcome === 'ALLOW' ? 'border-emerald-400/20 bg-emerald-400/6' : 'border-amber-400/20 bg-amber-400/6'}`}><p className="font-mono text-lg font-semibold">{decision.outcome}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{decision.decisionId}</p></div>
          <div className="grid gap-3 sm:grid-cols-2"><ResultFact label="Route" value={decision.selectedRoute ?? 'No provider called'} /><ResultFact label="Cost" value={`$${decision.estimatedCostUsd.toFixed(4)}`} /><ResultFact label="Policy" value={`v${decision.policyVersion}`} /><ResultFact label="Content logged" value="false" /></div>
          <div className="flex flex-wrap gap-1.5">{decision.reasonCodes.map((code) => <Badge key={code} variant="outline" className="border-white/10 font-mono text-[10px] text-muted-foreground">{code}</Badge>)}</div>
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
      <PolicyRow version="1.4.2" name="enterprise-default" status="ACTIVE" meta="18 rules · approved by sec-approver" />
      <button type="button" onClick={() => setCandidate('balanced')} className={`w-full text-left ${candidate === 'balanced' ? 'ring-1 ring-cyan-400/35 rounded-xl' : ''}`}><PolicyRow version="1.5.0-rc2" name="balanced-routing" status="CANDIDATE" meta="Authored by platform-author · 7 changes" /></button>
      <button type="button" onClick={() => setCandidate('strict')} className={`w-full text-left ${candidate === 'strict' ? 'ring-1 ring-cyan-400/35 rounded-xl' : ''}`}><PolicyRow version="1.5.0-rc1" name="strict-egress" status="CANDIDATE" meta="Authored by platform-author · 28 changes" /></button>
    </CardContent></Card>
    <Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Candidate replay</p><CardTitle>{changes} decisions would change</CardTitle></CardHeader><CardContent className="pt-5"><div className="grid gap-3 sm:grid-cols-3"><ResultFact label="Allow → deny" value={String(candidate === 'strict' ? 21 : 2)} /><ResultFact label="Route changed" value={String(candidate === 'strict' ? 6 : 5)} /><ResultFact label="Approval added" value={String(candidate === 'strict' ? 1 : 0)} /></div><div className="mt-5 space-y-3">{['Schema validation', 'Security regression', 'Cost budget replay', 'Author / approver separation'].map((item) => <div key={item} className="flex items-center justify-between rounded-lg border border-white/7 p-3 text-xs"><span className="text-muted-foreground">{item}</span><span className="flex items-center gap-1.5 text-emerald-300"><CheckCircle2 className="size-3.5" />PASS</span></div>)}</div><Button disabled className="mt-4 w-full">Independent approval required</Button></CardContent></Card></div>
  </>;
}

function PolicyRow({ version, name, status, meta }: { version: string; name: string; status: string; meta: string }) { return <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">{name}</p><p className="mt-1 text-xs text-muted-foreground">{meta}</p></div><div className="text-right"><Badge variant="outline" className={status === 'ACTIVE' ? 'border-emerald-400/25 text-emerald-300' : 'border-amber-400/25 text-amber-300'}>{status}</Badge><p className="mt-2 font-mono text-[10px] text-muted-foreground">v{version}</p></div></div></div>; }

function EvaluationsView() { return <><PageHeading eyebrow="Evaluation harness" title="Security, quality, and cost—together." description="Metrics stay segmented by source and attack family so aggregate performance cannot hide a failed category." action={<Button className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"><Play />Run deterministic suite</Button>} /><div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={ShieldCheck} label="Attack recall" value="93.8%" detail="target ≥ 90%" tone="cyan" /><Metric icon={ShieldX} label="Benign block" value="3.1%" detail="target ≤ 5%" tone="emerald" /><Metric icon={Gauge} label="Quality pass" value="96.4%" detail="−1.2 pp vs strong" tone="amber" /><Metric icon={CircleDollarSign} label="Safe success / $" value="487" detail="+52% vs baseline" tone="rose" /></div><Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Immutable run · eval_2026_09_02_01</p><CardTitle>Source and family breakdown</CardTitle></CardHeader><CardContent className="overflow-x-auto pt-2"><table className="w-full min-w-[680px] text-left text-xs"><thead className="text-[10px] uppercase tracking-[.13em] text-muted-foreground"><tr>{['Source', 'Family', 'Cases', 'Attack recall', 'Benign blocked', 'Gate'].map((heading) => <th key={heading} className="border-b border-white/8 px-3 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{evaluationRows.map((row) => <tr key={`${row.source}-${row.family}`} className="border-b border-white/6 last:border-0"><td className="px-3 py-4 font-medium">{row.source}</td><td className="px-3 py-4 text-muted-foreground">{row.family}</td><td className="px-3 py-4 font-mono">{row.cases}</td><td className="px-3 py-4 font-mono">{row.recall}</td><td className="px-3 py-4 font-mono">{row.blocked}</td><td className="px-3 py-4"><Badge className="bg-emerald-400/10 text-emerald-300">{row.status}</Badge></td></tr>)}</tbody></table></CardContent></Card></>; }

function DataReleasesView() { const gates = ['Canonical schema', 'Provenance & licence', 'Privacy & canary scan', 'Exact / near dedupe', 'Holdout isolation', 'Human review']; return <><PageHeading eyebrow="Dataset supply chain" title="Evidence before activation." description="Public content stays disabled by default, pinned to immutable revisions, quarantined, normalized, and reviewed before it can enter a release." action={<Button variant="outline"><Database />Inspect manifest</Button>} /><div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)]"><Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Release registry</p><CardTitle>sf-dataset-2026.09.02-rc1</CardTitle></CardHeader><CardContent className="pt-5"><div className="grid gap-3 sm:grid-cols-4"><ResultFact label="Cases" value="1,000" /><ResultFact label="Sources" value="3" /><ResultFact label="Rejected" value="12" /><ResultFact label="Leakage" value="0" /></div><div className="mt-5 space-y-2">{[['Repository synthetic','enabled','1,000 cases'],['Dolly 15k','reviewed fixture','80 cases'],['BIPIA test','external holdout','120 isolated'],['AgentDojo','disabled','adapter only']].map(([name,status,count]) => <div key={name} className="flex items-center justify-between rounded-lg border border-white/7 p-3"><div><p className="text-xs font-medium">{name}</p><p className="mt-1 text-[11px] text-muted-foreground">{count}</p></div><Badge variant="outline" className="border-white/10 text-muted-foreground">{status}</Badge></div>)}</div></CardContent></Card><Card className="surface-card"><CardHeader className="border-b border-white/8 pb-4"><p className="eyebrow">Activation gates</p><CardTitle>6 of 6 pass</CardTitle></CardHeader><CardContent className="space-y-3 pt-5">{gates.map((gate) => <div key={gate} className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{gate}</span><CheckCircle2 className="size-4 text-emerald-400" /></div>)}<div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4"><p className="text-xs font-medium text-amber-200">Activation remains human-gated</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">The importing service cannot approve its own release, and approval cannot waive a failed gate.</p></div><Button disabled className="w-full">Awaiting data-release approver</Button></CardContent></Card></div></>; }

function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof ShieldCheck; label: string; value: string; detail: string; tone: 'cyan' | 'rose' | 'emerald' | 'amber' }) { return <Card className="surface-card" size="sm"><CardContent className="flex items-start gap-3"><div className={`metric-icon metric-${tone}`}><Icon className="size-4" /></div><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tracking-[-0.03em]">{value}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p></div></CardContent></Card>; }
function ResultFact({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-white/6 bg-white/[0.025] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-1.5 truncate text-xs font-medium">{value}</p></div>; }
function RouteBar({ label, value, color }: { label: string; value: number; color: string }) { return <div><div className="mb-1.5 flex justify-between font-mono text-[11px]"><span className="text-muted-foreground">{label}</span><span>{value}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/6"><div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} /></div></div>; }
