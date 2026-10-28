import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandSchema } from '../src/shared/protocol.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

test('CommandSchema accepts an action and rejects a bad tab id', () => {
  assert.ok(CommandSchema.safeParse({ id: 'a', type: 'sleep', tabId: 3, url: 'https://x.test' }).success);
  assert.ok(!CommandSchema.safeParse({ id: 'a', type: 'sleep', tabId: 'x', url: 'https://x.test' }).success);
});

test('CommandSchema requires at least one sleepGroup target and valid settings', () => {
  assert.ok(!CommandSchema.safeParse({ id: 'a', type: 'sleepGroup', targets: [] }).success);
  assert.ok(CommandSchema.safeParse({ id: 'a', type: 'saveSettings', settings: DEFAULT_SETTINGS }).success);
  assert.ok(!CommandSchema.safeParse({ id: 'a', type: 'saveSettings', settings: { ...DEFAULT_SETTINGS, thresholdMb: 1 } }).success);
  assert.ok(!CommandSchema.safeParse({ id: 'a', type: 'bogus' }).success);
});
