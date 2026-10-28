import type { OwnedProcess, TabRow } from '../../shared/model.ts';

export type ProcessSort = { key: 'rssBytes' | 'privateBytes' | 'cpuPercent'; descending: boolean };
export type ProcessView = { owned: { process: OwnedProcess; tabs: TabRow[] }[]; unowned: OwnedProcess[] };

/** Unknown values always sink to the bottom, whichever direction is chosen. */
const compare = (sort: ProcessSort) => (a: OwnedProcess, b: OwnedProcess) => {
  const x = a[sort.key], y = b[sort.key];
  if (x == null) return y == null ? 0 : 1;
  if (y == null) return -1;
  return sort.descending ? y - x : x - y;
};

export function groupProcesses(processes: OwnedProcess[], tabs: TabRow[], sort: ProcessSort): ProcessView {
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  const sorted = [...processes].sort(compare(sort));
  return {
    owned: sorted.filter(p => p.tabIds.length).map(process => ({
      process, tabs: process.tabIds.flatMap(id => byId.get(id) ?? []),
    })),
    unowned: sorted.filter(p => !p.tabIds.length),
  };
}

export const ariaSort = (sort: ProcessSort, key: ProcessSort['key']): 'ascending' | 'descending' | 'none' =>
  sort.key !== key ? 'none' : sort.descending ? 'descending' : 'ascending';

const hit = (process: OwnedProcess, tabs: TabRow[], query: string) =>
  [process.kind, String(process.pid), ...tabs.flatMap(tab => [tab.title, tab.url ?? ''])]
    .some(text => text.toLowerCase().includes(query));

/** Same filter box as the tab list: matches process kind, PID, or a nested tab's title or URL. */
export function filterProcessView(view: ProcessView, needle: string): ProcessView {
  const query = needle.trim().toLowerCase();
  if (!query) return view;
  return {
    owned: view.owned.filter(entry => hit(entry.process, entry.tabs, query)),
    unowned: view.unowned.filter(process => hit(process, [], query)),
  };
}
