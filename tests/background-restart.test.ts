import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePort, installFakeChrome, uninstallFakeChrome } from './helpers/fake-chrome.ts';
import type { DashboardState } from '../src/shared/protocol.ts';

test('after a service worker restart the first push reflects stored settings and the running flag', async () => {
  const fake = installFakeChrome({
    tabs: [],
    sendCommand: async () => ({}),
    local: { settings: { thresholdMb: 1200, theme: 'dark', fullRefreshMinutes: 5, showRestricted: false } },
    sessionRunning: true,
    storageDelayMs: 100,
  });
  await import('../src/background/index.ts');
  // The dashboard reconnects as soon as the new worker starts, before stored state has loaded.
  const port = createFakePort();
  fake.chrome.runtime.onConnect.emit(port);
  try {
    const end = Date.now() + 2000;
    while (!port.sent.some(m => m.kind === 'state') && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
    const first: DashboardState = port.sent.find(m => m.kind === 'state').state;
    assert.equal(first.running, true, 'must not flash "Paused"');
    assert.equal(first.settings.theme, 'dark', 'must not reset the pinned theme');
    assert.equal(first.settings.thresholdMb, 1200);
  } finally {
    port.emit({ id: 'stop-1', type: 'stop' });
    await new Promise(resolve => setTimeout(resolve, 400));
    uninstallFakeChrome();
  }
});
