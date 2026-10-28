import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTabs, type RankedEntry } from '../src/shared/ranking.ts';
import type { OwnedProcess, TabRow } from '../src/shared/model.ts';

const row = (id: number, pids: number[], extra: Partial<TabRow> = {}): TabRow => ({
  id, title: `Tab ${id}`, url: `https://example.test/${id}`, discarded: false, pids,
  status: pids.length ? 'Mapped' : 'Awaiting scan', mappedAt: pids.length ? 1 : null,
  rssBytes: null, privateBytes: null, cpuPercent: null, jsHeapBytes: null, sharedPids: [], ...extra,
});
const proc = (pid: number, tabIds: number[], privateBytes: number | null, rssBytes = 1000): OwnedProcess => ({
  pid, kind: 'renderer', rssBytes, privateBytes, cpuPercent: null, tabIds,
});
const groupOf = (entry: RankedEntry) => entry as Extract<RankedEntry, { kind: 'group' }>;

test('exclusive memory ranks; shared memory is not counted on each tab', () => {
  const rows = [row(1, [10]), row(2, [20, 30]), row(3, [21, 30])];
  const procs = [proc(10, [1], 800), proc(20, [2], 96), proc(21, [3], 41), proc(30, [2, 3], 210)];
  const r = rankTabs(rows, procs, null);
  assert.deepEqual(r.entries.map(e => e.kind === 'tab' ? e.tab.id : e.id), [1, '2-3']);
  const group = groupOf(r.entries[1]);
  assert.equal(group.freesBytes, 96 + 41 + 210);
  assert.deepEqual(group.tabs.map(t => [t.id, t.freesBytes, t.sharedBytes]), [[2, 96, 210], [3, 41, 210]]);
});

test('transitive sharing forms one group of three', () => {
  const rows = [row(1, [5]), row(2, [5, 6]), row(3, [6])];
  const procs = [proc(5, [1, 2], 100), proc(6, [2, 3], 100)];
  const r = rankTabs(rows, procs, null);
  assert.deepEqual(r.entries.map(e => e.kind === 'group' && e.tabs.length), [3]);
  assert.deepEqual(groupOf(r.entries[0]).sharedPids, [5, 6]);
  assert.equal(groupOf(r.entries[0]).freesBytes, 200);
});

test('falls back to resident memory and marks estimates', () => {
  const rows = [row(1, [10]), row(2, [20])];
  const procs = [proc(10, [1], null, 500), proc(20, [2], null, 900)];
  const r = rankTabs(rows, procs, null);
  assert.deepEqual(r.entries.map(e => e.kind === 'tab' && [e.tab.id, e.tab.freesBytes, e.tab.estimated]), [[2, 900, true], [1, 500, true]]);
});

test('unmapped tabs rank last as scanning, pending, error', () => {
  const rows = [
    row(4, [], { status: 'Tab scan timed out; other tabs will continue' }),
    row(5, []), row(6, []), row(1, [10]),
  ];
  const r = rankTabs(rows, [proc(10, [1], 100)], 6);
  assert.deepEqual(r.entries.map(e => e.kind === 'tab' && [e.tab.id, e.tab.state]), [[1, 'mapped'], [6, 'scanning'], [5, 'pending'], [4, 'error']]);
  assert.equal(r.unscannedCount, 2);
});

test('restricted and sleeping tabs are separated; unowned processes are totalled', () => {
  const rows = [
    row(7, [], { url: 'chrome://settings', status: 'Restricted' }),
    row(8, [], { discarded: true, status: 'Sleeping' }),
    row(1, [10]),
  ];
  const procs = [proc(10, [1], 100), { ...proc(1, [], 50, 300), kind: 'browser' }, { ...proc(2, [], 60, 320), kind: 'gpu-process' }];
  const r = rankTabs(rows, procs, null);
  assert.deepEqual(r.restricted.map(t => [t.id, t.state]), [[7, 'restricted'], [8, 'sleeping']]);
  assert.deepEqual(r.entries.map(e => e.kind === 'tab' && e.tab.id), [1]);
  assert.equal(r.notInAnyTabBytes, 620);
});

test('partial frame mappings mark the tab and its group', () => {
  const rows = [row(2, [30], { status: 'Partial (1/2 frames)' }), row(3, [30])];
  const r = rankTabs(rows, [proc(30, [2, 3], 210)], null);
  assert.equal(groupOf(r.entries[0]).partial, true);
  assert.equal(groupOf(r.entries[0]).tabs.find(t => t.id === 2)!.state, 'partial');
});
