import './legacy.css';
import type { OwnedProcess, TabRow, Totals } from '../shared/model.ts';

// Temporary 1:1 port of the original dashboard; replaced by the React UI.
type State = {
  running: boolean; scanning: boolean; scanProgress: { current: number; total: number } | null; settings: { thresholdMb: number };
  hostError: string; platform: string | null; at: number | null; warnings: string[];
  total: Totals; peak: number; history: { at: number; rssBytes: number }[];
  tabs: TabRow[]; processes: OwnedProcess[]; extensionId: string;
};
type Row = TabRow | OwnedProcess;
type SortKey = 'rssBytes' | 'privateBytes' | 'cpuPercent' | 'jsHeapBytes';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
let state: State | undefined;
let view = 'tabs';
let sortKey: SortKey = 'rssBytes';
let descending = true;
let busy = false;
const bytes = (n: number | null | undefined) => n == null ? '—' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
const percent = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(1)}%`;
const sortValue = (row: Row) => (row as Partial<Record<SortKey, number | null>>)[sortKey];
const isTab = (_row: Row): _row is TabRow => view === 'tabs';

async function request(command: string, extra: object = {}): Promise<State> {
  const result = await chrome.runtime.sendMessage({ command, ...extra });
  if (result?.error) throw new Error(result.error);
  return result;
}

function cell(text: string, className?: string) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function renderRows() {
  if (!state) return;
  const needle = input('search').value.toLowerCase();
  const source: Row[] = view === 'tabs' ? state.tabs : state.processes;
  const data = source.filter(row => {
    const r = row as Partial<TabRow & OwnedProcess>;
    return JSON.stringify([r.title, r.url, r.pid, r.pids, r.kind]).toLowerCase().includes(needle);
  });
  data.sort((a, b) => {
    const x = sortValue(a), y = sortValue(b);
    if (x == null) return y == null ? 0 : 1;
    if (y == null) return -1;
    return (x - y) * (descending ? -1 : 1);
  });
  const fragment = document.createDocumentFragment();
  for (const row of data) {
    const tr = document.createElement('tr');
    const name = cell('');
    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = isTab(row) ? row.title : `${row.kind} · PID ${row.pid}`;
    const sub = document.createElement('div');
    sub.className = 'row-subtitle';
    sub.textContent = isTab(row) ? `${row.url || ''}${row.pids.length ? ` · PID ${row.pids.join(', ')}` : ''}` :
      row.tabIds.length ? `${row.tabIds.length} observed tab association(s)` : 'Browser overhead, worker, extension or unmapped process';
    name.append(title, sub);
    const attribution = cell('');
    const tag = document.createElement('span');
    const shared = isTab(row) ? row.sharedPids.length > 0 : row.tabIds.length > 1;
    tag.className = `tag${shared ? ' shared' : isTab(row) && !row.pids.length ? ' dim' : ''}`;
    tag.textContent = shared ? 'Shared process' : isTab(row) ? row.status : 'OS process';
    tag.title = isTab(row) ? `${row.status}${row.mappedAt ? ` · scanned ${new Date(row.mappedAt).toLocaleTimeString()}` : ''}` : 'Measured once in browser totals';
    attribution.append(tag);
    const heap = isTab(row) ? row.jsHeapBytes : null;
    tr.append(name, cell(bytes(row.rssBytes)), cell(bytes(row.privateBytes)), cell(percent(row.cpuPercent)), cell(bytes(heap)), attribution);
    fragment.append(tr);
  }
  if (!data.length) {
    const tr = document.createElement('tr');
    const td = cell(needle ? 'No matching rows.' : 'No process samples yet. Connect the companion and start monitoring.', 'empty');
    td.colSpan = 6; tr.append(td); fragment.append(tr);
  }
  $('rows').replaceChildren(fragment);
}

function renderChart(current: State) {
  const points = current.history.filter(p => Date.now() - p.at < 15 * 60 * 1000);
  const max = Math.max(...points.map(p => p.rssBytes), 1) * 1.15;
  const first = Math.max(Date.now() - 15 * 60 * 1000, points[0]?.at || 0);
  const span = Math.max(Date.now() - first, 3000);
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${Math.max(0, (point.at - first) / span * 1000).toFixed(1)},${(105 - point.rssBytes / max * 100).toFixed(1)}`).join(' ');
  $('line').setAttribute('d', path);
  $('area').setAttribute('d', points.length ? `${path} L${Math.max(0, (points.at(-1)!.at - first) / span * 1000)},110 L0,110 Z` : '');
}

function render(next: State) {
  state = next;
  const hasSample = !!state.at;
  $('toggle').textContent = state.running ? 'Pause monitoring' : 'Start monitoring';
  $<HTMLButtonElement>('scan').disabled = !state.running || state.scanning;
  $('status').textContent = state.scanning ? state.scanProgress ? `Mapping tab ${state.scanProgress.current} of ${state.scanProgress.total}` : 'Mapping tabs…' : state.running ? hasSample ? '● Live · every 3 seconds' : 'Connecting…' : 'Paused';
  $('status').classList.toggle('live', state.running && hasSample);
  $('setup').hidden = hasSample;
  $('error').hidden = !state.hostError;
  $('error').textContent = state.hostError ? `${state.hostError}. Check the companion installation in the setup panel and retry monitoring.` : '';
  $('warnings').hidden = !state.warnings?.length;
  $('warnings').textContent = state.warnings?.join(' · ') || '';
  $('rss').textContent = hasSample ? bytes(state.total.rssBytes) : '—';
  $('private').textContent = hasSample ? bytes(state.total.privateBytes) : '—';
  $('cpu').textContent = hasSample ? percent(state.total.cpuPercent) : '—';
  $('processes').textContent = hasSample ? String(state.total.processCount) : '—';
  $('coverage').textContent = `${state.tabs.filter(t => t.pids.length).length} of ${state.tabs.length} tabs mapped · ${state.platform || 'local only'}`;
  $('peak').textContent = `Session peak ${state.peak ? bytes(state.peak) : '—'}`;
  $('updated').textContent = hasSample ? `Updated ${new Date(state.at!).toLocaleTimeString()}` : 'Waiting for samples';
  renderChart(state);
  $('windows-command').textContent = `py -3 scripts/install_host.py ${state.extensionId}`;
  $('mac-command').textContent = `python3 scripts/install_host.py ${state.extensionId}`;
  if (document.activeElement !== $('threshold')) input('threshold').value = String(state.settings.thresholdMb);
  renderRows();
}

function showError(error: unknown) {
  $('error').hidden = false;
  $('error').textContent = (error as Error).message;
}

async function refresh() {
  if (busy || document.hidden) return;
  busy = true;
  try { render(await request('state')); }
  catch (error) { showError(error); }
  finally { busy = false; }
}

async function action(command: string, extra?: object) {
  try { render(await request(command, extra)); }
  catch (error) { showError(error); }
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
document.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach(button => button.addEventListener('click', () => {
  descending = sortKey === button.dataset.sort ? !descending : true;
  sortKey = button.dataset.sort as SortKey;
  for (const other of document.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
    other.textContent = other.textContent!.replace(/ [↓↑]$/, '') + (other === button ? descending ? ' ↓' : ' ↑' : '');
  }
  renderRows();
}));
$('copy-id').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state!.extensionId); $('copy-id').textContent = 'Copied'; }
  catch { $('copy-id').textContent = state!.extensionId; }
});
$('save').addEventListener('click', async () => {
  await action('settings', { thresholdMb: input('threshold').value });
  $('saved').textContent = state!.settings.thresholdMb === Number(input('threshold').value) ? 'Saved' : '';
  setTimeout(() => { $('saved').textContent = ''; }, 3000);
});
document.addEventListener('visibilitychange', refresh);
void refresh();
setInterval(refresh, 1000);
