// Real extension + native host integration, isolated from your daily Chrome profile.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Chrome loads the Vite output, so test the current source rather than a stale build.
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const temporary = await mkdtemp(path.join(tmpdir(), 'tab-observatory-test-'));
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  const iframe = req.url === '/' ? `<iframe src="http://localhost:${server.address().port}/frame"></iframe>` : '';
  res.end(`<!doctype html><title>${req.url === '/popup' ? 'Observatory shared tab' : 'Observatory test tab'}</title><h1>Memory test</h1>${iframe}<script>window.allocate=()=>{window.payload=new Array(8_000_000).fill(42);return window.payload.length}</script>`);
});
let context;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const extension = path.join(root, 'extension');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    headless: true,
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    env: { ...process.env, HOME: temporary, XDG_CONFIG_HOME: path.join(temporary, '.config') },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox', '--site-per-process'],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  // A shell launcher is sufficient for Linux testing; Windows/macOS install frozen binaries.
  const launcher = path.join(temporary, 'host');
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(path.join(root, '.venv/bin/python'))} ${quote(path.join(root, 'companion/native_host.py'))}\n`);
  await chmod(launcher, 0o700);
  for (const browser of ['chromium', 'google-chrome', 'google-chrome-for-testing']) {
    const directory = path.join(temporary, '.config', browser, 'NativeMessagingHosts');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'com.tab_observatory.monitor.json'), JSON.stringify({
      name: 'com.tab_observatory.monitor', description: 'Isolated integration test',
      path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`],
    }));
  }
  await mkdir(path.join(temporary, 'profile/NativeMessagingHosts'), { recursive: true });
  await writeFile(path.join(temporary, 'profile/NativeMessagingHosts/com.tab_observatory.monitor.json'), JSON.stringify({
    name: 'com.tab_observatory.monitor', description: 'Isolated integration test',
    path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`],
  }));
  const testTab = await context.newPage();
  await testTab.goto(`http://127.0.0.1:${server.address().port}/`);
  const popupPromise = context.waitForEvent('page');
  await testTab.evaluate(() => { window.open('/popup', '_blank'); });
  const popup = await popupPromise;
  await popup.waitForLoadState();
  const dashboard = await context.newPage();
  const errors = [];
  dashboard.on('pageerror', error => errors.push(error.message));
  await dashboard.goto(`chrome-extension://${id}/dashboard.html`);
  const baselineAttached = await worker.evaluate(async () => (await chrome.debugger.getTargets()).filter(t => t.attached).map(t => t.id).sort());
  await dashboard.getByRole('button', { name: 'Start monitoring' }).click();
  const getState = () => dashboard.evaluate(() => chrome.runtime.sendMessage({ command: 'state' }));
  async function waitFor(predicate, label, timeout = 30000) {
    const end = Date.now() + timeout;
    let state;
    while (Date.now() < end) {
      state = await getState();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error(`${label}: ${JSON.stringify(state)}`);
  }
  const initial = await waitFor(s => s.at && !s.scanning && s.tabs.some(t => t.title === 'Observatory test tab' && t.pids.length), 'Real process mapping');
  const mapped = initial.tabs.find(t => t.title === 'Observatory test tab');
  console.log('Tab association:', JSON.stringify(mapped));
  assert(mapped.rssBytes > 0);
  assert(mapped.jsHeapBytes > 0);
  assert(mapped.pids.length >= 2, 'Cross-origin iframe must be mapped to its separate process');
  const fullyMapped = await waitFor(s => !s.scanning && s.tabs.find(t => t.title === 'Observatory shared tab')?.pids.length, 'Shared tab mapping');
  assert(fullyMapped.tabs.find(t => t.id === mapped.id).sharedPids.length > 0, 'Tabs sharing a renderer must be labeled');
  assert.equal(fullyMapped.total.rssBytes, fullyMapped.processes.reduce((n, p) => n + p.rssBytes, 0));
  assert(initial.processes.some(p => p.kind === 'browser'));
  console.log('Mapped live tab to OS process:', mapped.pids, 'resident MB:', Math.round(mapped.rssBytes / 1024 ** 2));
  await testTab.evaluate(() => window.allocate());
  const increased = await waitFor(s => s.tabs.find(t => t.id === mapped.id)?.rssBytes > mapped.rssBytes + 20 * 1024 ** 2, 'Memory allocation visible in OS samples');
  console.log('Observed allocation increase MB:', Math.round((increased.tabs.find(t => t.id === mapped.id).rssBytes - mapped.rssBytes) / 1024 ** 2));
  await waitFor(s => s.tabs.find(t => t.id === mapped.id)?.cpuPercent != null, 'CPU delta sample');
  await dashboard.getByRole('button', { name: 'Processes', exact: true }).click();
  await dashboard.locator('#search').fill('browser');
  assert(await dashboard.locator('#rows').innerText().then(text => text.includes('browser')));
  await dashboard.locator('#search').fill('');
  await dashboard.getByRole('button', { name: 'Tabs', exact: true }).click();
  await dashboard.locator('#threshold').fill('1200');
  await dashboard.getByRole('button', { name: 'Save', exact: true }).click();
  await waitFor(s => s.settings.thresholdMb === 1200, 'Alert setting saved');
  await dashboard.waitForTimeout(1100);
  await dashboard.setViewportSize({ width: 1440, height: 1000 });
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await dashboard.screenshot({ path: path.join(root, 'test-results/dashboard.png'), fullPage: true });
  await testTab.goto(`http://127.0.0.1:${server.address().port}/navigated`);
  const navigated = await getState();
  assert.equal(navigated.tabs.find(t => t.id === mapped.id).rssBytes, null);
  await dashboard.getByRole('button', { name: 'Pause monitoring' }).click();
  const paused = await getState();
  assert.equal(paused.running, false);
  assert.equal(paused.processes.length, 0);
  const afterAttached = await worker.evaluate(async () => (await chrome.debugger.getTargets()).filter(t => t.attached).map(t => t.id));
  assert(afterAttached.every(id => baselineAttached.includes(id)), 'No new attached debugger targets after pause');
  for (const browser of ['chromium', 'google-chrome', 'google-chrome-for-testing']) {
    await rm(path.join(temporary, '.config', browser, 'NativeMessagingHosts'), { recursive: true, force: true });
  }
  await rm(path.join(temporary, 'profile/NativeMessagingHosts'), { recursive: true, force: true });
  await dashboard.getByRole('button', { name: 'Start monitoring' }).click();
  const missing = await waitFor(s => s.hostError.includes('not found'), 'Missing companion is reported');
  assert.equal(missing.total.rssBytes, 0);
  assert.equal(missing.at, null);
  await dashboard.getByRole('button', { name: 'Pause monitoring' }).click();
  assert.deepEqual(errors, []);
  console.log('PASS: native connection, iframe/shared process mapping, real allocation, views, navigation invalidation, pause cleanup, missing companion.');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
