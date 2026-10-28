const $ = id => document.getElementById(id);
let state;
let view = 'tabs';
let sortKey = 'rssBytes';
let descending = true;
let busy = false;
const bytes = n => n == null ? '—' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
const percent = n => n == null ? '—' : `${n.toFixed(1)}%`;

async function request(command, extra = {}) {
  const result = await chrome.runtime.sendMessage({ command, ...extra });
  if (result?.error) throw new Error(result.error);
  return result;
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function renderRows() {
  if (!state) return;
  const needle = $('search').value.toLowerCase();
  const data = (view === 'tabs' ? state.tabs : state.processes).filter(row =>
    JSON.stringify([row.title, row.url, row.pid, row.pids, row.kind]).toLowerCase().includes(needle));
  data.sort((a, b) => {
    if (a[sortKey] == null) return b[sortKey] == null ? 0 : 1;
    if (b[sortKey] == null) return -1;
    return (a[sortKey] - b[sortKey]) * (descending ? -1 : 1);
  });
  const fragment = document.createDocumentFragment();
  for (const row of data) {
    const tr = document.createElement('tr');
    const name = cell('');
    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = view === 'tabs' ? row.title : `${row.kind} · PID ${row.pid}`;
    const sub = document.createElement('div');
    sub.className = 'row-subtitle';
    sub.textContent = view === 'tabs' ? `${row.url || ''}${row.pids.length ? ` · PID ${row.pids.join(', ')}` : ''}` :
      row.tabIds.length ? `${row.tabIds.length} observed tab association(s)` : 'Browser overhead, worker, extension or unmapped process';
    name.append(title, sub);
    const attribution = cell('');
    const tag = document.createElement('span');
    const shared = view === 'tabs' ? row.sharedPids.length > 0 : row.tabIds.length > 1;
    tag.className = `tag${shared ? ' shared' : view === 'tabs' && !row.pids.length ? ' dim' : ''}`;
    tag.textContent = shared ? 'Shared process' : view === 'tabs' ? row.status : 'OS process';
    tag.title = view === 'tabs' ? `${row.status}${row.mappedAt ? ` · scanned ${new Date(row.mappedAt).toLocaleTimeString()}` : ''}` : 'Measured once in browser totals';
    attribution.append(tag);
    tr.append(name, cell(bytes(row.rssBytes)), cell(bytes(row.privateBytes)), cell(percent(row.cpuPercent)), cell(bytes(row.jsHeapBytes)), attribution);
    fragment.append(tr);
  }
  if (!data.length) {
    const tr = document.createElement('tr');
    const td = cell(needle ? 'No matching rows.' : 'No process samples yet. Connect the companion and start monitoring.', 'empty');
    td.colSpan = 6; tr.append(td); fragment.append(tr);
  }
  $('rows').replaceChildren(fragment);
}

function render(next) {
  state = next;
  const hasSample = !!state.at;
  $('toggle').textContent = state.running ? 'Pause monitoring' : 'Start monitoring';
  $('scan').disabled = !state.running || state.scanning;
  $('status').textContent = state.scanning ? state.scanProgress || 'Mapping tabs…' : state.running ? hasSample ? '● Live · every 3 seconds' : 'Connecting…' : 'Paused';
  $('status').classList.toggle('live', state.running && hasSample);
  $('setup').hidden = hasSample;
  $('error').hidden = !state.hostError;
  $('error').textContent = state.hostError ? `${state.hostError}. Check the companion installation in the setup panel and retry monitoring.` : '';
  $('warnings').hidden = !state.warnings?.length;
  $('warnings').textContent = state.warnings?.join(' · ') || '';
  $('rss').textContent = hasSample ? bytes(state.total.rssBytes) : '—';
  $('private').textContent = hasSample ? bytes(state.total.privateBytes) : '—';
  $('cpu').textContent = hasSample ? percent(state.total.cpuPercent) : '—';
  $('processes').textContent = hasSample ? state.total.processCount : '—';
  $('coverage').textContent = `${state.tabs.filter(t => t.pids.length).length} of ${state.tabs.length} tabs mapped · ${state.platform || 'local only'}`;
  $('peak').textContent = `Session peak ${state.peak ? bytes(state.peak) : '—'}`;
  $('updated').textContent = hasSample ? `Updated ${new Date(state.at).toLocaleTimeString()}` : 'Waiting for samples';
  const points = state.history.filter(p => Date.now() - p.at < 15 * 60 * 1000);
  const max = Math.max(...points.map(p => p.rssBytes), 1) * 1.15;
  const first = Math.max(Date.now() - 15 * 60 * 1000, points[0]?.at || 0);
  const span = Math.max(Date.now() - first, 3000);
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${Math.max(0, (point.at - first) / span * 1000).toFixed(1)},${(105 - point.rssBytes / max * 100).toFixed(1)}`).join(' ');
  $('line').setAttribute('d', path);
  $('area').setAttribute('d', points.length ? `${path} L${Math.max(0, (points.at(-1).at - first) / span * 1000)},110 L0,110 Z` : '');
  $('windows-command').textContent = `py -3 scripts/install_host.py ${state.extensionId}`;
  $('mac-command').textContent = `python3 scripts/install_host.py ${state.extensionId}`;
  if (document.activeElement !== $('threshold')) $('threshold').value = state.settings.thresholdMb;
  renderRows();
}

async function refresh() {
  if (busy || document.hidden) return;
  busy = true;
  try { render(await request('state')); }
  catch (error) { $('error').hidden = false; $('error').textContent = error.message; }
  finally { busy = false; }
}

async function action(command, extra) {
  try { render(await request(command, extra)); }
  catch (error) { $('error').hidden = false; $('error').textContent = error.message; }
}
$('toggle').addEventListener('click', () => action(state?.running ? 'stop' : 'start'));
$('scan').addEventListener('click', () => action('scan'));
$('search').addEventListener('input', renderRows);
for (const nextView of ['tabs', 'processes']) {
  const id = nextView === 'tabs' ? 'tab-view' : 'process-view';
  $(id).addEventListener('click', () => {
    view = nextView;
    for (const candidate of ['tab-view', 'process-view']) {
      $(candidate).classList.toggle('selected', candidate === id);
      $(candidate).setAttribute('aria-pressed', String(candidate === id));
    }
    $('name-heading').textContent = view === 'tabs' ? 'TAB / PROCESS' : 'PROCESS / ID';
    renderRows();
  });
}
document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
  descending = sortKey === button.dataset.sort ? !descending : true;
  sortKey = button.dataset.sort;
  for (const other of document.querySelectorAll('[data-sort]')) {
    other.textContent = other.textContent.replace(/ [↓↑]$/, '') + (other === button ? descending ? ' ↓' : ' ↑' : '');
  }
  renderRows();
}));
$('copy-id').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.extensionId); $('copy-id').textContent = 'Copied'; }
  catch { $('copy-id').textContent = state.extensionId; }
});
$('save').addEventListener('click', async () => {
  await action('settings', { thresholdMb: $('threshold').value });
  $('saved').textContent = state.settings.thresholdMb === Number($('threshold').value) ? 'Saved' : '';
  setTimeout(() => { $('saved').textContent = ''; }, 3000);
});
document.addEventListener('visibilitychange', refresh);
void refresh();
setInterval(refresh, 1000);
