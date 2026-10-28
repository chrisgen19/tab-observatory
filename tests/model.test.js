import { test } from 'node:test';
import assert from 'node:assert/strict';
import { associate, totals, framesFromEvents } from '../extension/model.js';

const now = 1000000;
const tabs = [1, 2].map(id => ({ id, title: `Tab ${id}`, url: `https://example.com/${id}` }));
const maps = Object.fromEntries(tabs.map(t => [t.id, { at: now, url: t.url, pids: [42, 42], jsHeapBytes: 20 }]));
const processes = [{ pid: 42, rssBytes: 100, privateBytes: 80, cpuPercent: 5 }];

test('shared process is explicitly marked; browser total counts it once', () => {
  const result = associate(tabs, maps, processes, now);
  assert.deepEqual(result.tabs.map(t => t.sharedPids), [[42], [42]]);
  assert.deepEqual(result.processes[0].tabIds, [1, 2]);
  assert.equal(totals([...processes, ...processes]).rssBytes, 100);
  assert.equal(result.tabs[0].rssBytes, 100);
});

test('stale, navigated, discarded and recycled PID mappings are not reported', () => {
  assert.equal(associate(tabs, maps, processes, now + 60001).tabs[0].rssBytes, null);
  assert.equal(associate([{ ...tabs[0], url: 'https://new.test' }], maps, processes, now).tabs[0].rssBytes, null);
  assert.equal(associate([{ ...tabs[0], discarded: true }], maps, processes, now).tabs[0].rssBytes, null);
  assert.equal(associate(tabs, maps, [{ ...processes[0], createdAt: now / 1000 + 1 }], now).tabs[0].rssBytes, null);
});

test('missing private memory and first CPU samples stay unknown', () => {
  const partial = [{ ...processes[0], privateBytes: null, cpuPercent: null }];
  assert.equal(totals(partial).privateBytes, null);
  assert.equal(totals(partial).cpuPercent, null);
  assert.equal(associate(tabs, maps, partial, now).tabs[0].cpuPercent, null);
});

test('frame metadata follows process changes and ignores unrelated trace payloads', () => {
  const frames = framesFromEvents([
    { name: 'TracingStartedInBrowser', args: { data: { frames: [{ frame: 'a', processPseudoId: 'x' }] } } },
    { name: 'ProcessReadyInBrowser', args: { data: { frame: 'a', processId: 42 } } },
    { name: 'Other', args: { data: { frame: 'b', processId: 90 } } },
    { name: 'FrameCommittedInBrowser', args: { data: { frame: 'a', processId: 55 } } },
  ]);
  assert.deepEqual(frames, [{ frame: 'a', processId: 55 }]);
});

test('missing iframe attribution is explicitly partial', () => {
  const partial = { ...maps, 1: { ...maps[1], frameCount: 2, mappedFrameCount: 1 } };
  assert.equal(associate(tabs, partial, processes, now).tabs[0].status, 'Partial (1/2 frames)');
});
