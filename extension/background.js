import { framesFromEvents, associate, totals } from './model.js';
import { scanDeadline, withTimeout } from './deadline.js';

const HOST = 'com.tab_observatory.monitor';
let running = false;
let port = null;
let hostError = 'Companion is not connected';
let snapshot = null;
let mappings = {};
let scanning = false;
let scanProgress = '';
let timer;
let generation = 0;
let history = [];
let peak = 0;
const pendingTraces = new Map();
const probeTargets = new Map();
const attached = new Set();
const deliberateDetach = new Set();
let settings = { thresholdMb: 1000 };

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('dashboard.html');
  const existing = (await chrome.tabs.query({})).find(tab => tab.url === url);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const probes = probeTargets.get(source.tabId);
  if (probes && method === 'Runtime.executionContextCreated') {
    const context = params.context;
    if (context.auxData?.isDefault && context.auxData.frameId) {
      probes.contexts.set(`${source.sessionId || 'root'}:${context.id}`, {
        sessionId: source.sessionId, contextId: context.id, frameId: context.auxData.frameId,
      });
    }
  }
  if (probes && method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
    const target = { tabId: source.tabId, sessionId: params.sessionId };
    const job = (async () => {
      await probes.command(target, 'Runtime.enable');
      await probes.command(target, 'Target.setAutoAttach', {
        autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
        filter: [{ type: 'iframe' }, { exclude: true }],
      });
    })().catch(() => {});
    probes.jobs.push(job);
  }
  const trace = pendingTraces.get(source.tabId);
  if (!trace) return;
  if (method === 'Tracing.dataCollected') {
    // Retain only process metadata, never full browser traces or page content.
    for (const event of params.value ?? []) {
      if (['TracingStartedInBrowser', 'FrameCommittedInBrowser', 'ProcessReadyInBrowser', 'TimeStamp'].includes(event.name)) {
        if (trace.events.length < 20000) trace.events.push(event);
      }
    }
  }
  if (method === 'Tracing.tracingComplete') trace.resolve();
});

chrome.debugger.onDetach.addListener(source => {
  attached.delete(source.tabId);
  if (deliberateDetach.has(source.tabId)) return;
  const trace = pendingTraces.get(source.tabId);
  if (trace) trace.reject(new Error('Debugger detached; retry scan when DevTools is closed'));
  delete mappings[source.tabId];
});

function connectHost() {
  if (port || !running) return;
  const connection = chrome.runtime.connectNative(HOST);
  port = connection;
  connection.onMessage.addListener(message => {
    if (port !== connection) return;
    if (message.error) { hostError = message.error; snapshot = null; return; }
    if (message.type === 'snapshot') {
      snapshot = { ...message, receivedAt: Date.now() };
      hostError = '';
      const total = totals(message.processes);
      peak = Math.max(peak, total.rssBytes);
      history.push({ at: message.at, rssBytes: total.rssBytes, cpuPercent: total.cpuPercent });
      history = history.slice(-300);
      const high = total.rssBytes > settings.thresholdMb * 1024 ** 2;
      chrome.action.setBadgeText({ text: high ? 'HIGH' : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
    }
  });
  connection.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message;
    if (port !== connection) return;
    port = null;
    snapshot = null;
    hostError = error || 'Companion disconnected';
  });
}

function poll() {
  if (!running) return;
  connectHost();
  try { port?.postMessage({ command: 'snapshot' }); }
  catch (error) { hostError = error.message; }
}

async function traceTab(tab, token) {
  const target = { tabId: tab.id };
  const deadline = scanDeadline(() => running && generation === token);
  const send = (destination, method, params = {}) => deadline.run(
    () => chrome.debugger.sendCommand(destination, method, params), method);
  const command = (method, params = {}) => send(target, method, params);
  let tracing = false;
  let timeout;
  let acceptingAttach = true;
  let jsHeapBytes = null;
  try {
    await deadline.run(async () => {
      await chrome.debugger.attach(target, '1.3');
      if (!acceptingAttach || !running || generation !== token) {
        await withTimeout(() => chrome.debugger.detach(target), 1000, 'Detach').catch(() => {});
        return;
      }
      attached.add(tab.id);
    }, 'Connecting to tab');
    if (!running || generation !== token) return;
    const tree = await command('Page.getFrameTree');
    const rootFrame = tree.frameTree.frame.id;
    const frameIds = new Set();
    const visit = node => { frameIds.add(node.frame.id); (node.childFrames || []).forEach(visit); };
    visit(tree.frameTree);
    const probes = { contexts: new Map(), jobs: [], command: send };
    probeTargets.set(tab.id, probes);
    await command('Runtime.enable');
    await command('Target.setAutoAttach', {
      autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
      filter: [{ type: 'iframe' }, { exclude: true }],
    });
    for (let offset = 0; offset < probes.jobs.length;) {
      deadline.check();
      const jobs = probes.jobs.slice(offset);
      offset += jobs.length;
      await Promise.all(jobs);
    }
    // Page.getFrameTree can omit out-of-process descendants; attached iframe
    // sessions supply their frame IDs through default execution contexts.
    for (const context of probes.contexts.values()) frameIds.add(context.frameId);
    const heap = await command('Runtime.getHeapUsage').catch(() => null);
    jsHeapBytes = heap?.usedSize ?? null;
    let resolve, reject;
    const complete = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Attach a handler immediately, even if start/end fails before awaiting completion.
    complete.catch(() => {});
    const trace = { events: [], resolve, reject };
    pendingTraces.set(tab.id, trace);
    await command('Tracing.start', {
      categories: '-*,devtools.timeline,disabled-by-default-devtools.timeline',
      options: 'record-until-full', transferMode: 'ReportEvents',
    });
    tracing = true;
    const markers = new Map();
    const contexts = [...probes.contexts.values()].filter(context => frameIds.has(context.frameId));
    if (!contexts.some(context => context.frameId === rootFrame)) contexts.push({ frameId: rootFrame });
    for (const context of contexts) {
      const marker = `tab-observatory-${crypto.randomUUID()}`;
      markers.set(marker, context.frameId);
      await send({ tabId: tab.id, ...(context.sessionId ? { sessionId: context.sessionId } : {}) },
        'Runtime.evaluate', { expression: `console.timeStamp(${JSON.stringify(marker)})`, timeout: 1500, disableBreaks: true,
          ...(context.contextId != null ? { contextId: context.contextId } : {}) }).catch(() => {});
    }
    await command('Tracing.end');
    tracing = false;
    timeout = setTimeout(() => reject(new Error('Process mapping timed out')), 8000);
    await deadline.run(() => complete, 'Receiving process mapping', 8000);
    const frames = framesFromEvents(trace.events).filter(frame => frameIds.has(frame.frame));
    for (const event of trace.events) {
      const frame = event.name === 'TimeStamp' && markers.get(event.args?.data?.message);
      if (frame && !frames.some(f => f.frame === frame)) frames.push({ frame, processId: event.pid });
    }
    const root = frames.find(frame => frame.frame === rootFrame);
    if (!root?.processId) throw new Error('Chrome did not expose process mapping');
    const current = await deadline.run(() => chrome.tabs.get(tab.id), 'Checking tab');
    if (!running || generation !== token || current.url !== tab.url) return;
    mappings[tab.id] = {
      at: Date.now(), url: tab.url,
      pids: [...new Set(frames.map(f => f.processId).filter(Number.isInteger))],
      jsHeapBytes,
      frameCount: frameIds.size, mappedFrameCount: frames.length,
    };
  } catch (error) {
    if (generation === token) mappings[tab.id] = { at: Date.now(), url: tab.url, pids: [], jsHeapBytes, error: error.message };
  } finally {
    acceptingAttach = false;
    clearTimeout(timeout);
    if (tracing) await withTimeout(() => chrome.debugger.sendCommand(target, 'Tracing.end'), 1000, 'Ending trace').catch(() => {});
    pendingTraces.delete(tab.id);
    probeTargets.delete(tab.id);
    // Always detach, including when tracing is already in use by another tool.
    if (attached.has(tab.id)) {
      deliberateDetach.add(tab.id);
      await withTimeout(() => chrome.debugger.detach(target), 1000, 'Detach').catch(() => {});
      attached.delete(tab.id);
      deliberateDetach.delete(tab.id);
    }
  }
}

async function scan() {
  if (scanning || !running) return;
  scanning = true;
  const token = generation;
  try {
    const tabs = (await chrome.tabs.query({})).filter(tab => /^https?:/.test(tab.url || '') && !tab.discarded && !tab.incognito);
    for (let i = 0; i < tabs.length && running && generation === token; i++) {
      scanProgress = `Mapping tab ${i + 1} of ${tabs.length}`;
      await traceTab(tabs[i], token);
    }
  } finally { scanning = false; scanProgress = ''; }
}

async function start() {
  if (running) return;
  running = true;
  generation++;
  await chrome.storage.session.set({ running: true });
  poll();
  timer = setInterval(poll, 3000);
  await chrome.alarms.create('mapping', { periodInMinutes: 0.5 });
  void scan();
}

async function stop() {
  running = false;
  generation++;
  clearInterval(timer);
  await chrome.alarms.clear('mapping');
  await chrome.storage.session.set({ running: false });
  for (const trace of pendingTraces.values()) trace.reject(new Error('Monitoring stopped'));
  await Promise.all([...attached].map(async tabId => {
    deliberateDetach.add(tabId);
    await withTimeout(() => chrome.debugger.detach({ tabId }), 1000, 'Detach').catch(() => {});
    deliberateDetach.delete(tabId);
  }));
  attached.clear();
  const connection = port;
  port = null;
  connection?.disconnect();
  snapshot = null;
  mappings = {};
  await chrome.action.setBadgeText({ text: '' });
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === 'loading' || change.discarded) delete mappings[tabId];
});
chrome.tabs.onRemoved.addListener(tabId => { delete mappings[tabId]; });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'mapping' && running) { poll(); void scan(); }
});

async function state() {
  const fresh = snapshot && Date.now() - snapshot.receivedAt < 12000;
  const processes = fresh ? snapshot.processes : [];
  const tabs = (await chrome.tabs.query({})).filter(tab => !tab.incognito);
  return {
    running, scanning, scanProgress, settings,
    hostError: !running ? '' : hostError || (!fresh ? 'Waiting for a fresh companion sample' : ''),
    platform: fresh ? snapshot.platform : null,
    at: fresh ? snapshot.at : null,
    warnings: fresh ? snapshot.warnings : [],
    total: totals(processes), peak, history,
    ...associate(tabs, mappings, processes), extensionId: chrome.runtime.id,
  };
}

const ready = (async () => {
  const stored = await chrome.storage.local.get('settings');
  if (stored.settings) settings = stored.settings;
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
      settings = { thresholdMb };
      await chrome.storage.local.set({ settings });
    } else if (message.command !== 'state') throw new Error('Unknown command');
    return state();
  })().then(respond, error => respond({ error: error.message }));
  return true;
});
