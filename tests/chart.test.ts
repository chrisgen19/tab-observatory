import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartPath, chartScale, chartWindow, nearestPoint, sampleEvery, seriesValues } from '../src/dashboard/lib/chart.ts';

test('scale is auto-ranged, not from zero', () => {
  const s = chartScale([2.7e9, 3.1e9], 64 * 1024 ** 2);
  assert.ok(s.min > 2.6e9 && s.min < 2.7e9);
  assert.ok(s.max > 3.1e9 && s.max < 3.2e9);
  assert.deepEqual(s.ticks, [s.min, (s.min + s.max) / 2, s.max]);
});

test('flat series still gets the minimum span and never goes below zero', () => {
  const s = chartScale([10, 10], 64);
  assert.ok(s.max - s.min >= 64);
  assert.ok(s.min >= 0);
  const empty = chartScale([], 5);
  assert.deepEqual([empty.min, empty.max], [0, 5]);
});

test('path maps time to x and value to y', () => {
  assert.equal(chartPath([{ at: 0, value: 0 }, { at: 10, value: 10 }], { min: 0, max: 10 }, { from: 0, to: 10 }, { width: 100, height: 50 }),
    'M0.0,50.0 L100.0,0.0');
  assert.equal(chartPath([], { min: 0, max: 1 }, { from: 0, to: 1 }, { width: 10, height: 10 }), '');
});

test('series drops old points and, for cpu, unknown samples', () => {
  const history = [{ at: 1, rssBytes: 5, cpuPercent: null }, { at: 2, rssBytes: 6, cpuPercent: 4 }];
  assert.deepEqual(seriesValues(history, 'cpu', 0), [{ at: 2, value: 4 }]);
  assert.deepEqual(seriesValues(history, 'memory', 2), [{ at: 2, value: 6 }]);
});

test('nearestPoint', () => {
  assert.equal(nearestPoint([{ at: 0 }, { at: 10 }], 7)?.at, 10);
  assert.equal(nearestPoint([], 7), null);
});

test('sampleEvery keeps the latest point of each step for the table view', () => {
  const points = [0, 20, 61, 70, 130].map(at => ({ at: at * 1000, value: at }));
  assert.deepEqual(sampleEvery(points, 60000).map(p => p.value), [20, 70, 130]);
});

test('chartWindow starts at the first sample until 15 minutes of history exist', () => {
  const window = 15 * 60000;
  assert.deepEqual(chartWindow([{ at: 970000 }, { at: 1000000 }], 1000000, window), { from: 970000, to: 1000000 });
  assert.deepEqual(chartWindow([{ at: 0 }, { at: 1000000 }], 1000000, window), { from: 100000, to: 1000000 });
  assert.deepEqual(chartWindow([], 1000000, window), { from: 100000, to: 1000000 });
});
