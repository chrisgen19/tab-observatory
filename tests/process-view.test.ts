import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ariaSort, filterProcessView, groupProcesses } from '../src/dashboard/lib/process-view.ts';
import type { OwnedProcess, TabRow } from '../src/shared/model.ts';

const row = (id: number, title: string): TabRow => ({
  id, title, url: `https://example.test/${id}`, discarded: false, pids: [], status: 'Mapped', mappedAt: 1,
  rssBytes: null, privateBytes: null, cpuPercent: null, jsHeapBytes: null, sharedPids: [],
});
const proc = (pid: number, kind: string, tabIds: number[], rssBytes: number, privateBytes: number | null = rssBytes): OwnedProcess =>
  ({ pid, kind, tabIds, rssBytes, privateBytes, cpuPercent: null });
const rows = [row(1, 'YouTube'), row(2, 'Gmail'), row(3, 'Calendar')];
const procs = [
  proc(10, 'renderer', [1], 300), proc(30, 'renderer', [2, 3], 500),
  proc(1, 'browser', [], 200), proc(2, 'gpu-process', [], 400),
];

test('owned processes carry their tabs; unowned are separate', () => {
  const v = groupProcesses(procs, rows, { key: 'rssBytes', descending: true });
  assert.deepEqual(v.owned.map(o => [o.process.pid, o.tabs.map(t => t.id)]), [[30, [2, 3]], [10, [1]]]);
  assert.deepEqual(v.unowned.map(p => p.kind), ['gpu-process', 'browser']);
});

test('null values sort last in both directions', () => {
  const withNull = [...procs, proc(3, 'utility', [], 100, null)];
  for (const descending of [true, false]) {
    const v = groupProcesses(withNull, rows, { key: 'privateBytes', descending });
    assert.equal(v.unowned.at(-1)!.pid, 3, `descending=${descending}`);
  }
  assert.deepEqual(groupProcesses(procs, rows, { key: 'rssBytes', descending: false }).unowned.map(p => p.pid), [1, 2]);
});

test('ariaSort', () => {
  assert.equal(ariaSort({ key: 'cpuPercent', descending: false }, 'cpuPercent'), 'ascending');
  assert.equal(ariaSort({ key: 'cpuPercent', descending: true }, 'cpuPercent'), 'descending');
  assert.equal(ariaSort({ key: 'cpuPercent', descending: true }, 'rssBytes'), 'none');
});

test('filter matches kind, PID or a nested tab title', () => {
  const v = groupProcesses(procs, rows, { key: 'rssBytes', descending: true });
  assert.deepEqual(filterProcessView(v, 'browser').unowned.map(p => p.pid), [1]);
  assert.deepEqual(filterProcessView(v, 'gmail').owned.map(o => o.process.pid), [30]);
  assert.deepEqual(filterProcessView(v, '10').owned.map(o => o.process.pid), [10]);
  assert.equal(filterProcessView(v, ' ').owned.length, 2);
});
