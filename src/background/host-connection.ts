import { totals } from '../shared/model.ts';
import { store, type Snapshot } from './store.ts';

const HOST = 'com.tab_observatory.monitor';
let port: chrome.runtime.Port | null = null;

function handleSnapshot(message: Snapshot) {
  store.snapshot = { ...message, receivedAt: Date.now() };
  store.hostError = '';
  const total = totals(message.processes);
  store.peak = Math.max(store.peak, total.rssBytes);
  store.history.push({ at: message.at, rssBytes: total.rssBytes, cpuPercent: total.cpuPercent });
  store.history = store.history.slice(-300);
  const high = total.rssBytes > store.settings.thresholdMb * 1024 ** 2;
  chrome.action.setBadgeText({ text: high ? 'HIGH' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
}

export function connectHost(): void {
  if (port || !store.running) return;
  const connection = chrome.runtime.connectNative(HOST);
  port = connection;
  connection.onMessage.addListener(message => {
    if (port !== connection) return;
    if (message.error) { store.hostError = message.error; store.snapshot = null; return; }
    if (message.type === 'snapshot') handleSnapshot(message);
  });
  connection.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message;
    if (port !== connection) return;
    port = null;
    store.snapshot = null;
    store.hostError = error || 'Companion disconnected';
  });
}

export function poll(): void {
  if (!store.running) return;
  connectHost();
  try { port?.postMessage({ command: 'snapshot' }); }
  catch (error) { store.hostError = (error as Error).message; }
}

export function disconnectHost(): void {
  const connection = port;
  port = null;
  connection?.disconnect();
}
