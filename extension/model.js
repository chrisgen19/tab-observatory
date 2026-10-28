export function framesFromEvents(events) {
  const frames = new Map();
  for (const event of events) {
    const data = event.args?.data;
    if (event.name === 'TracingStartedInBrowser') {
      for (const frame of data?.frames ?? []) frames.set(frame.frame, frame);
    } else if (event.name === 'FrameCommittedInBrowser' && data?.frame) {
      frames.set(data.frame, data);
    } else if (event.name === 'ProcessReadyInBrowser' && frames.has(data?.frame)) {
      Object.assign(frames.get(data.frame), { processId: data.processId });
    }
  }
  return [...frames.values()];
}

export function associate(tabs, mappings, processes, now = Date.now()) {
  const byPid = new Map(processes.map(p => [p.pid, p]));
  const owners = new Map();
  const rows = tabs.map(tab => {
    const map = mappings[tab.id];
    const valid = map && now - map.at < 60000 && map.url === tab.url && !tab.discarded;
    // Reject recycled OS PIDs whose new process was born after this association.
    const pids = valid ? [...new Set(map.pids)].filter(pid => byPid.has(pid) &&
      (byPid.get(pid).createdAt == null || byPid.get(pid).createdAt * 1000 <= map.at)) : [];
    for (const pid of pids) {
      if (!owners.has(pid)) owners.set(pid, []);
      owners.get(pid).push(tab.id);
    }
    const selected = pids.map(pid => byPid.get(pid));
    return {
      id: tab.id, title: tab.title || tab.url || 'Untitled', url: tab.url,
      discarded: !!tab.discarded, pids,
      status: tab.discarded ? 'Sleeping' : !/^https?:/.test(tab.url || '') ? 'Restricted' :
        valid && pids.length ? map.mappedFrameCount < map.frameCount ?
          `Partial (${map.mappedFrameCount}/${map.frameCount} frames)` : 'Mapped' : map?.error || 'Awaiting scan',
      mappedAt: valid ? map.at : null,
      rssBytes: selected.length ? selected.reduce((n, p) => n + p.rssBytes, 0) : null,
      privateBytes: selected.length && selected.every(p => p.privateBytes != null) ?
        selected.reduce((n, p) => n + p.privateBytes, 0) : null,
      cpuPercent: selected.length && selected.every(p => p.cpuPercent != null) ?
        selected.reduce((n, p) => n + p.cpuPercent, 0) : null,
      jsHeapBytes: valid ? map.jsHeapBytes ?? null : null,
    };
  });
  for (const row of rows) row.sharedPids = row.pids.filter(pid => owners.get(pid).length > 1);
  return { tabs: rows, processes: processes.map(p => ({ ...p, tabIds: owners.get(p.pid) || [] })) };
}

export function totals(processes) {
  const unique = [...new Map(processes.map(p => [p.pid, p])).values()];
  return {
    rssBytes: unique.reduce((n, p) => n + p.rssBytes, 0),
    privateBytes: unique.length && unique.every(p => p.privateBytes != null) ?
      unique.reduce((n, p) => n + p.privateBytes, 0) : null,
    cpuPercent: unique.length && unique.every(p => p.cpuPercent != null) ?
      unique.reduce((n, p) => n + p.cpuPercent, 0) : null,
    processCount: unique.length,
  };
}
