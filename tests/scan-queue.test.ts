import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScanQueue } from '../src/background/scan-queue.ts';

function setup(scanTab?: (id: number) => Promise<void>) {
  const scanned: number[] = [];
  const progress: unknown[] = [];
  let active = 0, maxConcurrent = 0;
  const queue = createScanQueue({
    debounceMs: 10,
    isActive: () => true,
    onProgress: (p, tabId) => { progress.push(p ? [p.current, p.total, tabId] : [null, tabId]); },
    scanTab: scanTab ?? (async id => {
      active++; maxConcurrent = Math.max(maxConcurrent, active);
      scanned.push(id);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
    }),
  });
  return { queue, scanned, progress, maxConcurrent: () => maxConcurrent };
}

test('dedupes and scans one tab at a time in enqueue order', async () => {
  const { queue, scanned, maxConcurrent } = setup();
  queue.enqueue([1, 2]); queue.enqueue([2, 3]);
  await queue.idle();
  assert.deepEqual(scanned, [1, 2, 3]);
  assert.equal(maxConcurrent(), 1);
});

test('reports progress and clears it when idle', async () => {
  const { queue, progress } = setup();
  queue.enqueue([1, 2]);
  await queue.idle();
  assert.deepEqual(progress, [[1, 2, 1], [2, 2, 2], [null, null]]);
});

test('clear stops pending work', async () => {
  const { queue, scanned } = setup();
  queue.enqueue([1, 2, 3]); queue.clear();
  await queue.idle();
  assert.deepEqual(scanned, []);
});

test('enqueueing the tab being scanned does not rescan it', async () => {
  const scanned: number[] = [];
  let queue: ReturnType<typeof createScanQueue>;
  ({ queue } = setup(async id => { scanned.push(id); queue.enqueue([id]); }));
  queue.enqueue([1]);
  await queue.idle();
  assert.deepEqual(scanned, [1]);
});

test('tabs enqueued mid-run grow the total and busy() covers the debounce', async () => {
  let queue: ReturnType<typeof createScanQueue>;
  let progress: unknown[];
  ({ queue, progress } = setup(async id => { if (id === 1) queue.enqueue([2]); }));
  assert.equal(queue.busy(), false);
  queue.enqueue([1]);
  assert.equal(queue.busy(), true);
  await queue.idle();
  assert.deepEqual(progress, [[1, 1, 1], [2, 2, 2], [null, null]]);
  assert.equal(queue.busy(), false);
});
