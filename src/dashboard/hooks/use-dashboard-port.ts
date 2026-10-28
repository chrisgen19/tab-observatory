import { useCallback, useEffect, useRef, useState } from 'react';
import { PORT_NAME, type CommandInput, type DashboardState, type PortMessage } from '../../shared/protocol.ts';
import { reconnectDelay } from '../lib/reconnect.ts';

type Waiter = { resolve(result: unknown): void; reject(error: Error): void };

/**
 * Keeps a port open to the background, which pushes DashboardState on every change.
 * Reconnects with backoff when the service worker restarts.
 */
export function useDashboardPort() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [connected, setConnected] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const waiters = useRef(new Map<string, Waiter>());

  useEffect(() => {
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const failWaiters = () => {
      for (const waiter of waiters.current.values()) waiter.reject(new Error('Lost connection to the extension. Try again.'));
      waiters.current.clear();
    };

    const connect = () => {
      const port = chrome.runtime.connect({ name: PORT_NAME });
      portRef.current = port;
      port.onMessage.addListener((message: PortMessage) => {
        attempt = 0;
        setConnected(true);
        if (message.kind === 'state') { setState(message.state); return; }
        const waiter = waiters.current.get(message.id);
        waiters.current.delete(message.id);
        if (message.ok) waiter?.resolve(message.result); else waiter?.reject(new Error(message.error));
      });
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        setConnected(false);
        failWaiters();
        if (!closed) retry = setTimeout(connect, reconnectDelay(attempt++));
      });
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      portRef.current?.disconnect();
      failWaiters();
    };
  }, []);

  const send = useCallback((command: CommandInput) => new Promise<unknown>((resolve, reject) => {
    const port = portRef.current;
    if (!port) { reject(new Error('Not connected to the extension yet. Try again.')); return; }
    const id = crypto.randomUUID();
    waiters.current.set(id, { resolve, reject });
    port.postMessage({ ...command, id });
  }), []);

  return { state, connected, send };
}
