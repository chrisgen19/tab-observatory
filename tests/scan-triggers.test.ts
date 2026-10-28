import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isScannable, mappingAfterUpdate, markSeenPids, staleTabIds } from '../src/background/scan-triggers.ts';
import type { Mapping, ProcessSample } from '../src/shared/model.ts';

const tab = (id: number, extra = {}) => ({ id, url: `https://example.test/${id}`, ...extra });
const mapping = (id: number, pids: number[], extra: Partial<Mapping> = {}): Mapping =>
  ({ at: 10_000, url: `https://example.test/${id}`, pids, jsHeapBytes: null, ...extra });
const procs: ProcessSample[] = [
  { pid: 40, kind: 'renderer', createdAt: 5, rssBytes: 1, privateBytes: 1, cpuPercent: null },
  { pid: 50, kind: 'renderer', createdAt: 11, rssBytes: 1, privateBytes: 1, cpuPercent: null },
];

test('staleTabIds finds new, navigated and dead-process tabs', () => {
  const tabs = [tab(1), tab(2), tab(3), tab(4), tab(6)];
  const mappings = {
    2: mapping(2, [40], { url: 'https://example.test/old' }),
    3: mapping(3, [99], { seenPids: [99] }),
    4: mapping(4, [40]),
    6: mapping(6, [50]), // pid 50 was created after this mapping: a recycled PID
  };
  assert.deepEqual(staleTabIds(tabs, mappings, procs).sort(), [1, 2, 3, 6]);
});

test('staleTabIds skips error mappings unless the URL changed', () => {
  const tab5 = tab(5);
  const errorMapping = mapping(5, [], { error: 'Tab scan timed out; other tabs will continue' });
  assert.deepEqual(staleTabIds([tab5], { 5: errorMapping }, procs), []);
  assert.deepEqual(staleTabIds([tab5], { 5: { ...errorMapping, url: 'https://old.test' } }, procs), [5]);
});

test('isScannable excludes restricted, discarded and incognito tabs', () => {
  assert.equal(isScannable(tab(1)), true);
  assert.equal(isScannable(tab(1, { url: 'chrome://settings' })), false);
  assert.equal(isScannable(tab(1, { discarded: true })), false);
  assert.equal(isScannable(tab(1, { incognito: true })), false);
});

test('a mapped PID the companion never reported does not cause a rescan every sample', () => {
  assert.deepEqual(staleTabIds([tab(3)], { 3: mapping(3, [99]) }, procs), []);
  assert.deepEqual(staleTabIds([tab(3)], { 3: mapping(3, [99], { seenPids: [99] }) }, procs), [3]);
});

test('markSeenPids records mapped PIDs present in a sample', () => {
  const mappings = { 1: mapping(1, [40, 99]), 2: mapping(2, [50], { seenPids: [50] }) };
  markSeenPids(mappings, procs);
  assert.deepEqual(mappings[1].seenPids, [40]);
  assert.deepEqual(mappings[2].seenPids, [50]);
});

test('same-document URL changes keep the mapping; page loads and discards drop it', () => {
  const kept = mapping(1, [40]);
  assert.deepEqual(mappingAfterUpdate(kept, { url: 'https://example.test/1#map=2' }), { ...kept, url: 'https://example.test/1#map=2' });
  assert.equal(mappingAfterUpdate(kept, { status: 'loading', url: 'https://example.test/other' }), undefined);
  assert.equal(mappingAfterUpdate(kept, { status: 'loading' }), undefined);
  assert.equal(mappingAfterUpdate(kept, { discarded: true }), undefined);
  assert.equal(mappingAfterUpdate(kept, { title: 'New title' }), kept);
  assert.equal(mappingAfterUpdate(undefined, { url: 'https://x.test' }), undefined);
});
