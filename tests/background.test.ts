import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome, uninstallFakeChrome, type FakeChrome } from './helpers/fake-chrome.ts';

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
  const send = (command: string): Promise<any> => new Promise(resolve => fake.messageHandler()!({ command }, {
    id: fake.chrome.runtime.id, url: fake.chrome.runtime.getURL('dashboard.html'),
  }, resolve));
  try {
    const initial = await send('start');
    assert.equal(initial.scanning, true);
    let state;
    const end = Date.now() + 9000;
    do {
      await new Promise(resolve => setTimeout(resolve, 20));
      state = await send('state');
    } while (state.scanning && Date.now() < end);
    assert.equal(state.scanning, false, 'Scan must complete despite the stuck browser command');
    assert.match(state.tabs[0].status, /timed out/);
    assert.equal(state.tabs[1].rssBytes, 1024);
    assert.equal(state.tabs[1].jsHeapBytes, 128);
    assert.equal(fake.attached.size, 0);
  } finally {
    await send('stop');
    uninstallFakeChrome();
  }
});
