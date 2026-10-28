import { framesFromEvents, type FrameInfo, type TraceEvent } from '../shared/model.ts';
import { scanDeadline, withTimeout, type ScanDeadline } from '../shared/deadline.ts';
import { store } from './store.ts';

type Target = { tabId: number; sessionId?: string };
type Send = (destination: Target, method: string, params?: object) => Promise<any>;
type Context = { sessionId?: string; contextId?: number; frameId: string };
type Probes = { contexts: Map<string, Context>; jobs: Promise<unknown>[]; command: Send };
type PendingTrace = { events: TraceEvent[]; resolve: () => void; reject: (error: Error) => void };
type Scan = {
  tab: chrome.tabs.Tab; tabId: number; target: Target; token: number; deadline: ScanDeadline;
  send: Send; command: (method: string, params?: object) => Promise<any>;
  tracing: boolean; timeout?: ReturnType<typeof setTimeout>; acceptingAttach: boolean; jsHeapBytes: number | null;
};

const pendingTraces = new Map<number, PendingTrace>();
const probeTargets = new Map<number, Probes>();
const attached = new Set<number>();
const deliberateDetach = new Set<number>();
const isCurrent = (token: number) => store.running && store.generation === token;

export function handleDebuggerEvent(source: chrome.debugger.DebuggerSession, method: string, params?: any): void {
  const tabId = source.tabId!;
  const probes = probeTargets.get(tabId);
  if (probes && method === 'Runtime.executionContextCreated') {
    const context = params.context;
    if (context.auxData?.isDefault && context.auxData.frameId) {
      probes.contexts.set(`${source.sessionId || 'root'}:${context.id}`, {
        sessionId: source.sessionId, contextId: context.id, frameId: context.auxData.frameId,
      });
    }
  }
  if (probes && method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
    const target = { tabId, sessionId: params.sessionId };
    const job = (async () => {
      await probes.command(target, 'Runtime.enable');
      await probes.command(target, 'Target.setAutoAttach', {
        autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
        filter: [{ type: 'iframe' }, { exclude: true }],
      });
    })().catch(() => {});
    probes.jobs.push(job);
  }
  const trace = pendingTraces.get(tabId);
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
}

export function handleDebuggerDetach(source: chrome.debugger.Debuggee): void {
  const tabId = source.tabId!;
  attached.delete(tabId);
  if (deliberateDetach.has(tabId)) return;
  const trace = pendingTraces.get(tabId);
  if (trace) trace.reject(new Error('Debugger detached; retry scan when DevTools is closed'));
  delete store.mappings[tabId];
}

function createScan(tab: chrome.tabs.Tab, token: number): Scan {
  const tabId = tab.id!;
  const target = { tabId };
  const deadline = scanDeadline(() => isCurrent(token));
  const send: Send = (destination, method, params = {}) => deadline.run(
    () => chrome.debugger.sendCommand(destination, method, params) as Promise<any>, method);
  const command = (method: string, params: object = {}) => send(target, method, params);
  return { tab, tabId, target, token, deadline, send, command, tracing: false, acceptingAttach: true, jsHeapBytes: null };
}

async function attachTab(scan: Scan) {
  await scan.deadline.run(async () => {
    await chrome.debugger.attach(scan.target, '1.3');
    if (!scan.acceptingAttach || !isCurrent(scan.token)) {
      await withTimeout(() => chrome.debugger.detach(scan.target), 1000, 'Detach').catch(() => {});
      return;
    }
    attached.add(scan.tabId);
  }, 'Connecting to tab');
}

/** Enables iframe auto-attach and returns the root frame plus every frame ID seen. */
async function collectContexts(scan: Scan) {
  const tree = await scan.command('Page.getFrameTree');
  const rootFrame: string = tree.frameTree.frame.id;
  const frameIds = new Set<string>();
  const visit = (node: any) => { frameIds.add(node.frame.id); (node.childFrames || []).forEach(visit); };
  visit(tree.frameTree);
  const probes: Probes = { contexts: new Map(), jobs: [], command: scan.send };
  probeTargets.set(scan.tabId, probes);
  await scan.command('Runtime.enable');
  await scan.command('Target.setAutoAttach', {
    autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
    filter: [{ type: 'iframe' }, { exclude: true }],
  });
  for (let offset = 0; offset < probes.jobs.length;) {
    scan.deadline.check();
    const jobs = probes.jobs.slice(offset);
    offset += jobs.length;
    await Promise.all(jobs);
  }
  // Page.getFrameTree can omit out-of-process descendants; attached iframe
  // sessions supply their frame IDs through default execution contexts.
  for (const context of probes.contexts.values()) frameIds.add(context.frameId);
  return { rootFrame, frameIds, probes };
}

/** Traces one console.timeStamp marker per frame; the trace event carries the renderer PID. */
async function emitMarkers(scan: Scan, rootFrame: string, frameIds: Set<string>, probes: Probes) {
  let resolve!: () => void, reject!: (error: Error) => void;
  const complete = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // Attach a handler immediately, even if start/end fails before awaiting completion.
  complete.catch(() => {});
  const trace: PendingTrace = { events: [], resolve, reject };
  pendingTraces.set(scan.tabId, trace);
  await scan.command('Tracing.start', {
    categories: '-*,devtools.timeline,disabled-by-default-devtools.timeline',
    options: 'record-until-full', transferMode: 'ReportEvents',
  });
  scan.tracing = true;
  const markers = new Map<string, string>();
  const contexts: Context[] = [...probes.contexts.values()].filter(context => frameIds.has(context.frameId));
  if (!contexts.some(context => context.frameId === rootFrame)) contexts.push({ frameId: rootFrame });
  for (const context of contexts) {
    const marker = `tab-observatory-${crypto.randomUUID()}`;
    markers.set(marker, context.frameId);
    await scan.send({ tabId: scan.tabId, ...(context.sessionId ? { sessionId: context.sessionId } : {}) },
      'Runtime.evaluate', { expression: `console.timeStamp(${JSON.stringify(marker)})`, timeout: 1500, disableBreaks: true,
        ...(context.contextId != null ? { contextId: context.contextId } : {}) }).catch(() => {});
  }
  await scan.command('Tracing.end');
  scan.tracing = false;
  scan.timeout = setTimeout(() => reject(new Error('Process mapping timed out')), 8000);
  await scan.deadline.run(() => complete, 'Receiving process mapping', 8000);
  return { events: trace.events, markers };
}

async function resolveMapping(scan: Scan, rootFrame: string, frameIds: Set<string>, trace: { events: TraceEvent[]; markers: Map<string, string> }) {
  const frames: FrameInfo[] = framesFromEvents(trace.events).filter(frame => frameIds.has(frame.frame));
  for (const event of trace.events) {
    const frame = event.name === 'TimeStamp' && trace.markers.get(event.args?.data?.message);
    if (frame && !frames.some(f => f.frame === frame)) frames.push({ frame, processId: event.pid });
  }
  const root = frames.find(frame => frame.frame === rootFrame);
  if (!root?.processId) throw new Error('Chrome did not expose process mapping');
  const current = await scan.deadline.run(() => chrome.tabs.get(scan.tabId), 'Checking tab');
  if (!isCurrent(scan.token) || current.url !== scan.tab.url) return;
  store.mappings[scan.tabId] = {
    at: Date.now(), url: scan.tab.url!,
    pids: [...new Set(frames.map(f => f.processId).filter(Number.isInteger))] as number[],
    jsHeapBytes: scan.jsHeapBytes,
    frameCount: frameIds.size, mappedFrameCount: frames.length,
  };
}

async function cleanupTab(scan: Scan) {
  scan.acceptingAttach = false;
  clearTimeout(scan.timeout);
  if (scan.tracing) await withTimeout(() => chrome.debugger.sendCommand(scan.target, 'Tracing.end'), 1000, 'Ending trace').catch(() => {});
  pendingTraces.delete(scan.tabId);
  probeTargets.delete(scan.tabId);
  // Always detach, including when tracing is already in use by another tool.
  if (attached.has(scan.tabId)) {
    deliberateDetach.add(scan.tabId);
    await withTimeout(() => chrome.debugger.detach(scan.target), 1000, 'Detach').catch(() => {});
    attached.delete(scan.tabId);
    deliberateDetach.delete(scan.tabId);
  }
}

/** Maps one tab's frames to OS PIDs with a short debugger session; writes store.mappings[tab.id]. */
export async function scanTab(tab: chrome.tabs.Tab, token: number): Promise<void> {
  const scan = createScan(tab, token);
  try {
    await attachTab(scan);
    if (!isCurrent(token)) return;
    const { rootFrame, frameIds, probes } = await collectContexts(scan);
    const heap = await scan.command('Runtime.getHeapUsage').catch(() => null);
    scan.jsHeapBytes = heap?.usedSize ?? null;
    const trace = await emitMarkers(scan, rootFrame, frameIds, probes);
    await resolveMapping(scan, rootFrame, frameIds, trace);
  } catch (error) {
    if (store.generation === token) {
      store.mappings[scan.tabId] = { at: Date.now(), url: tab.url!, pids: [], jsHeapBytes: scan.jsHeapBytes, error: (error as Error).message };
    }
  } finally {
    await cleanupTab(scan);
  }
}

export function rejectPendingTraces(reason: string): void {
  for (const trace of pendingTraces.values()) trace.reject(new Error(reason));
}

export async function detachAll(): Promise<void> {
  await Promise.all([...attached].map(async tabId => {
    deliberateDetach.add(tabId);
    await withTimeout(() => chrome.debugger.detach({ tabId }), 1000, 'Detach').catch(() => {});
    deliberateDetach.delete(tabId);
  }));
  attached.clear();
}
