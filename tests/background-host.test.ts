import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePort, installFakeChrome, uninstallFakeChrome } from './helpers/fake-chrome.ts';
import type { DashboardState } from '../src/shared/protocol.ts';

test('a companion error is pushed to an idle dashboard', async () => {
  let samples = 0;
  const fake = installFakeChrome({
    tabs: [],
    sendCommand: async () => ({}),
    snapshot: () => ++samples === 1
      ? { type: 'snapshot', at: Date.now(), platform: 'test', warnings: [], processes: [] }
      : { error: 'Companion crashed' },
  });
  await import('../src/background/index.ts');
  const port = createFakePort();
  fake.chrome.runtime.onConnect.emit(port);
  const states = (): DashboardState[] => port.sent.filter(m => m.kind === 'state').map(m => m.state);
  try {
    port.emit({ id: 'start-1', type: 'start' });
    const end = Date.now() + 8000;
    while (!states().some(s => s.hostError === 'Companion crashed') && Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(states().some(s => s.hostError === 'Companion crashed'), 'The dashboard must learn the companion failed');
  } finally {
    port.emit({ id: 'stop-1', type: 'stop' });
    await new Promise(resolve => setTimeout(resolve, 400));
    uninstallFakeChrome();
  }
});
