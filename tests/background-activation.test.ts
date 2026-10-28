import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePort, installFakeChrome, uninstallFakeChrome, type FakeChrome } from './helpers/fake-chrome.ts';
import { FROZEN_TAB } from '../src/shared/model.ts';
import type { DashboardState } from '../src/shared/protocol.ts';

test('activating a tab that was frozen in the background rescans it', async () => {
  const tabs = [{ id: 1, title: 'Tab 1', url: 'https://example.test/1' }];
  let frozen = true;
  let marker: string | undefined;
  let fake: FakeChrome;
  fake = installFakeChrome({
    tabs,
    sendCommand: async (target, method, params) => {
      const emit = fake.chrome.debugger.onEvent.emit;
      if (method === 'Page.getFrameTree') return frozen ? new Promise(() => {}) : { frameTree: { frame: { id: 'root' } } };
      if (method === 'Runtime.enable') emit(target, 'Runtime.executionContextCreated', {
        context: { id: 1, auxData: { isDefault: true, frameId: 'root' } },
      });
      if (method === 'Runtime.evaluate') marker = JSON.parse(params.expression.slice('console.timeStamp('.length, -1));
      if (method === 'Tracing.end') {
        emit(target, 'Tracing.dataCollected', { value: [{ name: 'TimeStamp', pid: 42, args: { data: { message: marker } } }] });
        emit(target, 'Tracing.tracingComplete', {});
      }
      return {};
    },
  });
  await import('../src/background/index.ts');
  const port = createFakePort();
  fake.chrome.runtime.onConnect.emit(port);
  const latest = (): DashboardState | undefined => port.sent.filter(m => m.kind === 'state').at(-1)?.state;
  const waitFor = async (done: (state: DashboardState) => boolean) => {
    const end = Date.now() + 9000;
    while (!(latest() && done(latest()!)) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
    return latest()!;
  };
  try {
    port.emit({ id: 'start-1', type: 'start' });
    assert.equal((await waitFor(s => s.tabs[0]?.status === FROZEN_TAB)).tabs[0].status, FROZEN_TAB);
    frozen = false;
    fake.chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    const state = await waitFor(s => s.tabs[0]?.pids.includes(42));
    assert.deepEqual(state.tabs[0].pids, [42]);
    assert.notEqual(state.tabs[0].status, FROZEN_TAB);
  } finally {
    port.emit({ id: 'stop-1', type: 'stop' });
    const end = Date.now() + 2000;
    while (!port.sent.some(m => m.kind === 'reply' && m.id === 'stop-1') && Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    // Let the coalesced trailing push (250 ms window) finish before removing the fake chrome.
    await new Promise(resolve => setTimeout(resolve, 300));
    uninstallFakeChrome();
  }
});
