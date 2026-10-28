import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeChrome, uninstallFakeChrome, type FakeChrome, type FakeTab } from './helpers/fake-chrome.ts';
import { store, resetStore } from '../src/background/store.ts';
import { scanTab, handleDebuggerEvent, handleDebuggerDetach } from '../src/background/tab-scanner.ts';

const tab = { id: 1, title: 'Tab 1', url: 'https://example.test/1' };

/**
 * Fake CDP for one tab with a root frame and one out-of-process iframe (session s1).
 * Each frame's console.timeStamp marker comes back in the trace with its own PID.
 */
function install(tabs: FakeTab[], options: { detachOnEnd?: boolean } = {}): FakeChrome {
  const markers = new Map<string, string>();
  let fake: FakeChrome;
  fake = installFakeChrome({
    tabs,
    sendCommand: async (target, method, params) => {
      const emit = (source: object, name: string, data: object) => fake.chrome.debugger.onEvent.emit(source, name, data);
      const session = target.sessionId ?? 'root';
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'root' } } };
      if (method === 'Runtime.enable') emit(target, 'Runtime.executionContextCreated', {
        context: { id: session === 'root' ? 1 : 2, auxData: { isDefault: true, frameId: session === 'root' ? 'root' : 'child' } },
      });
      if (method === 'Target.setAutoAttach' && !target.sessionId) {
        emit(target, 'Target.attachedToTarget', { sessionId: 's1', targetInfo: { type: 'iframe' } });
      }
      if (method === 'Runtime.getHeapUsage') return { usedSize: 64 };
      if (method === 'Runtime.evaluate') markers.set(session, JSON.parse(params.expression.slice('console.timeStamp('.length, -1)));
      if (method === 'Tracing.end') {
        if (options.detachOnEnd) { fake.chrome.debugger.onDetach.emit({ tabId: target.tabId }); return {}; }
        emit(target, 'Tracing.dataCollected', { value: [
          { name: 'TimeStamp', pid: 42, args: { data: { message: markers.get('root') } } },
          { name: 'TimeStamp', pid: 77, args: { data: { message: markers.get('s1') } } },
        ] });
        emit(target, 'Tracing.tracingComplete', {});
      }
      return {};
    },
  });
  fake.chrome.debugger.onEvent.addListener(handleDebuggerEvent);
  fake.chrome.debugger.onDetach.addListener(handleDebuggerDetach);
  return fake;
}

beforeEach(() => { resetStore(); store.running = true; });
afterEach(() => { uninstallFakeChrome(); });

test('maps root and iframe sessions to their marker PIDs', async () => {
  const fake = install([tab]);
  await scanTab(tab, store.generation);
  assert.deepEqual(store.mappings[1].pids.sort(), [42, 77]);
  assert.equal(store.mappings[1].frameCount, 2);
  assert.equal(store.mappings[1].mappedFrameCount, 2);
  assert.equal(store.mappings[1].jsHeapBytes, 64);
  assert.equal(fake.attached.size, 0);
});

test('a tab that navigates during the scan gets no mapping', async () => {
  install([{ ...tab, url: 'https://example.test/navigated' }]);
  await scanTab(tab, store.generation);
  assert.equal(store.mappings[1], undefined);
});

test('an unexpected detach rejects the trace with the DevTools message', async () => {
  install([tab], { detachOnEnd: true });
  await scanTab(tab, store.generation);
  assert.match(store.mappings[1].error!, /Debugger detached; retry scan when DevTools is closed/);
});
