import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, SettingsInputSchema, parseSettings } from '../src/shared/settings.ts';

test('defaults match the spec', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { thresholdMb: 1000, theme: 'system', fullRefreshMinutes: 5, showRestricted: false });
});

test('parseSettings keeps valid fields and defaults the rest', () => {
  assert.deepEqual(parseSettings({ thresholdMb: 1200 }), { ...DEFAULT_SETTINGS, thresholdMb: 1200 });
  assert.deepEqual(parseSettings({ thresholdMb: 5, theme: 'neon', fullRefreshMinutes: 7 }), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('garbage'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings({ theme: 'dark', fullRefreshMinutes: 0, showRestricted: true }),
    { ...DEFAULT_SETTINGS, theme: 'dark', fullRefreshMinutes: 0, showRestricted: true });
});

test('SettingsInputSchema rejects out-of-range thresholds with the spec message', () => {
  for (const thresholdMb of [99, 100001, 150.5]) {
    const result = SettingsInputSchema.safeParse({ ...DEFAULT_SETTINGS, thresholdMb });
    assert.match(result.error!.issues[0].message, /Threshold must be 100 to 100,000 MB/);
  }
  assert.ok(SettingsInputSchema.safeParse({ ...DEFAULT_SETTINGS, thresholdMb: 100000 }).success);
});

test('SettingsInputSchema rejects unknown keys and bad enum values', () => {
  assert.ok(!SettingsInputSchema.safeParse({ ...DEFAULT_SETTINGS, extra: 1 }).success);
  assert.ok(!SettingsInputSchema.safeParse({ ...DEFAULT_SETTINGS, fullRefreshMinutes: 7 }).success);
});
