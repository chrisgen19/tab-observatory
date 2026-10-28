// Minimal in-memory stand-in for the chrome.* APIs the background uses.
type Listener = (...args: any[]) => unknown;

export type FakeEvent = { addListener(fn: Listener): void; emit(...args: unknown[]): void };
export type FakeTab = { id: number; title?: string; url: string; discarded?: boolean; incognito?: boolean };
export type FakeTarget = { tabId: number; sessionId?: string };
export type FakeSendCommand = (target: FakeTarget, method: string, params?: any) => Promise<unknown>;

export type FakeChrome = {
  chrome: any;
  attached: Set<number>;
  messageHandler(): Listener | undefined;
};

export const event = (): FakeEvent => {
  const listeners: Listener[] = [];
  return { addListener: fn => { listeners.push(fn); }, emit: (...args) => listeners.forEach(fn => fn(...args)) };
};

const defaultSnapshot = () => ({
  type: 'snapshot', at: Date.now(), platform: 'test', warnings: [],
  processes: [{ pid: 42, rssBytes: 1024, privateBytes: 512, cpuPercent: 1 }],
});

/** Assigns a fake `chrome` global and returns handles the tests drive it through. */
export function installFakeChrome(options: { tabs: FakeTab[]; sendCommand: FakeSendCommand; snapshot?: () => object }): FakeChrome {
  const { tabs, sendCommand, snapshot = defaultSnapshot } = options;
  const attached = new Set<number>();
  let messageHandler: Listener | undefined;
  let storedRunning = false;
  const chrome = {
    action: { onClicked: event(), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: {
      id: 'test-extension', getURL: (name: string) => `chrome-extension://test-extension/${name}`,
      onMessage: { addListener: (listener: Listener) => { messageHandler = listener; } },
      onConnect: event(),
      connectNative: () => {
        const connection = { onMessage: event(), onDisconnect: event(), disconnect() {}, postMessage() {
          queueMicrotask(() => connection.onMessage.emit(snapshot()));
        } };
        return connection;
      },
    },
    tabs: {
      query: async () => tabs, get: async (id: number) => tabs.find(t => t.id === id),
      update: async () => {}, create: async () => {}, onUpdated: event(), onRemoved: event(), onReplaced: event(),
    },
    windows: { update: async () => {} },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: event() },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: {
        get: async () => ({ running: storedRunning }),
        set: async (value: { running: boolean }) => { storedRunning = value.running; },
      },
    },
    debugger: {
      onEvent: event(), onDetach: event(),
      attach: async (target: FakeTarget) => { attached.add(target.tabId); },
      detach: async (target: FakeTarget) => { attached.delete(target.tabId); },
      sendCommand,
    },
  };
  (globalThis as any).chrome = chrome;
  return { chrome, attached, messageHandler: () => messageHandler };
}

export function uninstallFakeChrome(): void {
  delete (globalThis as any).chrome;
}
