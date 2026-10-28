import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDeadline, withTimeout } from '../extension/deadline.js';

test('an unresponsive browser command expires and prevents later commands', async () => {
  const deadline = scanDeadline(() => true, 1000, 20);
  await assert.rejects(deadline.run(() => new Promise(() => {}), 'Frozen page'), /timed out/);
  let called = false;
  await assert.rejects(deadline.run(() => { called = true; }, 'Later command'), /timed out/);
  assert.equal(called, false);
});

test('whole-tab budget limits multiple individually responsive commands', async () => {
  const deadline = scanDeadline(() => true, 30, 1000);
  await deadline.run(() => new Promise(resolve => setTimeout(resolve, 15)), 'First');
  await assert.rejects(deadline.run(() => new Promise(resolve => setTimeout(resolve, 40)), 'Second'), /timed out/);
});

test('stopping monitoring prevents queued work; cleanup is bounded', async () => {
  const deadline = scanDeadline(() => false);
  await assert.rejects(deadline.run(() => assert.fail('Must not execute'), 'Command'), /stopped/);
  await assert.rejects(withTimeout(() => new Promise(() => {}), 10, 'Detach'), /Detach timed out/);
});
