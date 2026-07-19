# IG See All Expander

Windows desktop tool for expanding Instagram creator handles from the `Suggested for you -> See all` dialog.

It connects to a logged-in local browser session, opens each seed profile, clicks `Similar accounts`, opens the `Suggested for you` `See all` dialog, scrolls the dialog list to the bottom, deduplicates handles, then exports:

- TXT: handle list only, one handle per line.
- Excel: `handle`, `followers`, `email`.

## Download

Download from GitHub Releases:

- `IG-See-All-Expander-Setup-x.x.x.exe`: installer, with selectable install directory.
- `IG-See-All-Expander-Portable-x.x.x.exe`: portable build, no installation required.

Both builds include the Node/Electron runtime. The target computer does not need Node.js, npm, or `start.bat`.

The first public builds are unsigned, so Windows SmartScreen may show an unknown publisher warning. Download only from this repository's Releases page and verify `SHA256SUMS.txt` when needed.

## Browser Connection

Click `Scan` to refresh the current live browser list. The app only shows sessions that are online, have an Instagram tab open, and look logged in. Old scan results are cleared on every scan.

### Fingerprint Browsers

The scanner is not limited to AllweTouch/YunBrowser. It looks for generic Chromium-based browsers that expose a local Chrome DevTools Protocol endpoint, including common fingerprint browsers such as AdsPower, BitBrowser, Dolphin Anty, GoLogin, Multilogin, MoreLogin, Hubstudio, VMLogin, ixBrowser, Octo Browser, Incogniton, Kameleo, and unknown Chromium variants.

For these browsers:

1. Open the fingerprint browser.
2. Log in to Instagram.
3. Keep at least one Instagram tab open.
4. Click `Scan`.
5. Choose the detected logged-in session.

If a fingerprint browser does not expose a local debugging endpoint, the app cannot control it. In that case use the browser's own setting/API to enable remote debugging, or use `Manual CDP URL` if you know the address.

### Normal Chrome

Normal already-open Chrome usually cannot be controlled through CDP because modern Chrome does not expose a debugging endpoint by default. The app now supports normal Chrome through a local connector extension, so it can reuse your existing logged-in Instagram tab without opening a new Chrome window.

Install the connector once:

1. Open the app.
2. Click `Connector folder`.
3. Click `Chrome extensions`.
4. In Chrome, enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the connector folder opened by the app.
7. Keep your logged-in Instagram tab open and click `Scan`.

After installation, you do not need a `Launch Chrome` flow. The app will detect the already-open Chrome Instagram tab through the connector.

The connector only talks to the local app through `127.0.0.1`. It does not upload cookies or passwords. Chrome may show that the connector is debugging the selected Instagram tab while a task is running; this is expected.

## Input

The input box supports handles, `@handle`, Instagram profile URLs, commas, spaces, and new lines:

```text
katenamedsue
@irainamancini
https://www.instagram.com/the_vintage_tourists/
richardheeps, kait.holt
```

## Capture Rules

For every seed, the app follows this flow:

```text
open profile
click Similar accounts
click Suggested for you -> See all
confirm the Suggested for you dialog is open
scroll only the dialog's internal list
continue until scroll position and new handles stop changing
extract profile links from the dialog
exclude seed handles and Instagram reserved paths
deduplicate globally
write TXT
enrich followers and bio email
write Excel
```

The app does not click `Follow` and does not send messages. If a seed fails because the profile is restricted, the page does not show `See all`, or login expires, the job logs the error and continues with the next seed.

## Output

Output files are saved in:

```text
%LOCALAPPDATA%\IG See All Expander\outputs\
```

TXT format:

```text
handle_one
handle_two
handle_three
```

Excel columns:

```text
handle | followers | email
```

When followers cannot be read, `followers` is `未知`. When no email is found in the Instagram bio, `email` is `没有`.

## Local Data

Desktop app data is stored in:

```text
%LOCALAPPDATA%\IG See All Expander\
├─ chrome-connector\   Chrome connector extension files
├─ outputs\            TXT and Excel files
├─ logs\               runtime logs
├─ config.json         app settings
└─ connector.json      local connector secret
```

These files stay on the local computer. Reinstalling or upgrading the app does not remove outputs or settings.

## Development

Source mode requires Node.js 22 or newer:

```powershell
npm install
npm run build
npm start
```

Useful commands:

```powershell
npm test
npm run desktop
npm run pack:win
npm run dist:win
```

## GitHub Release

Pushing a `v*` tag runs `.github/workflows/windows-release.yml` on Windows and uploads:

- Windows installer.
- Windows portable build.
- `SHA256SUMS.txt`.

Example:

```powershell
git tag v0.3.0
git push origin v0.3.0
```
