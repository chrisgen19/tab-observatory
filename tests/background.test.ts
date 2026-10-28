import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePort, installFakeChrome, uninstallFakeChrome, type FakeChrome } from './helpers/fake-chrome.ts';
import type { DashboardState } from '../src/shared/protocol.ts';

test('a hung first tab does not block memory readings from the next tab', async () => {
  const tabs = [1, 2].map(id => ({ id, title: `Tab ${id}`, url: `https://example.test/${id}` }));
  let marker: string | undefined;
  let fake: FakeChrome;
  fake = installFakeChrome({
    tabs,
    sendCommand: async (target, method, params) => {
      const emit = fake.chrome.debugger.onEvent.emit;
      if (target.tabId === 1 && method === 'Page.getFrameTree') return new Promise(() => {});
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'root' } } };
      if (method === 'Runtime.getHeapUsage') return { usedSize: 128 };
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
  const states = (): DashboardState[] => port.sent.filter(m => m.kind === 'state').map(m => m.state);
  try {
    port.emit({ id: 'start-1', type: 'start' });
    let state: DashboardState | undefined;
    const end = Date.now() + 9000;
    do {
      await new Promise(resolve => setTimeout(resolve, 20));
      state = states().at(-1);
    } while (!(state?.running && !state.scanning && state.at) && Date.now() < end);
    assert.ok(states().some(s => s.running && s.scanning), 'A scanning state is pushed after start');
    assert.equal(state!.scanning, false, 'Scan must complete despite the stuck browser command');
    assert.equal(state!.tabs[0].status, 'Tab is frozen in the background');
    assert.equal(state!.tabs[1].rssBytes, 1024);
    assert.equal(state!.tabs[1].jsHeapBytes, 128);
    assert.equal(fake.attached.size, 0);
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
