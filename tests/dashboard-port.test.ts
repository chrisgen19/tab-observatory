import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardHub } from '../src/background/dashboard-port.ts';
import type { Command, DashboardState } from '../src/shared/protocol.ts';
import { createFakePort, type FakePort } from './helpers/fake-chrome.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const states = (port: FakePort) => port.sent.filter(m => m.kind === 'state');

function setup(handle: (command: Command) => Promise<unknown> = async () => undefined) {
  let builds = 0;
  const hub = createDashboardHub({
    buildState: async () => ({ build: ++builds }) as unknown as DashboardState,
    handle,
    isTrustedSender: sender => sender?.url === 'chrome-extension://test-extension/dashboard.html',
    coalesceMs: 250,
  });
  return hub;
}

test('untrusted ports are disconnected without receiving state', async () => {
  const hub = setup();
  const port = createFakePort('https://evil.test/');
  hub.attach(port as unknown as chrome.runtime.Port);
  await tick();
  assert.equal(port.disconnected, true);
  assert.deepEqual(port.sent, []);
});

test('notify bursts coalesce to a leading and a trailing push', async () => {
  const hub = setup();
  const port = createFakePort();
  hub.attach(port as unknown as chrome.runtime.Port);
  await tick();
  assert.equal(states(port).length, 1);
  for (let i = 0; i < 10; i++) hub.notify();
  await sleep(300);
  assert.equal(states(port).length, 3);
});

test('commands get replies matched by id, including errors', async () => {
  const hub = setup(async command => { if (command.type === 'rescan') throw new Error('Not monitoring'); return 'done'; });
  const port = createFakePort();
  hub.attach(port as unknown as chrome.runtime.Port);
  port.emit({ id: 'x1', type: 'stop' });
  port.emit({ id: 'x2', type: 'bogus' });
  port.emit({ id: 'x3', type: 'rescan' });
  await sleep(10);
  const replies = port.sent.filter(m => m.kind === 'reply');
  assert.deepEqual(replies.map(m => [m.id, m.ok]), [['x1', true], ['x2', false], ['x3', false]]);
  assert.equal(replies[0].result, 'done');
  assert.equal(replies[2].error, 'Not monitoring');
});

test('a disconnected port stops receiving pushes', async () => {
  const hub = setup();
  const port = createFakePort();
  hub.attach(port as unknown as chrome.runtime.Port);
  await tick();
  port.onDisconnect.emit(port);
  hub.notify();
  await tick();
  assert.equal(states(port).length, 1);
});
