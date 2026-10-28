import { test } from 'node:test';
import assert from 'node:assert/strict';

const event = () => {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.forEach(fn => fn(...args)) };
};

test('a hung first tab does not block memory readings from the next tab', async () => {
  const tabs = [1, 2].map(id => ({ id, title: `Tab ${id}`, url: `https://example.test/${id}` }));
  const attached = new Set();
  let marker;
  let messageHandler;
  let storedRunning = false;
  const chrome = globalThis.chrome = {
    action: { onClicked: event(), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: {
      id: 'test-extension', getURL: name => `chrome-extension://test-extension/${name}`,
      onMessage: { addListener: listener => { messageHandler = listener; } },
      connectNative: () => {
        const connection = { onMessage: event(), onDisconnect: event(), disconnect() {}, postMessage() {
          queueMicrotask(() => connection.onMessage.emit({ type: 'snapshot', at: Date.now(), platform: 'test', warnings: [],
            processes: [{ pid: 42, rssBytes: 1024, privateBytes: 512, cpuPercent: 1 }] }));
        } };
        return connection;
      },
    },
    tabs: { query: async () => tabs, get: async id => tabs.find(t => t.id === id), onUpdated: event(), onRemoved: event() },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: event() },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({ running: storedRunning }), set: async value => { storedRunning = value.running; } },
    },
    debugger: {
      onEvent: event(), onDetach: event(),
      attach: async target => { attached.add(target.tabId); },
      detach: async target => { attached.delete(target.tabId); },
      sendCommand: async (target, method, params) => {
        if (target.tabId === 1 && method === 'Page.getFrameTree') return new Promise(() => {});
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'root' } } };
        if (method === 'Runtime.getHeapUsage') return { usedSize: 128 };
        if (method === 'Runtime.enable') chrome.debugger.onEvent.emit(target, 'Runtime.executionContextCreated', {
          context: { id: 1, auxData: { isDefault: true, frameId: 'root' } },
        });
        if (method === 'Runtime.evaluate') marker = JSON.parse(params.expression.slice('console.timeStamp('.length, -1));
        if (method === 'Tracing.end') {
          chrome.debugger.onEvent.emit(target, 'Tracing.dataCollected', { value: [{ name: 'TimeStamp', pid: 42, args: { data: { message: marker } } }] });
          chrome.debugger.onEvent.emit(target, 'Tracing.tracingComplete', {});
        }
        return {};
      },
    },
  };
  await import('../extension/background.js');
  const send = command => new Promise(resolve => messageHandler({ command }, {
    id: chrome.runtime.id, url: chrome.runtime.getURL('dashboard.html'),
  }, resolve));
  try {
    const initial = await send('start');
    assert.equal(initial.scanning, true);
    let state;
    const end = Date.now() + 7000;
    do {
      await new Promise(resolve => setTimeout(resolve, 20));
      state = await send('state');
    } while (state.scanning && Date.now() < end);
    assert.equal(state.scanning, false, 'Scan must complete despite the stuck browser command');
    assert.match(state.tabs[0].status, /timed out/);
    assert.equal(state.tabs[1].rssBytes, 1024);
    assert.equal(state.tabs[1].jsHeapBytes, 128);
    assert.equal(attached.size, 0);
  } finally {
    await send('stop');
    delete globalThis.chrome;
  }
});
