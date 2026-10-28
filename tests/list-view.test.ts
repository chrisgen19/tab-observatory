import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barWidths, canAct, filterEntries, freesLabel, groupLabel, groupResultMessage, stateTag } from '../src/dashboard/lib/list-view.ts';
import type { RankedEntry, RankedTab } from '../src/shared/ranking.ts';
import { formatBytes } from '../src/shared/format.ts';

const tab: RankedTab = {
  id: 1, title: 'Lofi beats stream - YouTube', url: 'https://youtube.test/watch', discarded: false, pids: [10],
  status: 'Mapped', mappedAt: 1, rssBytes: 1, privateBytes: 1, cpuPercent: null, jsHeapBytes: null, sharedPids: [],
  state: 'mapped', freesBytes: 812, sharedBytes: 0, estimated: false,
};
const gmail: RankedTab = { ...tab, id: 2, title: 'Inbox (12) - Gmail', url: 'https://mail.test/', pids: [20, 30], freesBytes: 96, sharedBytes: 210 };
const calendar: RankedTab = { ...tab, id: 3, title: 'Calendar', url: 'https://calendar.test/', pids: [21, 30], freesBytes: 41, sharedBytes: 210 };
const entries: RankedEntry[] = [
  { kind: 'tab', tab },
  { kind: 'group', id: '2-3', tabs: [gmail, calendar], sharedPids: [30], sharedBytes: 210, freesBytes: 347, estimated: false, partial: false },
];

test('filter keeps the whole shared group when any member matches, so Sleep all targets every tab', () => {
  const out = filterEntries(entries, 'GMAIL');
  assert.deepEqual(out.map(e => e.kind === 'group' ? e.tabs.map(t => t.id) : e.tab.id), [[2, 3]]);
  assert.equal(out[0], entries[1], 'the group entry is unchanged, so its totals and targets match');
});

test('filter matches URLs and PIDs; empty needle keeps everything', () => {
  assert.deepEqual(filterEntries(entries, 'youtube.test').map(e => e.kind), ['tab']);
  assert.deepEqual(filterEntries(entries, '30').map(e => e.kind === 'group' && e.tabs.length), [2]);
  assert.equal(filterEntries(entries, '  ').length, 2);
});

test('bar widths scale to the largest entry and never exceed 100', () => {
  assert.deepEqual(barWidths({ ...tab, freesBytes: 96, sharedBytes: 210 }, 812), { own: 11.8, shared: 25.9 });
  assert.deepEqual(barWidths({ ...tab, freesBytes: 812, sharedBytes: 210 }, 812), { own: 100, shared: 0 });
  assert.deepEqual(barWidths({ ...tab, freesBytes: null, sharedBytes: 0 }, 0), { own: 0, shared: 0 });
});

test('group label', () => {
  assert.equal(groupLabel(2), 'Sleep both');
  assert.equal(groupLabel(3), 'Sleep all 3');
});

test('the dashboard tab cannot be acted on; sleeping tabs cannot sleep again', () => {
  assert.deepEqual(canAct({ ...tab, url: 'chrome-extension://abc/dashboard.html' }, 'abc'), { focus: false, sleep: false, close: false });
  assert.deepEqual(canAct({ ...tab, state: 'sleeping', discarded: true }, 'abc'), { focus: true, sleep: false, close: true });
  assert.deepEqual(canAct(tab, 'abc'), { focus: true, sleep: true, close: true });
});

test('state tags and frees labels', () => {
  assert.equal(stateTag({ ...tab, state: 'scanning' }), 'Scanning…');
  assert.equal(stateTag({ ...tab, state: 'pending' }), 'Not scanned yet');
  assert.equal(stateTag({ ...tab, state: 'error', status: 'Tab scan timed out' }), 'Mapping failed: Tab scan timed out');
  assert.equal(stateTag({ ...tab, state: 'partial' }), 'Partial');
  assert.equal(stateTag(tab), null);
  assert.equal(freesLabel({ ...tab, freesBytes: 812 * 1024 ** 2 }), '812.0 MB');
  assert.equal(freesLabel({ ...tab, freesBytes: 812 * 1024 ** 2, estimated: true }), '≈ 812.0 MB');
  assert.equal(freesLabel({ ...tab, freesBytes: null }), '');
});

test('a grouped tab with no exclusive memory shows the unknown-value placeholder, not 0.0 MB', () => {
  assert.equal(freesLabel({ ...tab, freesBytes: 0, sharedBytes: 210 }), formatBytes(null));
  assert.equal(freesLabel({ ...tab, freesBytes: 0, sharedBytes: 0 }), '0.0 MB');
});

test('group sleep result names the tabs Chrome refused', () => {
  assert.equal(groupResultMessage({ slept: 2, total: 2, failures: [] }), null);
  assert.equal(groupResultMessage({ slept: 1, total: 2, failures: [
    { tabId: 2, title: 'Inbox (12) - Gmail', error: 'Chrome would not sleep this tab (it may be the active tab)' },
  ] }), 'Slept 1 of 2. Inbox (12) - Gmail: Chrome would not sleep this tab (it may be the active tab)');
});
