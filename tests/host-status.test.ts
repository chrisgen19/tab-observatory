import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeHostError } from '../src/dashboard/lib/host-status.ts';

test('a missing or forbidden companion asks for setup', () => {
  for (const error of [
    'Specified native messaging host not found.',
    'Access to the specified native messaging host is forbidden.',
    'Companion is not connected',
  ]) assert.equal(describeHostError(error).kind, 'missing', error);
  assert.match(describeHostError('Specified native messaging host not found.').message,
    /Check the companion installation in the setup panel and retry monitoring\.$/);
});

test('a companion that dropped shows only its error', () => {
  const status = describeHostError('Native host has exited.');
  assert.deepEqual(status, { kind: 'dropped', message: 'Native host has exited.' });
});

test('waiting for a sample and no error are not notices', () => {
  assert.equal(describeHostError('Waiting for a fresh companion sample').kind, 'waiting');
  assert.equal(describeHostError('').kind, 'none');
});
