import { associate, totals } from '../shared/model.ts';
import { store } from './store.ts';
import { SettingsInputSchema, parseSettings } from '../shared/settings.ts';
import { disconnectHost, onSnapshot, poll } from './host-connection.ts';
import { detachAll, handleDebuggerDetach, handleDebuggerEvent, rejectPendingTraces, scanTab } from './tab-scanner.ts';
import { createScanQueue } from './scan-queue.ts';
import { isScannable, staleTabIds } from './scan-triggers.ts';

const FULL_REFRESH = 'full-refresh';
let timer: ReturnType<typeof setInterval> | undefined;

const queue = createScanQueue({
  isActive: () => store.running,
  onProgress: (progress, tabId) => { store.scanProgress = progress; store.scanningTabId = tabId; },
  scanTab: async tabId => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && isScannable(tab)) await scanTab(tab, store.generation);
  },
});

async function enqueueAll() {
  const tabs = await chrome.tabs.query({});
  queue.enqueue(tabs.filter(isScannable).map(tab => tab.id!));
}

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

onSnapshot(async () => {
  if (!store.running || !store.snapshot) return;
  const tabs = await chrome.tabs.query({});
  queue.enqueue(staleTabIds(tabs, store.mappings, store.snapshot.processes));
});

/** Off (0 minutes) clears the alarm; otherwise every scannable tab is rescanned on that period. */
async function scheduleFullRefresh() {
  await chrome.alarms.clear(FULL_REFRESH);
  const minutes = store.settings.fullRefreshMinutes;
  if (store.running && minutes) await chrome.alarms.create(FULL_REFRESH, { periodInMinutes: minutes });
}

async function start() {
  if (store.running) return;
  store.running = true;
  store.generation++;
  await chrome.storage.session.set({ running: true });
  poll();
  timer = setInterval(poll, 3000);
  await scheduleFullRefresh();
  await enqueueAll();
}

async function stop() {
  store.running = false;
  store.generation++;
  clearInterval(timer);
  queue.clear();
  await chrome.alarms.clear(FULL_REFRESH);
  await chrome.storage.session.set({ running: false });
  rejectPendingTraces('Monitoring stopped');
  await detachAll();
  disconnectHost();
  store.snapshot = null;
  store.mappings = {};
  await chrome.action.setBadgeText({ text: '' });
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === 'loading' || change.discarded) delete store.mappings[tabId];
  if (change.discarded) queue.remove(tabId);
  const settled = change.status === 'complete' || change.discarded === false;
  if (store.running && settled && !store.mappings[tabId] && isScannable(tab)) queue.enqueue([tabId]);
});
chrome.tabs.onRemoved.addListener(tabId => { delete store.mappings[tabId]; queue.remove(tabId); });
chrome.tabs.onReplaced.addListener((added, removed) => {
  if (store.mappings[removed]) store.mappings[added] = store.mappings[removed];
  delete store.mappings[removed];
  queue.remove(removed);
  if (store.running) queue.enqueue([added]);
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === FULL_REFRESH && store.running) void enqueueAll();
});

async function state() {
  const { snapshot } = store;
  const fresh = !!snapshot && Date.now() - snapshot.receivedAt < 12000;
  const processes = fresh ? snapshot!.processes : [];
  const tabs = (await chrome.tabs.query({})).filter(tab => !tab.incognito);
  return {
    running: store.running, scanning: queue.busy(), scanProgress: store.scanProgress, settings: store.settings,
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
  store.settings = parseSettings(stored.settings);
  const session = await chrome.storage.session.get('running');
  if (session.running) await start();
})();

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('dashboard.html')) return;
  (async () => {
    await ready;
    if (message.command === 'start') await start();
    else if (message.command === 'stop') await stop();
    else if (message.command === 'scan') void enqueueAll();
    else if (message.command === 'settings') {
      const result = SettingsInputSchema.shape.thresholdMb.safeParse(Number(message.thresholdMb));
      if (!result.success) throw new Error(result.error.issues[0].message);
      store.settings = { ...store.settings, thresholdMb: result.data };
      await chrome.storage.local.set({ settings: store.settings });
    } else if (message.command !== 'state') throw new Error('Unknown command');
    return state();
  })().then(respond, error => respond({ error: error.message }));
  return true;
});
