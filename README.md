# IG See All Expander

Windows desktop tool for exporting Instagram handles from either the `Suggested for you -> See all` dialog or a profile's visible Followers dialog.

It connects to a logged-in local browser session and runs one independent capture mode per task:

- `Suggested`: opens `Similar accounts`, enters `See all`, and captures the full visible suggestion list.
- `Followers`: opens each seed's Followers dialog and captures the full list exposed to the current Instagram session.

Both modes scroll only the dialog's internal list, require a stable-bottom confirmation, deduplicate handles, and export:

- TXT: handle list only, one handle per line.
- Excel: `handle`, `followers`, `following`, `email`.

## Download

Download from GitHub Releases:

- `IG-See-All-Expander-Setup-x.x.x.exe`: installer, with selectable install directory.
- `IG-See-All-Expander-Portable-x.x.x.exe`: portable build, no installation required.

Both builds include the Node/Electron runtime. The target computer does not need Node.js, npm, or `start.bat`.

The first public builds are unsigned, so Windows SmartScreen may show an unknown publisher warning. Download only from this repository's Releases page and verify `SHA256SUMS.txt` when needed.

## Browser Connection

Click `Scan` to refresh the current live browser list. The app only shows sessions that are online, have an Instagram tab open, and look logged in. Old scan results are cleared on every scan.

The toolbar language selector switches the complete interface and runtime logs between Chinese and English. Chinese is the default, and the last selection is remembered locally.

Click the question-mark button to open the built-in connection guide. It includes separate instructions for normal Chrome and fingerprint browsers, the exact Connector folder path, the Instagram URL, copy buttons, and buttons that open the required folder or page.

### Fingerprint Browsers

The scanner is not limited to AllweTouch/YunBrowser. It looks for generic Chromium-based browsers that expose a local Chrome DevTools Protocol endpoint, including common fingerprint browsers such as AdsPower, BitBrowser, Dolphin Anty, GoLogin, Multilogin, MoreLogin, Hubstudio, VMLogin, ixBrowser, Octo Browser, Incogniton, Kameleo, and unknown Chromium variants.

1. Open the fingerprint browser.
2. Log in to Instagram.
3. Keep at least one Instagram tab open.
4. Click `Scan`.
5. Choose the detected logged-in session.

If a fingerprint browser does not expose a local debugging endpoint, use the browser's setting/API to enable remote debugging, or enter its address in `Manual CDP URL`.

### Normal Chrome

Normal already-open Chrome usually cannot be controlled through CDP because modern Chrome does not expose a debugging endpoint by default. The local Chrome Connector can reuse an existing logged-in Instagram tab without opening a new Chrome window.

Install the connector once:

1. Open the app.
2. Click `Connector folder`.
3. Click `Chrome extensions`.
4. In Chrome, enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the connector folder opened by the app.
7. Keep the logged-in Instagram tab open and click `Scan`.

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

Suggested mode follows this flow:

```text
open profile
click Similar accounts
click Suggested for you -> See all
confirm the Suggested for you dialog is open
scroll only the dialog's internal list
require handle count, list height, and bottom position to stay unchanged for 8 checks
extract profile links and globally deduplicate handles
write TXT
enrich every expanded profile
write Excel
```

Followers mode follows this flow:

```text
open profile
read the visible follower count as a reference
open the Followers dialog
confirm the Followers dialog is open
scroll only the dialog's internal list
require handle count, list height, and bottom position to stay unchanged for 8 checks
extract profile links and globally deduplicate handles
write TXT
enrich none, the first 500, or all captured handles
write Excel while preserving every captured handle row
```

If the logged-in account cannot view a private or restricted follower list, the seed is marked `Followers unavailable` and the batch continues. If Instagram exposes fewer rows than the exact profile count after the bottom is confirmed, the seed is marked `Limited X/Y` and only the rows Instagram actually exposed are exported. A list that never passes the bottom check is rejected; partial rows from that seed are not exported.

The app does not bypass private-account permissions, click `Follow`, or send messages. Login expiry, checkpoints, rate limits, unavailable profiles, and dialog failures are logged separately and do not stop later seeds.

## Output

Output files are saved in:

```text
%LOCALAPPDATA%\IG See All Expander\outputs\
```

TXT contains one handle per line. Excel contains exactly:

```text
handle | followers | following | email
```

Email collection combines the expanded bio, public `business_email`/`public_email` profile fields, visible `mailto:` links, and a public Contact dialog when available. Private account-login email is never accessible.

- A count that was checked but could not be read is `未知` (`Unknown`).
- A completed public email check with no result is `没有` (`None`).
- A row outside the selected enrichment range is `未抓取` (`Not captured`) in all three enrichment columns.

Followers mode offers `None`, `First 500`, and `All` enrichment ranges. `First 500` is the default. TXT and Excel always keep every captured unique handle regardless of the selected enrichment range.

## Local Data

Desktop app data is stored in:

```text
%LOCALAPPDATA%\IG See All Expander\
- chrome-connector\   Chrome connector extension files
- outputs\            TXT and Excel files
- logs\               runtime logs
- config.json          app settings
- connector.json       local connector secret
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

Pushing a `v*` tag runs `.github/workflows/windows-release.yml` on Windows and uploads the installer, portable build, and `SHA256SUMS.txt`.

```powershell
git tag v0.4.0
git push origin v0.4.0
```
