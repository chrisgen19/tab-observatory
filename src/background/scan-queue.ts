export type ScanProgress = { current: number; total: number };

export type ScanQueue = {
  enqueue(ids: number[]): void;
  remove(id: number): void;
  clear(): void;
  idle(): Promise<void>;
  busy(): boolean;
};

/**
 * Serial, deduplicated tab scan queue. A burst of enqueues waits `debounceMs` after the
 * last one, then tabs are scanned one at a time.
 */
export function createScanQueue(deps: {
  scanTab(tabId: number): Promise<void>;
  isActive(): boolean;
  onProgress(progress: ScanProgress | null, tabId: number | null): void;
  debounceMs?: number;
}): ScanQueue {
  const { debounceMs = 1000 } = deps;
  const pending = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let current: number | null = null;
  let done = 0, total = 0;
  let waiters: (() => void)[] = [];

  const settle = () => {
    if (running || timer) return;
    waiters.forEach(resolve => resolve());
    waiters = [];
  };

  async function run() {
    timer = null;
    running = true;
    done = 0;
    total = pending.size;
    try {
      while (pending.size && deps.isActive()) {
        const id: number = pending.values().next().value!;
        pending.delete(id);
        current = id;
        deps.onProgress({ current: ++done, total }, id);
        await deps.scanTab(id).catch(() => {});
        current = null;
      }
    } finally {
      pending.clear();
      running = false;
      current = null;
      deps.onProgress(null, null);
      settle();
    }
  }

  return {
    enqueue(ids) {
      let added = false;
      for (const id of ids) {
        if (id === current || pending.has(id)) continue;
        pending.add(id);
        added = true;
        if (running) total++;
      }
      if (!added || running) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, debounceMs);
    },
    remove(id) {
      if (pending.delete(id) && running) total--;
    },
    clear() {
      pending.clear();
      if (timer) clearTimeout(timer);
      timer = null;
      settle();
    },
    idle() {
      return new Promise(resolve => { waiters.push(resolve); settle(); });
    },
    busy: () => running || timer != null,
  };
}
