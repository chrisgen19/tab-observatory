import { associate, totals } from '../shared/model.ts';
import { store, type Settings } from './store.ts';
import { disconnectHost, poll } from './host-connection.ts';
import { detachAll, handleDebuggerDetach, handleDebuggerEvent, rejectPendingTraces, scanTab } from './tab-scanner.ts';

let timer: ReturnType<typeof setInterval> | undefined;

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('dashboard.html');
  const existing = (await chrome.tabs.query({})).find(tab => tab.url === url);
  if (existing) {
    await chrome.tabs.update(existing.id!, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
});

chrome.debugger.onEvent.addListener(handleDebuggerEvent);
chrome.debugger.onDetach.addListener(handleDebuggerDetach);

async function scan() {
  if (store.scanning || !store.running) return;
  store.scanning = true;
  const token = store.generation;
  try {
    const tabs = (await chrome.tabs.query({})).filter(tab => /^https?:/.test(tab.url || '') && !tab.discarded && !tab.incognito);
    for (let i = 0; i < tabs.length && store.running && store.generation === token; i++) {
      store.scanProgress = `Mapping tab ${i + 1} of ${tabs.length}`;
      await scanTab(tabs[i], token);
    }
  } finally { store.scanning = false; store.scanProgress = ''; }
}

async function start() {
  if (store.running) return;
  store.running = true;
  store.generation++;
  await chrome.storage.session.set({ running: true });
  poll();
  timer = setInterval(poll, 3000);
  await chrome.alarms.create('mapping', { periodInMinutes: 0.5 });
  void scan();
}

async function stop() {
  store.running = false;
  store.generation++;
  clearInterval(timer);
  await chrome.alarms.clear('mapping');
  await chrome.storage.session.set({ running: false });
  rejectPendingTraces('Monitoring stopped');
  await detachAll();
  disconnectHost();
  store.snapshot = null;
  store.mappings = {};
  await chrome.action.setBadgeText({ text: '' });
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === 'loading' || change.discarded) delete store.mappings[tabId];
});
chrome.tabs.onRemoved.addListener(tabId => { delete store.mappings[tabId]; });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'mapping' && store.running) { poll(); void scan(); }
});

async function state() {
  const { snapshot } = store;
  const fresh = !!snapshot && Date.now() - snapshot.receivedAt < 12000;
  const processes = fresh ? snapshot!.processes : [];
  const tabs = (await chrome.tabs.query({})).filter(tab => !tab.incognito);
  return {
    running: store.running, scanning: store.scanning, scanProgress: store.scanProgress, settings: store.settings,
    hostError: !store.running ? '' : store.hostError || (!fresh ? 'Waiting for a fresh companion sample' : ''),
    platform: fresh ? snapshot!.platform : null,
    at: fresh ? snapshot!.at : null,
    warnings: fresh ? snapshot!.warnings : [],
    total: totals(processes), peak: store.peak, history: store.history,
    ...associate(tabs, store.mappings, processes), extensionId: chrome.runtime.id,
  };
}

const ready = (async () => {
  const stored = await chrome.storage.local.get('settings');
  if (stored.settings) store.settings = stored.settings as Settings;
  const session = await chrome.storage.session.get('running');
  if (session.running) await start();
})();

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('dashboard.html')) return;
  (async () => {
    await ready;
    if (message.command === 'start') await start();
    else if (message.command === 'stop') await stop();
    else if (message.command === 'scan') void scan();
    else if (message.command === 'settings') {
      const thresholdMb = Number(message.thresholdMb);
      if (!Number.isFinite(thresholdMb) || thresholdMb < 100 || thresholdMb > 100000) throw new Error('Threshold must be 100–100,000 MB');
      store.settings = { thresholdMb };
      await chrome.storage.local.set({ settings: store.settings });
    } else if (message.command !== 'state') throw new Error('Unknown command');
    return state();
  })().then(respond, error => respond({ error: error.message }));
  return true;
});
