import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconnectDelay } from '../src/dashboard/lib/reconnect.ts';

test('reconnect delay backs off and caps at 10 s', () => {
  assert.deepEqual([0, 1, 2, 5].map(reconnectDelay), [1000, 2000, 4000, 10000]);
});
