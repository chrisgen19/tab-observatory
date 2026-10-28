/** Backoff before reconnecting to a restarted service worker: 1 s, 2 s, 4 s, ... capped at 10 s. */
export const reconnectDelay = (attempt: number): number => Math.min(1000 * 2 ** attempt, 10000);
