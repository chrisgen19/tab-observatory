# Tab Observatory

A local Chrome extension and native companion for inspecting resident memory,
private resident memory (USS), CPU, JavaScript heap, and tab/process associations.
This is a development preview, not a published or signed application.

## This workspace: use one development directory

The source of truth is `/home/chrisgen19/projects/tab-observatory` in WSL Ubuntu.
Windows can read its extension folder at:

```text
\\wsl.localhost\Ubuntu\home\chrisgen19\projects\tab-observatory\extension
```

The extension is written in TypeScript and built by Vite into that `extension`
folder (it is build output and not committed). Run `npm ci` once, then
`npm run dev` while you work: it rebuilds `extension/` on every change. For local
development, use **Load unpacked** in each Chrome profile and select that folder
directly. No extraction or copying to a separate Windows project folder is needed. Disable the previously loaded Windows-folder copy while
switching, and remove it after confirming the WSL-loaded copy works.

Loading from a different path can change the extension ID. Register the new ID
with the existing companion using this PowerShell command:

```powershell
py -3.13 "\\wsl.localhost\Ubuntu\home\chrisgen19\projects\tab-observatory\scripts\install_host.py" --register-only NEW_EXTENSION_ID
```

After a rebuild, click **Reload** on its `chrome://extensions` card in each
profile, then reopen the dashboard and start monitoring. Chrome does not reload
the extension just because `extension/` changed, and it loads whatever was last
built, so make sure `npm run dev` (or `npm run build`) has run first. WSL must be available for
Chrome to read the source files. The native Windows companion stays installed
in `%LOCALAPPDATA%\TabObservatory`; changing companion code still requires
rebuilding that executable with the installer.

## Install on Windows or macOS

1. Copy this project onto the computer you want to monitor. Install Python 3.10+
   from python.org if it is not already available. Node 24 is needed to build the
   extension (`npm ci && npm run build`); a packaged ZIP already contains the built
   `extension` folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**,
   and select this project's `extension` folder.
3. Open Tab Observatory using its toolbar icon. Copy the extension ID shown in
   the setup panel.
4. Open Terminal or PowerShell in this project folder and run the appropriate command,
   replacing `EXTENSION_ID` with the actual 32-letter ID:

   Windows:

   ```powershell
   py -3 scripts/install_host.py EXTENSION_ID
   ```

   macOS:

   ```sh
   python3 scripts/install_host.py EXTENSION_ID
   ```

5. Click **Start monitoring**. Chrome will show debugging indicators during scans.

The installer downloads pinned psutil and PyInstaller dependencies into a private
build environment, builds a native executable on your machine, and registers it
for this extension only. It uses a per-user registry entry on Windows or a
per-user NativeMessagingHosts manifest on macOS; administrator access is not needed.
The executable is specific to the machine's operating system and CPU architecture.
Moving the unpacked extension can change its ID: rerun the installer with the new ID.
Close monitoring before upgrading or removing the companion.

## Multiple Chrome profiles

Load the extension in each profile and copy each profile's extension ID. The
installer preserves previously registered IDs, so adding a profile does not
disconnect profiles already installed. If two profiles have the same extension
ID, one registration covers both.

After installing the companion once, add a different ID without rebuilding:

Windows (use the Python version installed on your computer):

```powershell
py -3.13 scripts/install_host.py --register-only SECOND_EXTENSION_ID
```

macOS:

```sh
python3 scripts/install_host.py --register-only SECOND_EXTENSION_ID
```

You can also pass multiple IDs in one command, for example:
`python3 scripts/install_host.py --register-only FIRST_ID SECOND_ID`.
Open each profile's dashboard and start monitoring separately. Tab lists are
profile-specific; browser memory totals can include other profiles using the
same browser instance. Each active dashboard's extension runs its own companion
connection and sampler; pausing one profile does not pause another profile.

To remove the companion, run the same Python command with `--uninstall` instead
of the extension ID, then remove the extension through `chrome://extensions`.
Uninstalling the companion removes access for all registered profiles.
The installer currently targets standard Google Chrome and its usual data directory.
Chrome for Testing, other Chromium browsers and custom `--user-data-dir` locations
need their own native host manifest registration.

## What the numbers mean

- **Frees (tab ranking):** private memory (USS) of the processes only that tab
  uses, which is what closing or sleeping it gives back. Tabs are ranked by it.
  A renderer can also hold frames from incognito tabs, other profiles or frames
  that were not mapped, so this is the best available estimate, not a guarantee.
  When private memory is unavailable, resident memory stands in and the value is
  marked with `≈`.
- **Shared:** private memory of a process that several mapped tabs use. Those tabs
  are listed together as one group, the shared memory is counted once, and it is
  freed only when every tab in the group sleeps or closes (**Sleep both** /
  **Sleep all N**).
- **Resident:** RSS on macOS/Linux, working set on Windows. The total counts each
  Chrome process once, but physical pages shared across processes may still occur
  in several process working sets. This sum is not an exact unique physical total.
- **Private:** USS, physical pages unique to the process. Unknown if unavailable;
  never replaced with virtual memory or committed bytes. USS can be expensive to read.
- **CPU:** elapsed user+system CPU time divided by wall time; 100% is one core,
  so totals may exceed 100%. A new process needs two samples.
- **JS heap:** the main target's V8 isolate at the most recent mapping scan,
  not total tab RAM, and not necessarily exclusive to that tab.
- **Tab resident/private/CPU:** the sum of observed associated processes. These
  processes may serve other tabs too, so tab rows must not be summed. Shared
  labels describe sharing among successfully mapped tabs, not proof of exclusive use.
- Browser, GPU, utility, workers and extension processes are visible in the process
  view even when not attributable to a tab. Dedicated/shared workers and GPU memory
  are not allocated proportionally to tab rows.

Memory/CPU collection runs about every 3 seconds. Tabs are mapped to processes
one at a time when monitoring starts, when a tab opens, navigates or wakes, and
when one of its mapped processes exits or its PID is reused. A full refresh of
every tab also runs on a schedule (every 5 minutes by default; 2, 5 or 10 minutes
or off in Settings). A tab whose scan fails is retried after it navigates or on the
next full refresh, not on every sample. Mappings do not expire on a timer, so a
frame that moves to another process without navigating stays stale until the next
full refresh. Busy browsers can show tabs as not scanned yet while a scan runs.
Browser commands are bounded by timeouts, with a 12-second budget per tab and
bounded cleanup afterward. An unresponsive tab is marked with a timeout and the
scan continues to other tabs. A JavaScript heap reading, if already collected,
remains visible even if that tab's subsequent process mapping fails.

These measurements are intentionally named by their actual OS definitions. They
are not guaranteed to match Chrome Task Manager's Memory Footprint column or the
macOS Activity Monitor Memory column. Windows and macOS have different accounting.

## Privacy and permissions

- No network server, cloud service, analytics, or remote debugging port is needed
  for normal operation. Runtime data stays in memory; only settings (alert
  threshold, theme, full refresh interval, restricted-tab visibility) are stored
  persistently. The 15-minute chart is reset if the service worker restarts.
- `tabs` reads tab titles/URLs for display and lets the dashboard focus, sleep
  (discard) or close a tab you choose; `debugger` enables short diagnostic
  sessions; `nativeMessaging` connects to the companion; `alarms` schedules the
  full refresh; `storage` saves settings and the session's running flag.
- Chrome's debugger permission is powerful. Monitoring is opt-in through the
  dashboard; **Pause monitoring** disconnects the companion and detaches debuggers.
- Private/incognito tabs are excluded from scans and tab lists. The OS browser
  process totals can include incognito windows and other profiles in that same
  browser instance, without reading or labeling their browsing content.
- The companion inspects only Chrome processes descending from its launching
  browser; it cannot execute commands, take arbitrary PIDs, or read page content.
- Debugger sessions can conflict with DevTools, enterprise restrictions, or other
  profilers. Failed mappings are shown as unavailable; the extension does not
  estimate process ownership from a page's URL.
- Process scans briefly emit a uniquely named `console.timeStamp` marker in each
  accessible frame's default JavaScript context. Its trace event supplies that
  renderer's OS PID. This also covers attached out-of-process iframes. A page that
  overrides `console.timeStamp` can prevent attribution; unavailable frames are
  reported as partial mappings. Browser trace internals can change across releases.

## Development and checks

```sh
npm ci
npm run dev        # rebuilds extension/ on change; npm run build for a one-off build
npm run check      # TypeScript type-check (src and tests)
npm test           # unit tests (node --test, TypeScript run directly by Node 24)
python3 -m venv .venv
.venv/bin/python -m pip install -r companion/requirements.txt
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

On Windows use `.venv\Scripts\python.exe` for the Python test commands.
The browser integration harness currently runs on Linux, with an isolated Chrome
profile and native host registration that it removes afterward:

```sh
npx playwright install chromium
npm run test:browser
```

The browser test builds the extension first. Set `CHROME_PATH` to a compatible
extension-capable Chromium executable if using an existing installation or if
Playwright's expected Chromium build is not installed. The test validates actual OS memory growth, not mocked
RAM values. Screenshots are written to `test-results/dashboard.png` and
`test-results/dashboard-mobile.png` (375px).
Windows/macOS end-to-end installation still requires testing on those systems.
The included GitHub Actions workflow runs unit checks and builds a companion on
Windows, macOS and Linux when this project is put in a repository; that workflow
has not been run from this workspace. To create a ZIP with the sources and the built extension:

```sh
npm run build
python3 scripts/package.py   # writes dist/tab-observatory-<version>.zip
```

## API references

- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Chrome tracing implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/protocol/tracing_handler.cc)
- [psutil](https://psutil.io/)
