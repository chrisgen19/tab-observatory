import type { OwnedProcess, TabRow } from './model.ts';

export type TabState = 'mapped' | 'partial' | 'scanning' | 'pending' | 'error' | 'restricted' | 'sleeping';

export type RankedTab = TabRow & { state: TabState; freesBytes: number | null; sharedBytes: number; estimated: boolean };

export type RankedEntry =
  | { kind: 'tab'; tab: RankedTab }
  | { kind: 'group'; id: string; tabs: RankedTab[]; sharedPids: number[]; sharedBytes: number; freesBytes: number; estimated: boolean; partial: boolean };

export type Ranking = { entries: RankedEntry[]; restricted: RankedTab[]; unscannedCount: number; notInAnyTabBytes: number };

const UNMAPPED_ORDER: TabState[] = ['scanning', 'pending', 'error'];

const tabState = (row: TabRow, scanningTabId: number | null): TabState => {
  if (row.discarded) return 'sleeping';
  if (!/^https?:/.test(row.url || '')) return 'restricted';
  if (row.id === scanningTabId) return 'scanning';
  if (row.pids.length) return row.status.startsWith('Partial') ? 'partial' : 'mapped';
  return row.status === 'Awaiting scan' ? 'pending' : 'error';
};

/** Private memory is what closing frees; resident memory stands in when USS is unavailable. */
const processValue = (process: OwnedProcess) =>
  ({ bytes: process.privateBytes ?? process.rssBytes, estimated: process.privateBytes == null });

function rankTab(row: TabRow, byPid: Map<number, OwnedProcess>, scanningTabId: number | null): RankedTab {
  const state = tabState(row, scanningTabId);
  if (state !== 'mapped' && state !== 'partial') return { ...row, state, freesBytes: null, sharedBytes: 0, estimated: false };
  let freesBytes = 0, sharedBytes = 0, estimated = false;
  for (const pid of row.pids) {
    const process = byPid.get(pid);
    if (!process) continue;
    const value = processValue(process);
    estimated ||= value.estimated;
    if (process.tabIds.length > 1) sharedBytes += value.bytes;
    else freesBytes += value.bytes;
  }
  return { ...row, state, freesBytes, sharedBytes, estimated };
}

/** Connected components of tabs linked through shared processes (union-find keyed by tab id). */
function componentsOf(processes: OwnedProcess[]) {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (const process of processes) {
    if (process.tabIds.length > 1) {
      for (const other of process.tabIds.slice(1)) parent.set(find(other), find(process.tabIds[0]));
    }
  }
  return find;
}

const byFrees = (a: { freesBytes: number | null }, b: { freesBytes: number | null }) => (b.freesBytes ?? 0) - (a.freesBytes ?? 0);

function toGroup(tabs: RankedTab[], processes: OwnedProcess[]): RankedEntry {
  const members = new Set(tabs.map(t => t.id));
  const shared = processes.filter(p => p.tabIds.length > 1 && p.tabIds.some(id => members.has(id)));
  const sharedValues = shared.map(processValue);
  const sharedBytes = sharedValues.reduce((n, v) => n + v.bytes, 0);
  return {
    kind: 'group',
    id: [...members].sort((a, b) => a - b).join('-'),
    tabs: [...tabs].sort(byFrees),
    sharedPids: shared.map(p => p.pid).sort((a, b) => a - b),
    sharedBytes,
    freesBytes: tabs.reduce((n, t) => n + (t.freesBytes ?? 0), 0) + sharedBytes,
    estimated: tabs.some(t => t.estimated) || sharedValues.some(v => v.estimated),
    partial: tabs.some(t => t.state === 'partial'),
  };
}

/** Ranks tabs by memory freed if closed; tabs sharing a process become one group entry. */
export function rankTabs(rows: TabRow[], processes: OwnedProcess[], scanningTabId: number | null): Ranking {
  const byPid = new Map(processes.map(p => [p.pid, p]));
  const ranked = rows.map(row => rankTab(row, byPid, scanningTabId));
  const restricted = ranked.filter(t => t.state === 'restricted' || t.state === 'sleeping');
  const mapped = ranked.filter(t => t.state === 'mapped' || t.state === 'partial');
  const unmapped = ranked.filter(t => UNMAPPED_ORDER.includes(t.state))
    .sort((a, b) => UNMAPPED_ORDER.indexOf(a.state) - UNMAPPED_ORDER.indexOf(b.state));
  const find = componentsOf(processes);
  const components = new Map<number, RankedTab[]>();
  for (const tab of mapped) components.set(find(tab.id), [...(components.get(find(tab.id)) ?? []), tab]);
  const grouped: RankedEntry[] = [...components.values()].map(tabs =>
    tabs.length > 1 ? toGroup(tabs, processes) : { kind: 'tab', tab: tabs[0] });
  const freesOf = (entry: RankedEntry) => ({ freesBytes: entry.kind === 'tab' ? entry.tab.freesBytes : entry.freesBytes });
  grouped.sort((a, b) => byFrees(freesOf(a), freesOf(b)));
  return {
    entries: [...grouped, ...unmapped.map((tab): RankedEntry => ({ kind: 'tab', tab }))],
    restricted,
    unscannedCount: unmapped.filter(t => t.state !== 'error').length,
    notInAnyTabBytes: processes.filter(p => !p.tabIds.length).reduce((n, p) => n + p.rssBytes, 0),
  };
}
