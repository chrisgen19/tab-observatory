import type { Mapping, ProcessSample, TabLike } from '../shared/model.ts';

export const isScannable = (tab: TabLike): boolean =>
  /^https?:/.test(tab.url || '') && !tab.discarded && !tab.incognito;

const pidGone = (pid: number, mapping: Mapping, byPid: Map<number, ProcessSample>) => {
  const process = byPid.get(pid);
  // A process born after the mapping is a recycled PID, not the one we mapped.
  return !process || (process.createdAt != null && process.createdAt * 1000 > mapping.at);
};

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
