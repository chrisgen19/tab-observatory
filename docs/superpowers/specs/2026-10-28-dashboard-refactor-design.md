# Tab Observatory: dashboard refactor and redesign

Date: 2026-10-28 · Branch: `feature/dashboard-refactor` · Status: approved layout (mockup v2), design for review

## Intent

Christian opens Tab Observatory when Chrome is using too much memory (for example 3 GB) to find the culprit tab and close or sleep it. Today that fails: tab rows are sorted by resident memory, which double-counts shared processes, unscanned tabs sink to the bottom, restricted rows add noise, and there is no way to act on a row. He ended up guessing.

The refactor makes that moment work: open the dashboard, see the tab whose removal frees the most memory at the top, and sleep or close it from the row. It also restructures the code so the logic is testable and typed, and reduces how often Chrome's "started debugging this browser" banner appears.

**Success:** within a few seconds of opening the dashboard, the top of the list is the right tab to act on, and acting on it takes one click.

## Goals

1. Rank tabs by **memory freed if closed** (private memory of processes used only by that tab). Show shared memory separately and never count it twice.
2. Group tabs that share a process into one block with a **Sleep both / Sleep all N** action, ranked by what sleeping the whole group frees.
3. **Focus / Sleep / Close** on every tab row.
4. Event-driven tab scanning instead of attaching the debugger to every tab every 30 seconds.
5. Rewrite the extension in **TypeScript + Vite + React + Tailwind**, split into small testable modules.
6. Better chart (auto-ranged, labelled, hover readout, memory/CPU toggle), a process-grouped view, dark mode, and a settings dialog.

## Non-goals

- No changes to how memory is measured (RSS, USS, CPU definitions) or to the native messaging protocol beyond the small companion change below.
- No support for other Chromium browsers, custom `--user-data-dir`, or Chrome Web Store publishing.
- No persistence of history across service worker restarts (stays in memory, as today).
- No guessing which tab owns a process from its URL. Unmapped stays unmapped.

## Anti-goals (would be a failure even if it works)

- The top-ranked tab is not the one whose removal actually frees the most memory (for example shared memory counted on each tab).
- Scanning makes the debugging banner flash more often than today.
- Close or Sleep acts on the wrong tab (stale tab ID, or a tab that navigated since the scan).
- The developer workflow gets worse: the extension must still be loadable unpacked from the WSL folder at the **same path** (`extension/`), so the extension ID and companion registration do not change.

## Current state (baseline commit `a1de6cd` on `main`)

- `extension/background.js` (300 lines): 15 module-level mutable variables; companion connection, polling (`setInterval` 3 s), CDP tracing per tab (`traceTab`, about 100 lines), scan loop, badge, message routing.
- `extension/model.js`: `framesFromEvents`, `associate`, `totals`. Mappings expire after 60 s (`model.js:21`); recycled PIDs rejected via `createdAt`.
- `extension/deadline.js`: `withTimeout`, `scanDeadline` (12 s per tab, 2.5 s per command). Keep this logic.
- `extension/dashboard.{html,js,css}`: vanilla DOM, polls `state` every 1 s, minified one-line CSS.
- `companion/native_host.py`: psutil sampler, reads USS on every sample (expensive).
- Tests: `node:test` for model, deadline, background (mocks the whole `chrome` global); Python unittest for host and installer; `tests/browser.mjs` loads `extension/` in real Chromium.
- npm with `package-lock.json` (stays npm). Node 24.

## Decisions made with Christian

| Topic | Decision |
|---|---|
| Stack | TypeScript + Vite + React + Tailwind |
| Scope | Tab actions, better chart, process-grouped view, dark mode + settings dialog |
| Scanning | Event-driven rescans plus a slow full refresh (about 5 min) |
| Ranking | By memory freed if closed = private memory of processes only that tab uses; shared memory flagged separately |
| Layout | Mockup v2: option A ranked list with option B's shared-process group block and "Sleep both" |
| Groups | Cover any number of tabs sharing a process ("Sleep all 3" for three) |
| Close | No confirmation dialog (Chrome's Ctrl+Shift+T restores) |
| Restricted tabs | Hidden behind "N restricted tabs hidden · Show" |
| Dark mode | Follows the system theme; Settings can override to light or dark |

Mockups: `.superpowers/brainstorm/*/content/layout-v2.html` (gitignored, local reference only).

## Design

### 1. Ranking model ("frees")

Computed in a pure function in `src/shared/model.ts`, from `associate` output:

- For each process, `owners` = mapped tab IDs using it (already computed today).
- **Exclusive process:** exactly one owner. **Shared process:** two or more owners.
- **Tab `freesBytes`** = sum of `privateBytes` of its exclusive processes.
- **Tab `sharedBytes`** = sum of `privateBytes` of its shared processes (display only, not in the ranking for that tab alone).
- **Groups:** connected components of tabs linked by shared processes (union-find over PIDs). A tab with no shared process is a single-tab "group" and renders as a plain row.
- **Group `freesBytes`** = sum of members' `freesBytes` + private bytes of every shared process in the group (each counted once).
- **List order:** groups and single tabs sorted together by `freesBytes`, descending. Inside a group, members sorted by their own `freesBytes`.
- **Unknown values:** if any contributing process has `privateBytes == null` (USS unavailable), fall back to `rssBytes` for that process and mark the value as an estimate (`≈ 812 MB`, tooltip explains). Builder's call on exact styling.
- **Unmapped tabs** (awaiting scan, scanning, error, partial with no PIDs): rank below all mapped tabs, with an explicit state tag (`Scanning…`, `Not scanned yet`, `Mapping failed: <reason>`). Never shown as a blank number.
- **Partial mappings** (some frames unmapped) rank normally but show a `Partial` tag with the frame count tooltip.
- **Bars** in each row are scaled relative to the largest `freesBytes` in the list; the amber segment shows that tab's share of shared memory.
- Totals strip keeps: Chrome total (resident), private total, CPU, and **Not in any tab** (resident of processes with no tab owner: browser, GPU, utility, extensions, workers).

Caveat to state in the UI's "About these numbers" disclosure: a renderer process can also hold frames for incognito tabs, other profiles' tabs or unmapped frames, so "frees" is the best available estimate, not a guarantee.

### 2. Tab actions

All in the background service worker, invoked through the dashboard port (section 4). No new permissions are needed (`tabs` is already granted).

- **Focus:** `chrome.tabs.update(id, { active: true })` + `chrome.windows.update(windowId, { focused: true })`.
- **Sleep:** `chrome.tabs.discard(id)`. Chrome refuses to discard some tabs (for example the active tab in a focused window, or tabs playing audio may be skipped by policy). On failure show an inline row message; do not retry silently. The button is disabled for the dashboard's own tab and already-discarded tabs.
- **Close:** `chrome.tabs.remove(id)`, no confirmation.
- **Sleep both / Sleep all N:** discard every member; report partial success ("Slept 2 of 3: Gmail is the active tab").
- **Safety check:** every action carries the tab ID **and the URL the row was rendered with**. The background re-reads the tab and refuses (with a message) if the URL changed or the tab is gone. Listen to `chrome.tabs.onReplaced` and migrate mappings, since discarding can replace a tab ID on some Chrome versions.
- After an action, invalidate that tab's mapping and push fresh state immediately.

### 3. Event-driven scanning

Replace the 30 s full scan and 60 s expiry (`model.js:21`) with a scan queue in `src/background/scan-queue.ts`:

- **Enqueue a tab when:** it has no mapping; its URL changed (`tabs.onUpdated` with `url`, or `status: 'complete'` after navigation); it was un-discarded; it was replaced (`onReplaced`); any of its mapped PIDs is missing from the latest companion sample or has a different `createdAt`; or monitoring just started.
- **Remove from queue / mapping when:** tab closed, discarded, or became restricted/incognito.
- **Full refresh:** every N minutes (setting, default 5, options 2 / 5 / 10 / Off) enqueue all eligible tabs.
- **Manual:** "Rescan tabs" in the header menu enqueues all.
- Queue is deduplicated, processed **one tab at a time** (as today), debounced about 1 s after the triggering event so a burst of navigations becomes one pass.
- **Validity:** a mapping stays valid while the tab URL matches and every mapped PID is alive with the same `createdAt`. No time-based expiry. The row shows "scanned 3 min ago" in its tooltip.
- The CDP tracing logic (`traceTab`, marker `console.timeStamp`, iframe auto-attach, deadlines, deliberate detach) moves to `src/background/tab-scanner.ts` mostly unchanged, split into smaller functions (attach, collect contexts, trace, resolve PIDs, detach). Behaviour must match today's tests.

Known trade-off (accepted): a frame can move to another process without a URL change (for example a cross-origin iframe navigating). That mapping is stale until a PID dies or the next full refresh.

### 4. Background ↔ dashboard communication

- Replace 1 s `sendMessage` polling with a long-lived port: dashboard calls `chrome.runtime.connect({ name: 'dashboard' })`.
- Background **pushes** a full `DashboardState` on: each companion snapshot (about 3 s), scan progress change, mapping change, settings change, and after any action. Coalesce to at most one push per 250 ms.
- Dashboard sends commands over the same port: `start`, `stop`, `rescan`, `focus`, `sleep`, `sleepGroup`, `close`, `saveSettings`. Each command has a request ID; the background replies with `{ id, ok, error? }`.
- Message types live in `src/shared/protocol.ts`. Validate incoming messages in the background with Zod (keep the existing sender check: same extension ID and the dashboard URL).
- `state()` work (tab query, associate, ranking) runs once per push, not once per dashboard per second.

### 5. Code structure

Source moves out of `extension/`; **the Vite build writes to `extension/`** so the unpacked load path and extension ID stay the same. `extension/` becomes a gitignored build output.

```
src/
  background/
    index.ts           wiring: listeners, startup restore from storage.session
    host-connection.ts native port, snapshots, history ring buffer, peak, badge
    scan-queue.ts      triggers, dedupe, debounce, full refresh timer (chrome.alarms)
    tab-scanner.ts     CDP attach/trace/detach (from traceTab)
    tab-actions.ts     focus, sleep, sleepGroup, close with safety check
    dashboard-port.ts  port handling, push coalescing, command dispatch
    store.ts           the single mutable state object + typed getters/setters
  shared/
    model.ts           framesFromEvents, associate, totals, rankTabs (groups)
    deadline.ts        withTimeout, scanDeadline (unchanged logic)
    protocol.ts        message + state types, Zod schemas
    settings.ts        Settings type, defaults, Zod schema
    format.ts          bytes, percent, relative time
  dashboard/
    main.tsx, App.tsx
    components/        Header, StatsStrip, MemoryChart, TabList, TabRow, SharedGroup,
                       ProcessList, SettingsDialog, SetupPanel, AboutNumbers, StatusNotice
    hooks/use-dashboard-port.ts
public/manifest.json   copied to extension/ by Vite
dashboard.html         Vite HTML entry
```

- Vite multi-entry build: `dashboard.html` and `src/background/index.ts` → `extension/background.js` (fixed file name, ES module service worker as today).
- `npm run dev` = `vite build --watch`; after a rebuild, reload the extension in `chrome://extensions` (same as today's manual reload).
- Keep store state in one object in `store.ts` instead of module-level `let`s, so tests can reset it. Background modules receive `chrome` APIs they need via parameters or a small typed wrapper so tests do not need a global mock of everything (builder decides the exact shape).
- Functions ≤ 50 lines, components ≤ 150 lines, named exports, kebab-case files.

### 6. UI (mockup v2)

Layout top to bottom:

1. **Header:** logo + "Tab Observatory", live status (`● Live`, or `Mapping 3 of 12…` shown next to it, not replacing it), Settings button (gear), Pause/Start. Rescan lives in a small menu or next to the status.
2. **Stats strip** (one card): Chrome total (large), Private, CPU, Not in any tab, sparkline with "+410 MB in 15 min" delta. Clicking the strip or an expand icon opens the full chart.
3. **Tabs card:** title "Tabs · ranked by memory freed if closed", a "Processes" view switch, filter input. Rows: favicon (`tab.favIconUrl`, fallback letter tile), title, bar, freed MB, Focus (ghost) / Sleep / Close (red text). Shared group = amber left border block with header "Shared process · 210 MB · freed only when every tab in it sleeps or closes", group total, "Sleep both" (amber button), then member rows. Footer: "N restricted tabs hidden · Show".
4. **Setup panel** only when the companion is not connected (install commands + copy extension ID, as today), and a distinct error notice when it was connected and dropped.
5. **About these numbers** collapsible disclosure replaces the footer paragraphs and the explanation paragraph (same content, tightened copy).

At 375px: stacked rows (title + MB, bar, actions right-aligned); inside groups, Focus and Close fold into a `⋯` menu, Sleep stays visible.

**Better chart** (`MemoryChart`, hand-rolled SVG, no chart library): y-axis auto-ranged to the visible min/max with padding (not from 0), 3 labelled gridlines, x labels "15 min ago" / "now", hover crosshair with time + value, toggle Memory / CPU (history already stores `cpuPercent`), threshold line when the alert threshold is in range.

**Processes view:** process-first list: each process (kind + PID, resident, private, CPU) with its tabs nested under it; unowned processes grouped under "Not in any tab" (browser, GPU, utility, extensions). Sortable by resident/private/CPU with `aria-sort`.

**Settings dialog** (native `<dialog>`): alert threshold MB (100 to 100,000, as today), theme (System / Light / Dark), full refresh interval (2 / 5 / 10 min / Off), show restricted tabs (toggle). Stored in `chrome.storage.local`, validated with Zod on read and write; invalid stored values fall back to defaults.

**Theme:** colour tokens as CSS variables (light values from current `dashboard.css`: ink `#193631`, muted `#697c77`, green `#166e57`, line `#dce5df`, paper `#fbfcf9`, background `#f1f4ee`, amber `#906b20` on `#fbefd9`; dark values from mockup v2: background `#0d1513`, paper `#151f1c`, ink `#e3ece8`, muted `#8fa39d`, green line `#4cc39c`, amber `#e8c77f` on `#3a2e17`), mapped into Tailwind theme so components use utilities, not hard-coded hex. Dark mode via a `data-theme` attribute driven by the setting, with `prefers-color-scheme` for System.

**Accessibility:** keyboard reachable actions, visible focus rings (keep today's), `aria-live` on status, buttons labelled with the tab title ("Sleep Dashboard v3 - Figma"), contrast AA in both themes.

**Loading / empty / error states:** not monitoring (Start CTA), connecting, companion missing (setup panel), companion dropped (error notice + retry), no http(s) tabs, filter with no matches.

### 7. Companion change (small, backward compatible)

`companion/native_host.py`: read USS (`memory_full_info`) at most every 15 s per process and reuse the last value between, since USS is the expensive part. Response shape unchanged. Add a Python test for the caching. Nothing else in the companion changes; no reinstall is required for the extension refactor to work, but the USS change needs a rebuild via the installer to take effect.

### 8. Packages

Approved stack, to be added as listed (versions: current stable at install time, pinned by `package-lock.json`):

- dependencies: `react`, `react-dom`, `zod`, `lucide-react`
- devDependencies: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `@types/chrome`, `tailwindcss`, `@tailwindcss/vite`
- Existing: `playwright` (browser test).

No test runner added: Node 24 runs `.ts` tests directly with type stripping, so keep `node --test`. That requires `erasableSyntaxOnly` (no enums, no parameter properties) and `.ts` extensions in imports (`allowImportingTsExtensions`, `noEmit`). No linter is added (none exists today); ask before adding one.

### 9. Tests and checks

- Port existing `model`, `deadline`, `background` tests to TypeScript; keep all current behaviour assertions (hung tab does not block others, recycled PID rejection, shared marking).
- New unit tests: `rankTabs` (exclusive vs shared, groups of 3, transitive groups, null USS fallback, unmapped ordering), scan queue triggers and dedupe, tab action safety check (URL changed, tab gone, discard failure, partial group sleep), settings schema defaults.
- `npm run check` = `tsc --noEmit`. `npm test` = `node --test` on `tests/**/*.test.ts`. `npm run build` = Vite build to `extension/`.
- `tests/browser.mjs`: build first, then load `extension/` as today; extend to assert the ranked list renders and that Sleep discards a tab.
- CI (`.github/workflows/check.yml`): add `npm run build` before tests and the browser test stays out of CI as today.
- `scripts/package.py`: zip `src/`, `public/`, `dashboard.html`, config files and the built `extension/` (so the ZIP stays loadable unpacked without Node).
- README: update dev steps (`npm ci`, `npm run dev`, load `extension/`), and the "What the numbers mean" section for "frees".

## Calls made during the builder check (not discussed with Christian)

- Shared groups get **Sleep both / Sleep all N** only, no "Close all" (matches the mockup; closing is per row).
- If a shared process also belongs to a tab that is not mapped yet, the group shows only the mapped tabs and its total gets a `Partial` tag until that tab is scanned.
- The Settings dialog has no "Rescan" or "Pause"; those stay in the header.

## Left to the builder

- Exact Tailwind class composition, spacing and icon choices (Lucide) within the mockup's look.
- How chrome APIs are injected for testability (wrapper vs parameters).
- Push coalescing implementation, debounce timings within the stated ranges.
- Favicon fallback design, estimate (`≈`) styling, tooltip wording.
- Commit granularity on `feature/dashboard-refactor` (Conventional Commits).

## Risks

- **Debugger banner:** cannot be suppressed; event-driven scanning reduces it but each scan still shows it briefly.
- **Stale mappings** between full refreshes when a frame changes process without navigation (accepted trade-off).
- **Discard refusals** are Chrome policy and vary by version; surfaced, not worked around.
- **Build step:** forgetting `npm run dev` means Chrome loads stale `extension/` output. README must say so.
- **Big-bang rewrite:** mitigate by porting tests first and keeping `tab-scanner` behaviour identical before UI work.
