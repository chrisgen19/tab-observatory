import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAgo, formatBytes, formatDelta, formatPercent, formatSpan } from '../src/shared/format.ts';

test('formatBytes matches today', () => {
  assert.equal(formatBytes(null), '—');
  assert.equal(formatBytes(1024 ** 3 * 3.12), '3.12 GB');
  assert.equal(formatBytes(96 * 1024 ** 2), '96.0 MB');
});

test('formatPercent', () => {
  assert.equal(formatPercent(null), '—');
  assert.equal(formatPercent(23.04), '23.0%');
});

test('formatAgo', () => {
  assert.equal(formatAgo(5000, 10000), 'just now');
  assert.equal(formatAgo(0, 42000), '42 s ago');
  assert.equal(formatAgo(0, 180000), '3 min ago');
});

test('formatDelta signs the change and names the span it covers', () => {
  const quarter = 15 * 60000;
  assert.equal(formatDelta([{ at: 0, rssBytes: 100 * 1024 ** 2 }, { at: quarter, rssBytes: 510 * 1024 ** 2 }]), '+410.0 MB in 15 min');
  assert.equal(formatDelta([{ at: 0, rssBytes: 510 * 1024 ** 2 }, { at: quarter, rssBytes: 100 * 1024 ** 2 }]), '-410.0 MB in 15 min');
  assert.equal(formatDelta([{ at: 0, rssBytes: 0 }, { at: 30000, rssBytes: 1024 ** 2 }]), '+1.0 MB in 30 s');
  assert.equal(formatDelta([{ at: 0, rssBytes: 1 }]), '');
});

test('formatSpan', () => {
  assert.equal(formatSpan(30000), '30 s');
  assert.equal(formatSpan(4 * 60000 + 20000), '4 min');
});
