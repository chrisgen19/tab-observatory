import type { RankedEntry, RankedTab } from '../../shared/ranking.ts';
import { formatBytes } from '../../shared/format.ts';

const matches = (tab: RankedTab, needle: string) =>
  [tab.title, tab.url ?? '', ...tab.pids.map(String)].some(text => text.toLowerCase().includes(needle));

/**
 * Case-insensitive filter on title, URL and PID. A shared group stays whole when any member
 * matches: its memory figures and "Sleep all" cover every tab, so hiding members would make the
 * button act on a subset that cannot free the shared memory.
 */
export function filterEntries(entries: RankedEntry[], needle: string): RankedEntry[] {
  const query = needle.trim().toLowerCase();
  if (!query) return entries;
  return entries.filter(entry => entry.kind === 'tab'
    ? matches(entry.tab, query)
    : entry.tabs.some(tab => matches(tab, query)));
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Bar segments as percentages of the largest freed amount; own + shared never exceeds 100. */
export function barWidths(tab: RankedTab, maxFrees: number): { own: number; shared: number } {
  if (maxFrees <= 0) return { own: 0, shared: 0 };
  const own = Math.min(100, ((tab.freesBytes ?? 0) / maxFrees) * 100);
  const shared = Math.min(100 - own, (tab.sharedBytes / maxFrees) * 100);
  return { own: round(own), shared: round(shared) };
}

export const groupLabel = (count: number): string => count === 2 ? 'Sleep both' : `Sleep all ${count}`;

export function canAct(tab: RankedTab, extensionId: string): { focus: boolean; sleep: boolean; close: boolean } {
  if (tab.url?.startsWith(`chrome-extension://${extensionId}/`)) return { focus: false, sleep: false, close: false };
  return { focus: true, sleep: tab.state !== 'sleeping', close: true };
}

export function stateTag(tab: RankedTab): string | null {
  switch (tab.state) {
    case 'scanning': return 'Scanning…';
    case 'pending': return 'Not scanned yet';
    case 'error': return `Mapping failed: ${tab.status}`;
    case 'partial': return 'Partial';
    case 'sleeping': return 'Sleeping';
    case 'restricted': return 'Restricted';
    default: return null;
  }
}

/** A tab whose memory is all shared frees nothing on its own, so it shows the unknown-value placeholder. */
export const freesLabel = (tab: RankedTab): string => {
  if (tab.freesBytes == null) return '';
  if (tab.freesBytes === 0 && tab.sharedBytes > 0) return formatBytes(null);
  return `${tab.estimated ? '≈ ' : ''}${formatBytes(tab.freesBytes)}`;
};

export type GroupSleepResult = { slept: number; total: number; failures: { tabId: number; title: string; error: string }[] };

/** Null when every tab slept; otherwise names each tab Chrome refused and why. */
export const groupResultMessage = (result: GroupSleepResult): string | null =>
  result.failures.length
    ? `Slept ${result.slept} of ${result.total}. ${result.failures.map(f => `${f.title || 'A tab'}: ${f.error}`).join('; ')}`
    : null;
