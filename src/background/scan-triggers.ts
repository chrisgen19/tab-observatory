import { FROZEN_TAB, type Mapping, type ProcessSample, type TabLike } from '../shared/model.ts';

export const isScannable = (tab: TabLike): boolean =>
  /^https?:/.test(tab.url || '') && !tab.discarded && !tab.incognito;

const pidGone = (pid: number, mapping: Mapping, byPid: Map<number, ProcessSample>) => {
  const process = byPid.get(pid);
  // Missing counts as gone only once a sample has shown it alive; the companion may never
  // report some processes (unrecognised helper names, access denied), which must not loop.
  if (!process) return !!mapping.seenPids?.includes(pid);
  // A process born after the mapping is a recycled PID, not the one we mapped.
  return process.createdAt != null && process.createdAt * 1000 > mapping.at;
};

/** Records which mapped PIDs this sample reported, so their later absence means they exited. */
export function markSeenPids(mappings: Record<number, Mapping>, processes: ProcessSample[]): void {
  const present = new Set(processes.map(p => p.pid));
  for (const mapping of Object.values(mappings)) {
    const seen = new Set(mapping.seenPids);
    for (const pid of mapping.pids) if (present.has(pid)) seen.add(pid);
    if (seen.size) mapping.seenPids = [...seen];
  }
}

/**
 * A same-document URL change (pushState, hash) keeps the renderer, so the mapping follows the
 * new URL; a page load or discard drops it.
 */
export function mappingAfterUpdate(mapping: Mapping | undefined, change: chrome.tabs.OnUpdatedInfo): Mapping | undefined {
  if (!mapping || change.status === 'loading' || change.discarded) return undefined;
  return change.url ? { ...mapping, url: change.url } : mapping;
}

/**
 * Chrome unfreezes a tab when it becomes active, so a frozen-tab failure is retried then.
 * Other scan errors would fail again, so they keep waiting for navigation or a full refresh.
 */
export const rescanOnActivation = (mapping: Mapping | undefined): boolean => mapping?.error === FROZEN_TAB;

/**
 * Scannable tabs whose mapping is missing or no longer trustworthy. Failed scans are
 * retried only after navigation (or a full refresh), so a stuck tab is not rescanned every sample.
 */
export function staleTabIds(tabs: TabLike[], mappings: Record<number, Mapping>, processes: ProcessSample[]): number[] {
  const byPid = new Map(processes.map(p => [p.pid, p]));
  return tabs.filter(tab => {
    if (tab.id == null || !isScannable(tab)) return false;
    const mapping = mappings[tab.id];
    if (!mapping || mapping.url !== tab.url) return true;
    if (mapping.error) return false;
    return mapping.pids.some(pid => pidGone(pid, mapping, byPid));
  }).map(tab => tab.id!);
}
