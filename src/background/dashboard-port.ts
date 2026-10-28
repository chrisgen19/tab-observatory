import { CommandSchema, type Command, type DashboardState, type PortMessage } from '../shared/protocol.ts';

export type DashboardHub = { attach(port: chrome.runtime.Port): void; notify(): void };

/**
 * Pushes dashboard state to connected dashboards and answers their commands.
 * notify() bursts become one leading push plus one trailing push per `coalesceMs` window.
 */
export function createDashboardHub(deps: {
  buildState(): Promise<DashboardState>;
  handle(command: Command): Promise<unknown>;
  isTrustedSender(sender: chrome.runtime.MessageSender | undefined): boolean;
  coalesceMs?: number;
}): DashboardHub {
  const { coalesceMs = 250 } = deps;
  const ports = new Set<chrome.runtime.Port>();
  let cooling: ReturnType<typeof setTimeout> | null = null;
  let trailing = false;
  // Commands run one at a time in arrival order, so a quick start then stop cannot interleave.
  let commands: Promise<void> = Promise.resolve();

  const send = (port: chrome.runtime.Port, message: PortMessage) => {
    try { port.postMessage(message); } catch { ports.delete(port); }
  };

  async function push(targets: Iterable<chrome.runtime.Port>) {
    const list = [...targets];
    if (!list.length) return;
    const state = await deps.buildState();
    for (const port of list) if (ports.has(port)) send(port, { kind: 'state', state });
  }

  function cool() {
    cooling = setTimeout(() => {
      cooling = null;
      if (!trailing) return;
      trailing = false;
      void push(ports);
      cool();
    }, coalesceMs);
  }

  async function reply(port: chrome.runtime.Port, raw: unknown) {
    const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '';
    const parsed = CommandSchema.safeParse(raw);
    if (!parsed.success) return send(port, { kind: 'reply', id, ok: false, error: parsed.error.issues[0].message });
    try {
      send(port, { kind: 'reply', id, ok: true, result: await deps.handle(parsed.data) });
    } catch (error) {
      send(port, { kind: 'reply', id, ok: false, error: (error as Error).message });
    }
  }

  return {
    attach(port) {
      if (!deps.isTrustedSender(port.sender)) { port.disconnect(); return; }
      ports.add(port);
      port.onDisconnect.addListener(() => { ports.delete(port); });
      port.onMessage.addListener(message => { commands = commands.then(() => reply(port, message)); });
      void push([port]);
    },
    notify() {
      if (cooling) { trailing = true; return; }
      void push(ports);
      cool();
    },
  };
}
