// Client-side session audit trail. Persisted to localStorage so a reload
// doesn't lose the trail, but this is a demo convenience, not the durable,
// server-side audit log docs/SPEC.md's FR-010 describes — see README's
// "Known limitations" for what a production deployment needs instead.

import type { Decision } from './policy-engine';

export type AuditEntry = {
  timestamp: string;
  decisionId: string;
  outcome: Decision['outcome'];
  risk: number;
  reasonCodes: string[];
  selectedRoute: string | null;
  estimatedCostUsd: number;
  promptPreview: string; // truncated; content is never logged in full, matching the gateway's "prompt content is never written to audit logs" claim
};

const STORAGE_KEY = 'sentinelforge.audit_log';
const MAX_ENTRIES = 50;

export function toAuditEntry(decision: Decision, prompt: string): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    decisionId: decision.decisionId,
    outcome: decision.outcome,
    risk: decision.risk,
    reasonCodes: decision.reasonCodes,
    selectedRoute: decision.selectedRoute,
    estimatedCostUsd: decision.estimatedCostUsd,
    promptPreview: prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt,
  };
}

export function loadAuditLog(): AuditEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuditEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendAuditEntry(entry: AuditEntry): AuditEntry[] {
  const next = [entry, ...loadAuditLog()].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode, quota) — keep working in-memory only
  }
  return next;
}

export function clearAuditLog(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function toJsonl(entries: AuditEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
}
