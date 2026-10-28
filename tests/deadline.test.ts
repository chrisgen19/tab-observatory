import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDeadline, withTimeout } from '../src/shared/deadline.ts';

test('an unresponsive browser command expires and prevents later commands', async () => {
  const deadline = scanDeadline(() => true, 1000, 20);
  await assert.rejects(deadline.run(() => new Promise(() => {}), 'Frozen page'), /timed out/);
  let called = false;
  await assert.rejects(deadline.run(() => { called = true; }, 'Later command'), /timed out/);
  assert.equal(called, false);
});

test('whole-tab budget limits multiple individually responsive commands', async () => {
  // Margins sit well above timer granularity (about 15.6 ms on Windows), so the first command
  // always fits the budget and only the second can exceed it.
  const deadline = scanDeadline(() => true, 300, 1000);
  await deadline.run(() => new Promise(resolve => setTimeout(resolve, 100)), 'First');
  await assert.rejects(deadline.run(() => new Promise(resolve => setTimeout(resolve, 500)), 'Second'), /timed out/);
});

test('stopping monitoring prevents queued work; cleanup is bounded', async () => {
  const deadline = scanDeadline(() => false);
  await assert.rejects(deadline.run(() => assert.fail('Must not execute'), 'Command'), /stopped/);
  await assert.rejects(withTimeout(() => new Promise(() => {}), 10, 'Detach'), /Detach timed out/);
});
