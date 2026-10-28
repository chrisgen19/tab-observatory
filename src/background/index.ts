import { store } from './store.ts';
import { parseSettings, type Settings } from '../shared/settings.ts';
import { PORT_NAME, type Command } from '../shared/protocol.ts';
import { disconnectHost, onSnapshot, poll } from './host-connection.ts';
import { detachAll, handleDebuggerDetach, handleDebuggerEvent, rejectPendingTraces, scanTab } from './tab-scanner.ts';
import { createScanQueue } from './scan-queue.ts';
import { isScannable, staleTabIds } from './scan-triggers.ts';
import { createDashboardHub } from './dashboard-port.ts';
import { buildState } from './state.ts';
import { closeTab, createTabsApi, focusTab, sleepGroup, sleepTab, type ActionResult } from './tab-actions.ts';

const FULL_REFRESH = 'full-refresh';
const tabsApi = createTabsApi();
let timer: ReturnType<typeof setInterval> | undefined;

const queue = createScanQueue({
  isActive: () => store.running,
  onProgress: (progress, tabId) => { store.scanProgress = progress; store.scanningTabId = tabId; hub.notify(); },
  scanTab: async tabId => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && isScannable(tab)) await scanTab(tab, store.generation);
    hub.notify();
  },
});

const hub = createDashboardHub({
  buildState: () => buildState(queue.busy()),
  handle: async command => {
    await ready;
    try { return await handle(command); } finally { hub.notify(); }
  },
  isTrustedSender: sender => sender?.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('dashboard.html'),
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
chrome.runtime.onConnect.addListener(port => { if (port.name === PORT_NAME) hub.attach(port); });

onSnapshot(async () => {
  if (!store.running || !store.snapshot) return;
  const tabs = await chrome.tabs.query({});
  queue.enqueue(staleTabIds(tabs, store.mappings, store.snapshot.processes));
  hub.notify();
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

async function saveSettings(settings: Settings) {
  const refreshChanged = settings.fullRefreshMinutes !== store.settings.fullRefreshMinutes;
  store.settings = settings;
  await chrome.storage.local.set({ settings });
  if (refreshChanged) await scheduleFullRefresh();
}

const unwrap = (result: ActionResult) => { if (!result.ok) throw new Error(result.error); };

async function handle(command: Command): Promise<unknown> {
  switch (command.type) {
    case 'start': return start();
    case 'stop': return stop();
    case 'rescan':
      if (!store.running) throw new Error('Start monitoring first');
      return enqueueAll();
    case 'focus': return unwrap(await focusTab(tabsApi, command));
    case 'close': return unwrap(await closeTab(tabsApi, command));
    case 'sleep':
      unwrap(await sleepTab(tabsApi, command));
      delete store.mappings[command.tabId];
      return;
    case 'sleepGroup': {
      const result = await sleepGroup(tabsApi, command.targets);
      for (const target of command.targets) delete store.mappings[target.tabId];
      return result;
    }
    case 'saveSettings': return saveSettings(command.settings);
  }
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === 'loading' || change.discarded) delete store.mappings[tabId];
  if (change.discarded) queue.remove(tabId);
  const settled = change.status === 'complete' || change.discarded === false;
  if (store.running && settled && !store.mappings[tabId] && isScannable(tab)) queue.enqueue([tabId]);
  hub.notify();
});
chrome.tabs.onRemoved.addListener(tabId => {
  delete store.mappings[tabId];
  queue.remove(tabId);
  hub.notify();
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  if (store.mappings[removed]) store.mappings[added] = store.mappings[removed];
  delete store.mappings[removed];
  queue.remove(removed);
  if (store.running) queue.enqueue([added]);
  hub.notify();
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === FULL_REFRESH && store.running) void enqueueAll();
});

const ready = (async () => {
  const stored = await chrome.storage.local.get('settings');
  store.settings = parseSettings(stored.settings);
  const session = await chrome.storage.session.get('running');
  if (session.running) await start();
})();
