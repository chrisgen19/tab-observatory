# Dashboard Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Tab Observatory extension in TypeScript + Vite + React + Tailwind so the dashboard ranks tabs by memory freed if closed, groups shared-process tabs, and lets you focus, sleep or close them, with event-driven scanning.

**Architecture:** Port the existing JS and its tests 1:1 to TypeScript first (Task 1), then split the background into modules with tab-scanner behaviour unchanged (Task 2). Only then change behaviour: ranking, scan queue, actions, port protocol, companion (Tasks 3 to 7). The React UI comes last (Tasks 8 to 12), then e2e, packaging and docs (Task 13). Vite builds into `extension/`, so the unpacked load path and extension ID never change.

**Tech Stack:** TypeScript 7, Vite 8, React 19, Tailwind 4 (`@tailwindcss/vite`), Zod 4, lucide-react, `@types/chrome`, Node 24 `node --test` with native type stripping, Python 3 + psutil companion, Playwright for the browser test.

**Spec:** `docs/superpowers/specs/2026-10-28-dashboard-refactor-design.md`

## Global Constraints

- Branch `feature/dashboard-refactor`. Conventional Commits. No em dashes or en dashes in anything you write (code comments, copy, commits).
- npm (existing `package-lock.json`), Node 24. Versions found 2026-10-28: react/react-dom 19.3.1, zod 4.6.7, lucide-react 1.62.0, vite 8.3.5, @vitejs/plugin-react 6.1.2, typescript 7.0.2, @types/react(-dom) 19.3.0, @types/chrome 0.3.7, tailwindcss and @tailwindcss/vite 4.3.3. Install exactly these; no other packages. No linter, no test runner.
- For Vite, Zod, Tailwind and React APIs, check the installed version's types in `node_modules` before using an option (for example Vite 8 may name it `build.rolldownOptions` rather than `rollupOptions`).
- TS config: `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`. Imports between `.ts` files use the `.ts` extension. No enums, no parameter properties, `import type` for types.
- Pure logic lives in `.ts` files (Node can run them in tests); `.tsx` files hold components only. Node cannot run `.tsx`, so every rule a component relies on is a tested `.ts` helper.
- Named exports, kebab-case file names, `function` components, arrow utilities, `unknown` over `any`, functions ≤ 50 lines, components ≤ 150 lines.
- Build output is `extension/` (gitignored). `public/manifest.json` keeps `minimum_chrome_version: "125"` and exactly the permissions `["tabs", "debugger", "nativeMessaging", "storage", "alarms"]`.
- Settings ranges: threshold 100 to 100,000 MB (default 1000); theme `system | light | dark` (default `system`); full refresh minutes `2 | 5 | 10 | 0` where 0 means Off (default 5); show restricted tabs (default false).
- Timing: companion poll 3 s, history ring buffer 300 points, state push coalesced to at most one per 250 ms, scan debounce 1000 ms, per-tab scan budget 12 s / 2.5 s per command (unchanged), companion USS read at most every 15 s per process.
- Commands: `npm run build`, `npm run dev` (`vite build --watch`), `npm run check` (`tsc --noEmit`), `npm test` (`node --test "tests/**/*.test.ts"`), `npm run test:browser`, Python: `.venv/bin/python -m unittest discover -s tests -p 'test_*.py'`.

## Review Focus

1. **A tab whose scan keeps failing** (DevTools open, timeout, debugger refused) must not be rescanned on every 3 s sample, or the debugging banner flashes nonstop. Retry it only on navigation, full refresh or manual rescan. Test: Task 4 `staleTabIds skips error mappings unless the URL changed`.
2. **Acting on a row drawn before the tab navigated or closed** must refuse with a message, never act on the new page. Test: Task 5 `sleepTab refuses when the URL changed` and `closeTab reports an already closed tab`.
3. **USS unavailable for every process** (common on macOS helpers) must still rank by resident memory and mark values as estimates, not show blanks or sort everything to the bottom. Test: Task 3 `falls back to resident memory and marks estimates`.
4. **Service worker restarts while the dashboard is open**: the dashboard must reconnect and show live data again without a reload. Test: Task 8 `reconnect delay` helper test plus the manual check in Task 8 Step 6.
5. **Sleep both where Chrome refuses one tab** (active tab): the others still sleep and the message names the refused tab. Test: Task 5 `sleepGroup reports partial success`.

---

### Task 1: TypeScript toolchain and 1:1 port

Same behaviour, now TypeScript and built by Vite. Tests are ported first and must pass against the ported code with identical assertions.

**Files:**
- Create: `tsconfig.json`, `vite.config.ts`, `dashboard.html` (root, Vite entry), `public/manifest.json` (copy of `extension/manifest.json`), `src/shared/model.ts`, `src/shared/deadline.ts`, `src/background/index.ts` (port of `extension/background.js`, still one file), `src/dashboard/legacy-dashboard.ts` (port of `dashboard.js`), `src/dashboard/legacy.css` (copy of `dashboard.css`), `tests/helpers/fake-chrome.ts`, `tests/model.test.ts`, `tests/deadline.test.ts`, `tests/background.test.ts`
- Delete: `extension/*` (via `git rm`), `tests/model.test.js`, `tests/deadline.test.js`, `tests/background.test.js`
- Modify: `package.json`, `.gitignore` (add `extension/`), `tests/browser.mjs` (run `npm run build` before launching)

**Interfaces:**
- Produces, in `src/shared/model.ts` (same semantics as today, including the 60 s expiry):
  - `type ProcessSample = { pid: number; createdAt?: number | null; kind: string; rssBytes: number; privateBytes: number | null; cpuPercent: number | null }`
  - `type Mapping = { at: number; url: string; pids: number[]; jsHeapBytes: number | null; frameCount?: number; mappedFrameCount?: number; error?: string }`
  - `type TabRow` = today's row object (`id, title, url, discarded, pids, status, mappedAt, rssBytes, privateBytes, cpuPercent, jsHeapBytes, sharedPids`) plus `favIconUrl?: string; windowId?: number; active?: boolean` copied from the tab
  - `type OwnedProcess = ProcessSample & { tabIds: number[] }`, `type Totals = { rssBytes: number; privateBytes: number | null; cpuPercent: number | null; processCount: number }`
  - `framesFromEvents(events: TraceEvent[]): FrameInfo[]`, `associate(tabs: chrome.tabs.Tab[], mappings: Record<number, Mapping>, processes: ProcessSample[], now?: number): { tabs: TabRow[]; processes: OwnedProcess[] }`, `totals(processes: ProcessSample[]): Totals`
- Produces, in `src/shared/deadline.ts`: `withTimeout<T>(operation: () => T | Promise<T>, ms: number, label: string): Promise<T>`, `scanDeadline(isActive: () => boolean, budget?: number, commandLimit?: number): { check(): void; run<T>(op: () => T | Promise<T>, label: string, limit?: number): Promise<T> }`
- Produces, in `tests/helpers/fake-chrome.ts`: `installFakeChrome(options: { tabs: FakeTab[]; sendCommand: FakeSendCommand; snapshot?: () => object }): FakeChrome` that assigns `globalThis.chrome` and exposes `event()`-style emitters (`debugger.onEvent.emit`, `runtime.onMessage` handler capture, `runtime.onConnect.emit` for Task 6) and `attached: Set<number>`; `uninstallFakeChrome(): void`. Extracted from today's `tests/background.test.js:4-52`.

- [ ] **Step 1: Install packages**

Run: `npm install react@19.3.1 react-dom@19.3.1 zod@4.6.7 lucide-react@1.62.0 && npm install -D vite@8.3.5 @vitejs/plugin-react@6.1.2 typescript@7.0.2 @types/react@19.3.0 @types/react-dom@19.3.0 @types/chrome@0.3.7 tailwindcss@4.3.3 @tailwindcss/vite@4.3.3`
Expected: exit 0. Read any peer dependency warnings and report them; do not switch versions without asking.

- [ ] **Step 2: Add config and scripts**

`package.json` scripts: `build: "vite build"`, `dev: "vite build --watch"`, `check: "tsc --noEmit"`, `test: "node --test \"tests/**/*.test.ts\""`, keep `test:browser`. `vite.config.ts`: `base: './'`, `publicDir: 'public'`, `build.outDir: 'extension'`, `emptyOutDir: true`, inputs `dashboard: 'dashboard.html'` and `background: 'src/background/index.ts'`, entry file name `background.js` for the background entry and `assets/[name]-[hash].js` otherwise, plugins `react()` and `tailwindcss()`. Add `extension/` to `.gitignore`.

- [ ] **Step 3: Port the tests (they fail: modules missing)**

Copy each test's assertions unchanged into `tests/model.test.ts`, `tests/deadline.test.ts`, `tests/background.test.ts`, changing only imports to `../src/shared/model.ts`, `../src/shared/deadline.ts`, `../src/background/index.ts` and moving the fake chrome into `tests/helpers/fake-chrome.ts`.

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/...`.

- [ ] **Step 4: Port the modules 1:1**

Create the `src/` files by copying `extension/*.js`, add types, change imports to `.ts`. No logic changes. `legacy-dashboard.ts` and `legacy.css` keep today's DOM and look; `dashboard.html` is today's markup with the script pointing at `./src/dashboard/legacy-dashboard.ts` and the stylesheet imported from it. Then `git rm -r extension`.

- [ ] **Step 5: Verify**

Run: `npm run check && npm test && npm run build`
Expected: no type errors; all ported tests pass (same names as before); `extension/` contains `manifest.json`, `background.js`, `dashboard.html`, `assets/`.

Run: `npm run test:browser`
Expected: ends with `PASS: native connection, iframe/shared process mapping, ...` (requires the local Chromium setup in the README; if it cannot run here, say so and do the manual check: load `extension/` unpacked, start monitoring, see tabs mapped).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: port extension to TypeScript built by Vite"
```

---

### Task 2: Split the background into modules (behaviour unchanged)

**Files:**
- Create: `src/background/store.ts`, `src/background/host-connection.ts`, `src/background/tab-scanner.ts`
- Modify: `src/background/index.ts` (wiring only)
- Test: `tests/tab-scanner.test.ts` (new), `tests/background.test.ts` (unchanged and must pass)

**Interfaces:**
- Produces, `store.ts`: `type Store = { running: boolean; hostError: string; snapshot: (Snapshot & { receivedAt: number }) | null; mappings: Record<number, Mapping>; scanning: boolean; scanProgress: string; generation: number; history: HistoryPoint[]; peak: number; settings: Settings }`, `const store: Store`, `resetStore(): void`. `type HistoryPoint = { at: number; rssBytes: number; cpuPercent: number | null }`. `Settings` here is `{ thresholdMb: number }` until Task 5 replaces it.
- Produces, `host-connection.ts`: `connectHost(): void`, `poll(): void`, `disconnectHost(): void`. Snapshot handling (history slice to 300, peak, badge `HIGH` above threshold) lives here, unchanged.
- Produces, `tab-scanner.ts`: `scanTab(tab: chrome.tabs.Tab, token: number): Promise<void>` (writes `store.mappings[tab.id]`), `handleDebuggerEvent(source: chrome.debugger.DebuggerSession, method: string, params: unknown): void`, `handleDebuggerDetach(source: chrome.debugger.Debuggee): void`, `rejectPendingTraces(reason: string): void`, `detachAll(): Promise<void>`. Split today's `traceTab` (`extension/background.js:108-207`) into `attachTab`, `collectContexts`, `emitMarkers`, `resolveMapping`, `cleanupTab`, each ≤ 50 lines.
- `index.ts` keeps `scan()`, `start()`, `stop()`, `state()` and the `onMessage` router as today.

- [ ] **Step 1: Write the tab-scanner tests**

```ts
test('maps root and iframe sessions to their marker PIDs', async () => {
  // fake: root context frameId 'root'; Target.attachedToTarget for iframe session 's1'
  // with context frameId 'child'; Tracing.end emits TimeStamp pid 42 for the root marker
  // and pid 77 for the s1 marker
  await scanTab(tab, store.generation);
  assert.deepEqual(store.mappings[1].pids.sort(), [42, 77]);
  assert.equal(store.mappings[1].frameCount, 2);
  assert.equal(store.mappings[1].mappedFrameCount, 2);
  assert.equal(fake.attached.size, 0);
});

test('a tab that navigates during the scan gets no mapping', async () => {
  // fake tabs.get returns a different url than the scanned tab
  await scanTab(tab, store.generation);
  assert.equal(store.mappings[1], undefined);
});

test('an unexpected detach rejects the trace with the DevTools message', async () => {
  // fake: emit onDetach for tab 1 while Tracing.end is pending
  await scanTab(tab, store.generation);
  assert.match(store.mappings[1].error!, /Debugger detached; retry scan when DevTools is closed/);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test tests/tab-scanner.test.ts`
Expected: FAIL, `tab-scanner.ts` not found.

- [ ] **Step 3: Move code into the modules**

Cut and paste from `index.ts`; the only edits are reading and writing state through `store` and the function split above. No behaviour change.

- [ ] **Step 4: Verify**

Run: `npm run check && npm test`
Expected: all pass, including the unchanged `background.test.ts` (`a hung first tab does not block memory readings from the next tab`).

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "refactor(background): split into store, host connection and tab scanner"
```

---

### Task 3: Ranking model ("frees")

**Files:**
- Create: `src/shared/ranking.ts`
- Test: `tests/ranking.test.ts`

**Interfaces:**
- Consumes: `TabRow`, `OwnedProcess` (Task 1).
- Produces:
  - `type TabState = 'mapped' | 'partial' | 'scanning' | 'pending' | 'error' | 'restricted' | 'sleeping'`
  - `type RankedTab = TabRow & { state: TabState; freesBytes: number | null; sharedBytes: number; estimated: boolean }`
  - `type RankedEntry = { kind: 'tab'; tab: RankedTab } | { kind: 'group'; id: string; tabs: RankedTab[]; sharedPids: number[]; sharedBytes: number; freesBytes: number; estimated: boolean; partial: boolean }`
  - `type Ranking = { entries: RankedEntry[]; restricted: RankedTab[]; unscannedCount: number; notInAnyTabBytes: number }`
  - `rankTabs(rows: TabRow[], processes: OwnedProcess[], scanningTabId: number | null): Ranking`

Rules (from spec section 1): a process's value is `privateBytes ?? rssBytes` (fallback sets `estimated`). Exclusive = one owner; shared = 2+. Tab `freesBytes` = sum of exclusive values; `sharedBytes` = sum of shared values. Groups = connected components over shared PIDs; group id = sorted member tab ids joined with `-`; group `freesBytes` = members' `freesBytes` + each shared process once; `partial` = any member `state === 'partial'`. Order: mapped/partial entries by `freesBytes` desc (members inside a group likewise), then unmapped tabs in the order scanning, pending, error. `restricted` = non-http(s) and sleeping tabs, excluded from `entries`. `unscannedCount` = scanning + pending. `notInAnyTabBytes` = sum of `rssBytes` of processes with no `tabIds`. State mapping: `discarded` → sleeping; non-http(s) → restricted; `id === scanningTabId` → scanning; has PIDs and `status` starts with `Partial` → partial; has PIDs → mapped; mapping error → error; else pending.

Deviation from the spec's builder-check call: the spec says a group gets `Partial` while a tab sharing its process is unmapped, but an unmapped tab's processes are unknown, so that can't be detected. Instead `partial` covers members with partial frame mappings, and `unscannedCount` drives a list-level notice (Task 9) that the ranking may change.

Grouping algorithm (union-find keyed by tab id):

```ts
const parent = new Map<number, number>();
const find = (id: number): number => { const p = parent.get(id) ?? id; if (p === id) return id; const r = find(p); parent.set(id, r); return r; };
for (const proc of processes) if (proc.tabIds.length > 1)
  for (const other of proc.tabIds.slice(1)) parent.set(find(other), find(proc.tabIds[0]));
```

- [ ] **Step 1: Write the failing tests**

```ts
test('exclusive memory ranks; shared memory is not counted on each tab', () => {
  // tab 1 owns pid 10 (private 800), tabs 2 and 3 share pid 30 (private 210) and own 20 (96) and 21 (41)
  const r = rankTabs(rows, procs, null);
  assert.deepEqual(r.entries.map(e => e.kind === 'tab' ? e.tab.id : e.id), [1, '2-3']);
  const group = r.entries[1] as Extract<RankedEntry, { kind: 'group' }>;
  assert.equal(group.freesBytes, 96 + 41 + 210);
  assert.deepEqual(group.tabs.map(t => [t.id, t.freesBytes, t.sharedBytes]), [[2, 96, 210], [3, 41, 210]]);
});

test('transitive sharing forms one group of three', () => {
  // tabs 1,2 share pid 5; tabs 2,3 share pid 6
  assert.deepEqual(rankTabs(rows, procs, null).entries.map(e => e.kind === 'group' && e.tabs.length), [3]);
});

test('falls back to resident memory and marks estimates', () => {
  // every process privateBytes null; tab 1 rss 500, tab 2 rss 900
  const r = rankTabs(rows, procs, null);
  assert.deepEqual(r.entries.map(e => e.kind === 'tab' && [e.tab.id, e.tab.freesBytes, e.tab.estimated]), [[2, 900, true], [1, 500, true]]);
});

test('unmapped tabs rank last as scanning, pending, error', () => {
  // tab 4 error mapping, tab 5 no mapping, tab 6 is scanningTabId, tab 1 mapped
  const r = rankTabs(rows, procs, 6);
  assert.deepEqual(r.entries.map(e => e.kind === 'tab' && [e.tab.id, e.tab.state]), [[1, 'mapped'], [6, 'scanning'], [5, 'pending'], [4, 'error']]);
  assert.equal(r.unscannedCount, 2);
});

test('restricted and sleeping tabs are separated; unowned processes are totalled', () => {
  // tab 7 chrome://settings, tab 8 discarded; browser pid rss 300 and gpu pid rss 320 with no tabIds
  const r = rankTabs(rows, procs, null);
  assert.deepEqual(r.restricted.map(t => [t.id, t.state]), [[7, 'restricted'], [8, 'sleeping']]);
  assert.equal(r.notInAnyTabBytes, 620);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test tests/ranking.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `rankTabs` in `src/shared/ranking.ts`**

- [ ] **Step 4: Verify**

Run: `npm run check && node --test tests/ranking.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ranking.ts tests/ranking.test.ts
git commit -m "feat(model): rank tabs by memory freed if closed"
```

---

### Task 4: Event-driven scan queue

Replaces the 30 s full scan and the 60 s mapping expiry.

**Files:**
- Create: `src/background/scan-queue.ts`, `src/background/scan-triggers.ts`
- Modify: `src/shared/model.ts` (drop the time-based expiry from `associate`), `src/background/index.ts` (wire listeners, remove `scan()` loop and the `mapping` alarm), `src/background/store.ts` (`scanningTabId: number | null`, `scanProgress: { current: number; total: number } | null` replaces the string)
- Test: `tests/scan-queue.test.ts`, `tests/scan-triggers.test.ts`, `tests/model.test.ts`, `tests/background.test.ts`

**Interfaces:**
- Produces, `scan-triggers.ts`: `isScannable(tab: chrome.tabs.Tab): boolean` (http(s), not discarded, not incognito); `staleTabIds(tabs: chrome.tabs.Tab[], mappings: Record<number, Mapping>, processes: ProcessSample[]): number[]` (scannable tabs with no mapping, URL mismatch, or a mapped PID missing or with `createdAt * 1000 > mapping.at`; a mapping with `error` is stale only if its URL differs).
- Produces, `scan-queue.ts`: `createScanQueue(deps: { scanTab(tabId: number): Promise<void>; isActive(): boolean; onProgress(progress: { current: number; total: number } | null, tabId: number | null): void; debounceMs?: number }): { enqueue(ids: number[]): void; remove(id: number): void; clear(): void; idle(): Promise<void> }`. Deduplicates, waits `debounceMs` (default 1000) after the last enqueue, processes one tab at a time, `progress.total` grows if tabs are enqueued mid-run.
- `index.ts` wiring: the queue's `scanTab(tabId)` is `chrome.tabs.get(tabId)` then Task 2's `scanTab(tab, store.generation)` (skip if the tab is gone or no longer scannable); on start enqueue all scannable tabs; on each snapshot enqueue `staleTabIds(...)`; `tabs.onUpdated` with `url` or `status === 'complete'` after a URL change, or `discarded === false`, enqueue; `tabs.onRemoved` and discard delete the mapping and `remove`; `tabs.onReplaced(added, removed)` moves `mappings[removed]` to `mappings[added]` and enqueues `added`; alarm `full-refresh` (period = `settings.fullRefreshMinutes`, none when 0) enqueues all; `stop()` calls `clear()`.

- [ ] **Step 1: Update and add tests**

In `tests/model.test.ts` replace the `now + 60001` assertion with:

```ts
assert.equal(associate(tabs, maps, processes, now + 10 * 60000).tabs[0].rssBytes, 100); // no time expiry
```

```ts
// scan-triggers.test.ts
test('staleTabIds finds new, navigated and dead-process tabs', () => {
  assert.deepEqual(staleTabIds(tabs, { 2: navigated, 3: deadPid, 4: healthy }, procs).sort(), [1, 2, 3]);
});
test('staleTabIds skips error mappings unless the URL changed', () => {
  assert.deepEqual(staleTabIds([tab5], { 5: { ...errorMapping, url: tab5.url } }, procs), []);
  assert.deepEqual(staleTabIds([tab5], { 5: { ...errorMapping, url: 'https://old.test' } }, procs), [5]);
});
test('isScannable excludes restricted, discarded and incognito tabs', () => { /* 4 cases */ });

// scan-queue.test.ts (debounceMs: 10)
test('dedupes and scans one tab at a time in enqueue order', async () => {
  q.enqueue([1, 2]); q.enqueue([2, 3]); await q.idle();
  assert.deepEqual(scanned, [1, 2, 3]); assert.equal(maxConcurrent, 1);
});
test('reports progress and clears it when idle', async () => {
  q.enqueue([1, 2]); await q.idle();
  assert.deepEqual(progress, [[1, 2, 1], [2, 2, 2], [null, null]]); // [current, total, tabId]
});
test('clear stops pending work', async () => {
  q.enqueue([1, 2, 3]); q.clear(); await q.idle(); assert.deepEqual(scanned, []);
});
```

`tests/background.test.ts`: keep the hung-tab assertions; poll `store.scanning` via the existing `state` command until false (debounce adds ~1 s, raise the loop deadline to 9000 ms).

- [ ] **Step 2: Run, expect failures**

Run: `npm test`
Expected: FAIL in `scan-queue`, `scan-triggers` (missing modules) and the new `model` assertion.

- [ ] **Step 3: Implement `scan-triggers.ts`, `scan-queue.ts`, drop expiry in `associate`, rewire `index.ts`**

- [ ] **Step 4: Verify**

Run: `npm run check && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(background): rescan tabs on events instead of every 30 seconds"
```

---

### Task 5: Settings schema and tab actions

**Files:**
- Create: `src/shared/settings.ts`, `src/background/tab-actions.ts`
- Modify: `src/background/store.ts` (use `Settings`), `src/background/index.ts` (load with `parseSettings`)
- Test: `tests/settings.test.ts`, `tests/tab-actions.test.ts`

**Interfaces:**
- Produces, `settings.ts`: `type Settings = { thresholdMb: number; theme: 'system' | 'light' | 'dark'; fullRefreshMinutes: 0 | 2 | 5 | 10; showRestricted: boolean }`, `DEFAULT_SETTINGS: Settings`, `SettingsInputSchema` (strict Zod object, threshold int 100 to 100000 with message `Threshold must be 100 to 100,000 MB`), `parseSettings(raw: unknown): Settings` (per-field fallback to defaults, so the old stored `{ thresholdMb }` still loads).
- Produces, `tab-actions.ts`:
  - `type TabsApi = { get(id: number): Promise<chrome.tabs.Tab>; update(id: number, props: { active: boolean }): Promise<unknown>; discard(id: number): Promise<chrome.tabs.Tab | undefined>; remove(id: number): Promise<void>; focusWindow(windowId: number): Promise<void> }`
  - `type ActionTarget = { tabId: number; url: string }`, `type ActionResult = { ok: true } | { ok: false; error: string }`
  - `focusTab(api, target): Promise<ActionResult>`, `sleepTab(api, target)`, `closeTab(api, target)`, `sleepGroup(api, targets: ActionTarget[]): Promise<{ slept: number; total: number; failures: { tabId: number; title: string; error: string }[] }>`
  - Exact error copy: tab gone `Tab is already closed`; URL changed `This tab navigated since the list was drawn. Try again.`; discard refused or returned undefined `Chrome would not sleep this tab (it may be the active tab)`.
  - `createTabsApi(): TabsApi` wraps `chrome.tabs` and `chrome.windows.update(id, { focused: true })`.

- [ ] **Step 1: Write the failing tests**

```ts
test('parseSettings keeps valid fields and defaults the rest', () => {
  assert.deepEqual(parseSettings({ thresholdMb: 1200 }), { ...DEFAULT_SETTINGS, thresholdMb: 1200 });
  assert.deepEqual(parseSettings({ thresholdMb: 5, theme: 'neon', fullRefreshMinutes: 7 }), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('garbage'), DEFAULT_SETTINGS);
});
test('SettingsInputSchema rejects out-of-range thresholds with the spec message', () => {
  assert.match(SettingsInputSchema.safeParse({ ...DEFAULT_SETTINGS, thresholdMb: 99 }).error!.issues[0].message, /100 to 100,000 MB/);
});

test('sleepTab refuses when the URL changed', async () => {
  const api = fakeApi({ 1: { id: 1, url: 'https://new.test' } });
  assert.deepEqual(await sleepTab(api, { tabId: 1, url: 'https://old.test' }), { ok: false, error: 'This tab navigated since the list was drawn. Try again.' });
  assert.equal(api.discarded.length, 0);
});
test('closeTab reports an already closed tab', async () => {
  assert.deepEqual(await closeTab(fakeApi({}), { tabId: 9, url: 'https://x.test' }), { ok: false, error: 'Tab is already closed' });
});
test('focusTab activates the tab and focuses its window', async () => { /* api.updated == [1], api.focused == [windowId] */ });
test('sleepGroup reports partial success', async () => {
  // discard rejects for tab 2 (active, title 'Inbox (12) - Gmail')
  const r = await sleepGroup(api, [{ tabId: 2, url: u2 }, { tabId: 3, url: u3 }]);
  assert.deepEqual([r.slept, r.total, r.failures.map(f => f.title)], [1, 2, ['Inbox (12) - Gmail']]);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test tests/settings.test.ts tests/tab-actions.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both modules; load settings through `parseSettings` in `index.ts`**

- [ ] **Step 4: Verify**

Run: `npm run check && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(background): add settings schema and safe tab actions"
```

---

### Task 6: Dashboard port protocol (push instead of poll)

**Files:**
- Create: `src/shared/protocol.ts`, `src/background/dashboard-port.ts`, `src/background/state.ts` (move `state()` here as `buildState()`)
- Modify: `src/background/index.ts` (remove `runtime.onMessage` router; `runtime.onConnect` → hub; call `hub.notify()` after snapshot, progress, mapping, settings and action changes), `src/dashboard/legacy-dashboard.ts` (use the port so the legacy UI keeps working until Task 8), `tests/browser.mjs` (read state from a port opened in the dashboard page)
- Test: `tests/protocol.test.ts`, `tests/dashboard-port.test.ts`, `tests/background.test.ts`

**Interfaces:**
- Produces, `protocol.ts`:
  - `type DashboardState = { running: boolean; scanning: boolean; scanProgress: { current: number; total: number } | null; settings: Settings; hostError: string; platform: string | null; at: number | null; warnings: string[]; total: Totals; peak: number; history: HistoryPoint[]; tabs: TabRow[]; processes: OwnedProcess[]; ranking: Ranking; extensionId: string }`
  - `CommandSchema`: Zod discriminated union on `type`, each with `id: string`: `start`, `stop`, `rescan`, `focus | sleep | close` (`tabId: number int`, `url: string`), `sleepGroup` (`targets: { tabId, url }[]` min 1), `saveSettings` (`settings: SettingsInputSchema`). `type Command = z.infer<typeof CommandSchema>`; `type CommandInput = DistributiveOmit<Command, 'id'>`.
  - `type PortMessage = { kind: 'state'; state: DashboardState } | { kind: 'reply'; id: string; ok: true; result?: unknown } | { kind: 'reply'; id: string; ok: false; error: string }`
  - `PORT_NAME = 'dashboard'`
- Produces, `dashboard-port.ts`: `createDashboardHub(deps: { buildState(): Promise<DashboardState>; handle(command: Command): Promise<unknown>; isTrustedSender(sender: chrome.runtime.MessageSender | undefined): boolean; coalesceMs?: number }): { attach(port: chrome.runtime.Port): void; notify(): void }`. `attach` disconnects untrusted ports, sends state immediately, then pushes on `notify()`; leading push plus one trailing push per `coalesceMs` (250) window. Invalid commands reply `ok: false` with the Zod message; handler errors reply with `error.message`.
- `handle` in `index.ts`: `saveSettings` persists, updates `store.settings`, recreates or clears the `full-refresh` alarm when `fullRefreshMinutes` changes; action commands call Task 5 functions then delete the tab's mapping and enqueue it.

- [ ] **Step 1: Write the failing tests**

```ts
test('CommandSchema accepts an action and rejects a bad tab id', () => {
  assert.ok(CommandSchema.safeParse({ id: 'a', type: 'sleep', tabId: 3, url: 'https://x.test' }).success);
  assert.ok(!CommandSchema.safeParse({ id: 'a', type: 'sleep', tabId: 'x', url: 'https://x.test' }).success);
});

test('untrusted ports are disconnected without receiving state', async () => { /* fake port sender url other page */ });
test('notify bursts coalesce to a leading and a trailing push', async () => {
  hub.attach(port); await tick(); // 1 initial push
  for (let i = 0; i < 10; i++) hub.notify();
  await sleep(300);
  assert.equal(port.sent.filter(m => m.kind === 'state').length, 3);
});
test('commands get replies matched by id, including errors', async () => {
  port.emit({ id: 'x1', type: 'stop' }); port.emit({ id: 'x2', type: 'bogus' });
  await tick();
  assert.deepEqual(port.sent.filter(m => m.kind === 'reply').map(m => [m.id, m.ok]), [['x1', true], ['x2', false]]);
});
```

`tests/background.test.ts`: replace the `messageHandler` helper with a fake port connected through `fake.runtime.onConnect.emit`, send `{ id, type: 'start' }`, wait for a pushed state with `scanning === false`, keep the same three assertions (timeout status, tab 2 rss 1024 and heap 128, no attached debuggers).

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL in the new tests and in `background.test.ts`.

- [ ] **Step 3: Implement protocol, hub, `buildState()` (adds `ranking: rankTabs(...)`), rewire index and the legacy dashboard**

- [ ] **Step 4: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all pass. Load `extension/` unpacked: the legacy dashboard still starts, shows tabs and pauses.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(background): push dashboard state over a port"
```

---

### Task 7: Companion USS caching

**Files:**
- Modify: `companion/native_host.py` (`Sampler`)
- Test: `tests/test_host.py`

**Interfaces:** response shape unchanged. Add `USS_INTERVAL = 15` (seconds). `Sampler.uss: dict[tuple[int, float], tuple[int | None, float]]` keyed by `(pid, created)` storing `(value, read_at)`; entries for processes that disappeared are dropped each sample.

- [ ] **Step 1: Write the failing test**

```python
def test_uss_is_read_at_most_every_15_seconds(self):
    sampler = Sampler(make_browser())  # extract the Mock setup from test_cpu_first_sample_and_pid_reuse into make_browser()
    with patch('native_host.time.monotonic', side_effect=[10, 13, 26]):
        sampler.snapshot(); sampler.snapshot(); sampler.snapshot()
    self.assertEqual(sampler.browser.memory_full_info.call_count, 2)  # at 10 and 26
```

- [ ] **Step 2: Run, expect failure**

Run: `.venv/bin/python -m unittest tests.test_host -v`
Expected: FAIL, call_count 3.

- [ ] **Step 3: Implement the cache in `Sampler.snapshot`**

- [ ] **Step 4: Verify**

Run: `.venv/bin/python -m unittest discover -s tests -p 'test_*.py'`
Expected: all pass, including `test_cpu_first_sample_and_pid_reuse`.

- [ ] **Step 5: Commit**

```bash
git add companion/native_host.py tests/test_host.py
git commit -m "perf(companion): read private memory at most every 15 seconds"
```

---

### Task 8: React shell, theme and status

Replaces the legacy dashboard.

**Files:**
- Create: `src/dashboard/main.tsx`, `src/dashboard/app.tsx`, `src/dashboard/styles.css`, `src/dashboard/hooks/use-dashboard-port.ts`, `src/dashboard/hooks/use-theme.ts`, `src/dashboard/lib/reconnect.ts`, `src/shared/format.ts`, `src/dashboard/components/header.tsx`, `stats-strip.tsx`, `setup-panel.tsx`, `status-notice.tsx`, `about-numbers.tsx`
- Delete: `src/dashboard/legacy-dashboard.ts`, `src/dashboard/legacy.css`
- Modify: `dashboard.html` (`<div id="root">`, script `./src/dashboard/main.tsx`)
- Test: `tests/format.test.ts`, `tests/reconnect.test.ts`

**Interfaces:**
- Produces, `format.ts`: `formatBytes(n: number | null): string` (`—` for null, `X.XX GB` at ≥ 1 GiB else `X.X MB`, same as today), `formatPercent(n: number | null): string`, `formatAgo(ms: number, now: number): string` (`just now` under 10 s, `N s ago`, `N min ago`).
- Produces, `reconnect.ts`: `reconnectDelay(attempt: number): number` = `min(1000 * 2 ** attempt, 10000)`.
- Produces, `use-dashboard-port.ts`: `useDashboardPort(): { state: DashboardState | null; connected: boolean; send(command: CommandInput): Promise<unknown> }`. Connects with `PORT_NAME`, assigns `crypto.randomUUID()` ids, resolves or rejects on the matching reply, reconnects on disconnect using `reconnectDelay`.
- Produces, `use-theme.ts`: `useTheme(theme: Settings['theme']): void` sets `document.documentElement.dataset.theme` to `light` or `dark`, following `prefers-color-scheme` when `system`.
- `styles.css`: `@import "tailwindcss";`, tokens on `:root` and `[data-theme="dark"]` exactly as spec section 6 plus the mockup v2 extras (light: line-soft `#e8ede5`, track `#e3ebe5`, amber-bar `#e2c27c`, group `#fffaf0`, dim `#68756e` on `#edf0ed`, danger `#9b2c2c`, green-line `#218167`; dark: line `#26332f`, line-soft `#1f2a27`, track `#22302c`, amber-bar `#b8913f`, group `#1c1a12`, dim `#9aaaa5` on `#222c29`, danger `#f08a8a`, brand `#1f8a6b`), exposed via `@theme inline` as colors `ink, muted, brand, brand-line, line, line-soft, paper, canvas, track, amber, amber-soft, amber-bar, group, dim, dim-soft, danger`. Components use these utilities only, no hex values and no `dark:` variants.
- Header: logo, title, status, a `Rescan tabs` icon button (sends `rescan`, disabled while paused), Settings gear (`aria-label="Settings"`, wired in Task 12), Start/Pause (`Start monitoring` / `Pause monitoring`).
- Copy: header status `● Live`, `Connecting…`, `Paused`, and beside it `Mapping {current} of {total}…` while scanning. Stats strip labels `Chrome total`, `Private`, `CPU`, `Not in any tab` and the delta `+410 MB in 15 min` format (`{+|-}{formatBytes} in 15 min`, from the first and last history points in the window). Setup panel and its install commands as today. The error notice shows the host error and, only when the error is a missing or failed companion, `Check the companion installation in the setup panel and retry monitoring.`

- [ ] **Step 1: Write the failing helper tests**

```ts
test('formatBytes matches today', () => {
  assert.equal(formatBytes(null), '—'); assert.equal(formatBytes(1024 ** 3 * 3.12), '3.12 GB'); assert.equal(formatBytes(96 * 1024 ** 2), '96.0 MB');
});
test('formatAgo', () => { assert.equal(formatAgo(5000, 10000), 'just now'); assert.equal(formatAgo(0, 180000), '3 min ago'); });
test('reconnect delay backs off and caps at 10 s', () => {
  assert.deepEqual([0, 1, 2, 5].map(reconnectDelay), [1000, 2000, 4000, 10000]);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test tests/format.test.ts tests/reconnect.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement helpers, hooks, styles and the components; `app.tsx` renders Header, SetupPanel (companion not connected), StatusNotice, StatsStrip, a placeholder for the list (Task 9), AboutNumbers (today's footer and explanation copy, tightened, in a `<details>`)**

- [ ] **Step 4: Verify automated checks**

Run: `npm run check && npm test && npm run build`
Expected: all pass.

- [ ] **Step 5: Manual check**

Load `extension/`, open the dashboard: Start, Pause, the live status, setup panel when the companion is missing. Toggle the OS theme: the page follows it.

- [ ] **Step 6: Service worker restart check**

Stop the extension's worker from `chrome://serviceworker-internals` while the dashboard is open. Expected: the dashboard shows `Connecting…`, then live data within ~10 s without a page reload.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(dashboard): React shell with themes, status and stats strip"
```

---

### Task 9: Ranked tab list with groups and actions

**Files:**
- Create: `src/dashboard/components/tab-list.tsx`, `tab-row.tsx`, `shared-group.tsx`, `row-actions.tsx`, `src/dashboard/lib/list-view.ts`
- Modify: `src/dashboard/app.tsx`
- Test: `tests/list-view.test.ts`

**Interfaces:**
- Consumes: `Ranking`, `RankedEntry`, `RankedTab` (Task 3), `useDashboardPort().send` (Task 8), commands (Task 6).
- Produces, `list-view.ts`:
  - `filterEntries(entries: RankedEntry[], needle: string): RankedEntry[]` (case-insensitive on title, URL and PIDs; a group stays if any member matches and keeps only matching members)
  - `barWidths(tab: RankedTab, maxFrees: number): { own: number; shared: number }` (percent, 0 to 100, own = `freesBytes / maxFrees`, shared = `sharedBytes / maxFrees`, clamped so own + shared ≤ 100)
  - `groupLabel(count: number): string` → `Sleep both` for 2, `Sleep all {n}` otherwise
  - `canAct(tab: RankedTab, extensionId: string): { focus: boolean; sleep: boolean; close: boolean }` (no sleep for sleeping tabs; nothing for the dashboard's own URL `chrome-extension://{extensionId}/`)
- Copy (from mockup v2): card title `Tabs`, subtitle `ranked by memory freed if closed`; group header `Shared process · {formatBytes(sharedBytes)}` and `freed only when every tab in it sleeps or closes`; state tags `Scanning…`, `Not scanned yet`, `Mapping failed: {error}`, `Partial`; `{n} restricted tabs hidden · Show` / `Hide`; when `unscannedCount > 0`: `{n} tabs not scanned yet; the ranking may change`; filter empty `No matching tabs.`; no http(s) tabs `Open a web page to see it here.`; estimates prefixed `≈` with title `Private memory unavailable; using resident memory`.
- Row: favicon from `favIconUrl` (fallback: a tile with the title's first letter), title, bar, `formatBytes(freesBytes)`, and a `title` tooltip `scanned {formatAgo(mappedAt)}` when mapped.
- Buttons: Focus (ghost), Sleep, Close (danger text), each with `aria-label="{Action} {tab title}"`. Group button amber. Failed action shows the reply error inline under the row for 5 s. Show-restricted state initialises from `settings.showRestricted`.
- At < 640px: stacked rows (title + MB, bar, actions right-aligned); inside groups Focus and Close move into a `⋯` menu (native `<details>` popover is fine), Sleep stays.

- [ ] **Step 1: Write the failing tests**

```ts
test('filter keeps a group with only its matching members', () => {
  const out = filterEntries(entries, 'gmail');
  assert.deepEqual(out.map(e => e.kind === 'group' ? e.tabs.map(t => t.id) : e.tab.id), [[2]]);
});
test('bar widths scale to the largest entry and never exceed 100', () => {
  assert.deepEqual(barWidths({ ...tab, freesBytes: 96, sharedBytes: 210 }, 812), { own: 11.8, shared: 25.9 });
  assert.deepEqual(barWidths({ ...tab, freesBytes: 812, sharedBytes: 210 }, 812), { own: 100, shared: 0 });
});
test('group label', () => { assert.equal(groupLabel(2), 'Sleep both'); assert.equal(groupLabel(3), 'Sleep all 3'); });
test('the dashboard tab cannot be acted on', () => {
  assert.deepEqual(canAct({ ...tab, url: 'chrome-extension://abc/dashboard.html' }, 'abc'), { focus: false, sleep: false, close: false });
});
```

(Round widths to one decimal.)

- [ ] **Step 2: Run, expect failure**

Run: `node --test tests/list-view.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `list-view.ts` and the components; mount `TabList` in `app.tsx`**

- [ ] **Step 4: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all pass.

- [ ] **Step 5: Manual check at 1440px and 375px (DevTools device toolbar), light and dark**

Open three tabs on one site (shares a process) and a heavy page. Expected: heavy page on top; the same-site tabs in an amber group with `Sleep both` or `Sleep all 3`; Sleep discards; Close closes; Focus switches; sleeping the active tab shows the refusal inline. Compare against `.superpowers/brainstorm/*/content/layout-v2.html`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(dashboard): ranked tab list with shared groups and actions"
```

---

### Task 10: Memory chart

**Files:**
- Create: `src/dashboard/lib/chart.ts`, `src/dashboard/components/memory-chart.tsx`, `sparkline.tsx`
- Modify: `src/dashboard/components/stats-strip.tsx` (sparkline + expand button opening the full chart below the strip)
- Test: `tests/chart.test.ts`

**Interfaces:**
- Produces, `chart.ts`:
  - `type Series = 'memory' | 'cpu'`; `seriesValues(history: HistoryPoint[], series: Series, from: number): { at: number; value: number }[]` (drops points older than `from` and null CPU values)
  - `chartScale(values: number[], minSpan: number): { min: number; max: number; ticks: [number, number, number] }`: padding 10% of the range each side, range at least `minSpan` (memory `64 * 1024 ** 2`, CPU `5`), min never below 0, ticks at min, middle, max
  - `chartPath(points: { at: number; value: number }[], scale: { min: number; max: number }, window: { from: number; to: number }, size: { width: number; height: number }): string`
  - `nearestPoint<T extends { at: number }>(points: T[], at: number): T | null`
- Chart: 15-minute window, three labelled gridlines (formatted with `formatBytes` or `formatPercent`), x labels `15 min ago` and `now`, hover crosshair with time and value, `Memory` / `CPU` toggle, dashed threshold line when `thresholdMb * 1024 ** 2` is within the memory scale. Hand-rolled SVG, no library. `role="img"` with an `aria-label` describing the latest value.

- [ ] **Step 1: Write the failing tests**

```ts
test('scale is auto-ranged, not from zero', () => {
  const s = chartScale([2.7e9, 3.1e9], 64 * 1024 ** 2);
  assert.ok(s.min > 2.6e9 && s.min < 2.7e9); assert.ok(s.max > 3.1e9 && s.max < 3.2e9);
});
test('flat series still gets the minimum span and never goes below zero', () => {
  const s = chartScale([10, 10], 64); assert.equal(s.max - s.min >= 64, true); assert.ok(s.min >= 0);
});
test('path maps time to x and value to y', () => {
  assert.equal(chartPath([{ at: 0, value: 0 }, { at: 10, value: 10 }], { min: 0, max: 10 }, { from: 0, to: 10 }, { width: 100, height: 50 }), 'M0.0,50.0 L100.0,0.0');
});
test('cpu series skips unknown samples', () => {
  assert.equal(seriesValues([{ at: 1, rssBytes: 1, cpuPercent: null }, { at: 2, rssBytes: 1, cpuPercent: 4 }], 'cpu', 0).length, 1);
});
test('nearestPoint', () => { assert.equal(nearestPoint([{ at: 0 }, { at: 10 }], 7)?.at, 10); });
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test tests/chart.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement helpers and components**

- [ ] **Step 4: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all pass. Manual: open a heavy page; the line visibly rises (not flat), hover shows values, CPU toggle works, both themes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dashboard): auto-ranged memory and CPU chart"
```

---

### Task 11: Process view

**Files:**
- Create: `src/dashboard/lib/process-view.ts`, `src/dashboard/components/process-list.tsx`
- Modify: `src/dashboard/components/tab-list.tsx` (the `Processes` switch toggles views; filter applies to both)
- Test: `tests/process-view.test.ts`

**Interfaces:**
- Produces: `type ProcessSort = { key: 'rssBytes' | 'privateBytes' | 'cpuPercent'; descending: boolean }`; `groupProcesses(processes: OwnedProcess[], tabs: TabRow[], sort: ProcessSort): { owned: { process: OwnedProcess; tabs: TabRow[] }[]; unowned: OwnedProcess[] }` (nulls sort last in both directions); `ariaSort(sort: ProcessSort, key: ProcessSort['key']): 'ascending' | 'descending' | 'none'`.
- UI: owned processes as `{kind} · PID {pid}` rows with their tabs nested; unowned under a `Not in any tab` heading (browser, GPU, utility, extensions). Sortable headers are `<button>`s inside `<th aria-sort>`.

- [ ] **Step 1: Write the failing tests**

```ts
test('owned processes carry their tabs; unowned are separate', () => {
  const v = groupProcesses(procs, rows, { key: 'rssBytes', descending: true });
  assert.deepEqual(v.owned.map(o => [o.process.pid, o.tabs.map(t => t.id)]), [[30, [2, 3]], [10, [1]]]);
  assert.deepEqual(v.unowned.map(p => p.kind), ['gpu-process', 'browser']);
});
test('null values sort last in both directions', () => { /* privateBytes null process last for asc and desc */ });
test('ariaSort', () => { assert.equal(ariaSort({ key: 'cpuPercent', descending: false }, 'cpuPercent'), 'ascending'); });
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test tests/process-view.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all pass. Manual: switch to Processes, sort each column, filter `browser`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dashboard): process view with nested tabs"
```

---

### Task 12: Settings dialog

**Files:**
- Create: `src/dashboard/components/settings-dialog.tsx`
- Modify: `src/dashboard/components/header.tsx` (gear opens it), `src/dashboard/app.tsx`

**Interfaces:**
- Consumes: `Settings`, `SettingsInputSchema` (Task 5), `saveSettings` command (Task 6), `useTheme` (Task 8).
- Native `<dialog>` with `showModal()`. Fields: `Toolbar alert above` (number, MB, 100 to 100,000, step 100), `Theme` (System / Light / Dark radio), `Full refresh` (2 / 5 / 10 min / Off select), `Show restricted tabs` (checkbox). Validate client-side with `SettingsInputSchema.safeParse` and show the first issue message under the field; on save send `saveSettings`, close on `ok`, show the reply error otherwise. Escape and a Cancel button close without saving. No Rescan or Pause in the dialog.

- [ ] **Step 1: Implement the dialog** (validation logic is the already-tested `SettingsInputSchema`)

- [ ] **Step 2: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all pass.
Manual: set threshold 99, see `Threshold must be 100 to 100,000 MB`; set 1200 and Dark, save, reload the page: values persist and the theme is dark; set Full refresh Off, confirm in the service worker console that `chrome.alarms.getAll()` has no `full-refresh` alarm.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(dashboard): settings dialog"
```

---

### Task 13: Browser test, packaging, CI and README

**Files:**
- Modify: `tests/browser.mjs`, `scripts/package.py`, `.github/workflows/check.yml`, `README.md`, `public/manifest.json` (version `0.2.0`), `package.json` (version `0.2.0`)

- [ ] **Step 1: Update the browser test to the new UI**

Keep every current assertion that is about data (mapping, iframe PIDs, shared labelling via `ranking`, allocation growth, CPU sample, navigation invalidation, pause cleanup, missing companion). Replace DOM steps: Start/Pause buttons by role and name as now; Processes switch by role `button` name `Processes`; filter by role `searchbox`; settings via the gear (`aria-label="Settings"`) dialog. Add: the shared tabs appear in one group (`getByText('Shared process')`), clicking `Sleep Observatory shared tab` makes `chrome.tabs.get(id).discarded` true, and a 375px screenshot `test-results/dashboard-mobile.png` next to the existing one. Navigation invalidation now expects the tab to leave `mapped` state rather than relying on expiry.

Run: `npm run test:browser`
Expected: ends with `PASS:`; if the local Chromium setup is unavailable, say so explicitly.

- [ ] **Step 2: Packaging**

`scripts/package.py`: include `src`, `public`, `dashboard.html`, `vite.config.ts`, `tsconfig.json`, and the built `extension/`; fail with a clear message if `extension/manifest.json` is missing (`Run npm run build first`); name the ZIP from the `version` in `package.json`.

Run: `npm run build && python3 scripts/package.py && python3 -m zipfile -l dist/tab-observatory-0.2.0.zip`
Expected: listing includes `tab-observatory/extension/background.js` and `tab-observatory/src/shared/ranking.ts`.

- [ ] **Step 3: CI**

`.github/workflows/check.yml`: after `npm ci` run `npm run check`, `npm run build`, `npm test`.

- [ ] **Step 4: README**

Update: dev steps (`npm ci`, `npm run dev`, load `extension/`, reload after each rebuild, the build must run before loading), the "What the numbers mean" section with **Frees** (private memory of processes used only by that tab, with the incognito/other-profile caveat from the spec), scanning now event-driven with the full refresh setting, and remove the 30 s / 60 s statements.

- [ ] **Step 5: Final verification**

Run: `npm run check && npm test && npm run build && .venv/bin/python -m unittest discover -s tests -p 'test_*.py'`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: update browser test, packaging, CI and README for 0.2.0"
```
