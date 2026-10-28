export type ProcessSample = {
  pid: number; createdAt?: number | null; kind: string;
  rssBytes: number; privateBytes: number | null; cpuPercent: number | null;
};

export type Mapping = {
  at: number; url: string; pids: number[]; jsHeapBytes: number | null;
  frameCount?: number; mappedFrameCount?: number; error?: string;
};

export type TraceEvent = { name: string; pid?: number; args?: { data?: any } };
export type FrameInfo = { frame: string; processId?: number; [key: string]: unknown };

export type TabRow = {
  id: number; title: string; url: string | undefined; discarded: boolean; pids: number[];
  status: string; mappedAt: number | null; rssBytes: number | null; privateBytes: number | null;
  cpuPercent: number | null; jsHeapBytes: number | null; sharedPids: number[];
  favIconUrl?: string; windowId?: number; active?: boolean;
};

export type OwnedProcess = ProcessSample & { tabIds: number[] };

export type Totals = { rssBytes: number; privateBytes: number | null; cpuPercent: number | null; processCount: number };

export function framesFromEvents(events: TraceEvent[]): FrameInfo[] {
  const frames = new Map<string, FrameInfo>();
  for (const event of events) {
    const data = event.args?.data;
    if (event.name === 'TracingStartedInBrowser') {
      for (const frame of data?.frames ?? []) frames.set(frame.frame, frame);
    } else if (event.name === 'FrameCommittedInBrowser' && data?.frame) {
      frames.set(data.frame, data);
    } else if (event.name === 'ProcessReadyInBrowser' && frames.has(data?.frame)) {
      Object.assign(frames.get(data.frame)!, { processId: data.processId });
    }
  }
  return [...frames.values()];
}

const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);

export function associate(tabs: chrome.tabs.Tab[], mappings: Record<number, Mapping>, processes: ProcessSample[], now = Date.now()) {
  const byPid = new Map(processes.map(p => [p.pid, p]));
  const owners = new Map<number, number[]>();
  const rows = tabs.map((tab): TabRow => {
    const id = tab.id!;
    const map = mappings[id];
    const valid = !!map && now - map.at < 60000 && map.url === tab.url && !tab.discarded;
    // Reject recycled OS PIDs whose new process was born after this association.
    const pids = valid ? [...new Set(map.pids)].filter(pid => byPid.has(pid) &&
      (byPid.get(pid)!.createdAt == null || byPid.get(pid)!.createdAt! * 1000 <= map.at)) : [];
    for (const pid of pids) {
      if (!owners.has(pid)) owners.set(pid, []);
      owners.get(pid)!.push(id);
    }
    const selected = pids.map(pid => byPid.get(pid)!);
    return {
      id, title: tab.title || tab.url || 'Untitled', url: tab.url,
      discarded: !!tab.discarded, pids,
      status: tab.discarded ? 'Sleeping' : !/^https?:/.test(tab.url || '') ? 'Restricted' :
        valid && pids.length ? map.mappedFrameCount! < map.frameCount! ?
          `Partial (${map.mappedFrameCount}/${map.frameCount} frames)` : 'Mapped' : map?.error || 'Awaiting scan',
      mappedAt: valid ? map.at : null,
      rssBytes: selected.length ? sum(selected.map(p => p.rssBytes)) : null,
      privateBytes: selected.length && selected.every(p => p.privateBytes != null) ?
        sum(selected.map(p => p.privateBytes!)) : null,
      cpuPercent: selected.length && selected.every(p => p.cpuPercent != null) ?
        sum(selected.map(p => p.cpuPercent!)) : null,
      jsHeapBytes: valid ? map.jsHeapBytes ?? null : null,
      sharedPids: [],
      favIconUrl: tab.favIconUrl, windowId: tab.windowId, active: tab.active,
    };
  });
  for (const row of rows) row.sharedPids = row.pids.filter(pid => owners.get(pid)!.length > 1);
  const owned: OwnedProcess[] = processes.map(p => ({ ...p, tabIds: owners.get(p.pid) || [] }));
  return { tabs: rows, processes: owned };
}

export function totals(processes: ProcessSample[]): Totals {
  const unique = [...new Map(processes.map(p => [p.pid, p])).values()];
  return {
    rssBytes: sum(unique.map(p => p.rssBytes)),
    privateBytes: unique.length && unique.every(p => p.privateBytes != null) ?
      sum(unique.map(p => p.privateBytes!)) : null,
    cpuPercent: unique.length && unique.every(p => p.cpuPercent != null) ?
      sum(unique.map(p => p.cpuPercent!)) : null,
    processCount: unique.length,
  };
}
