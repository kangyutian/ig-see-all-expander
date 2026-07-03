import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const outputDir = path.join(rootDir, "outputs");
const chromeProfileDir = path.join(rootDir, "chrome-profile");
const host = "127.0.0.1";
const port = Number(process.env.PORT || 4761);

fs.mkdirSync(outputDir, { recursive: true });

const jobs = new Map();
let nextJobId = 1;

const reservedHandles = new Set([
  "",
  "accounts",
  "about",
  "api",
  "blog",
  "developer",
  "direct",
  "explore",
  "legal",
  "locations",
  "p",
  "popular",
  "press",
  "privacy",
  "reels",
  "stories",
  "terms",
  "web",
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname === "/api/browser/discover" && req.method === "GET") {
      return sendJson(res, 200, { browsers: await discoverBrowsers() });
    }
    if (url.pathname === "/api/browser/launch-chrome" && req.method === "POST") {
      return sendJson(res, 200, await launchChromeForInstagram());
    }
    if (url.pathname === "/api/browser/status" && req.method === "GET") {
      const cdpUrl = normalizeCdpUrl(url.searchParams.get("cdpUrl") || "");
      if (!cdpUrl) return sendJson(res, 400, { ok: false, error: "Missing cdpUrl" });
      return sendJson(res, 200, await getBrowserStatus(cdpUrl));
    }
    if (url.pathname === "/api/expand" && req.method === "POST") {
      const body = await readJsonBody(req);
      const seeds = normalizeInputHandles(body.handlesText || body.seeds || "");
      const cdpUrl = normalizeCdpUrl(body.cdpUrl || "");
      const outputName = safeOutputName(body.outputName || "");
      if (!seeds.length) return sendJson(res, 400, { error: "Please enter at least one Instagram handle." });
      if (!cdpUrl) return sendJson(res, 400, { error: "Please choose or enter a browser CDP URL." });
      const job = createJob({ seeds, cdpUrl, outputName });
      runJob(job).catch((error) => failJob(job, error));
      return sendJson(res, 200, { jobId: job.id });
    }
    const eventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (eventsMatch && req.method === "GET") {
      return attachJobEvents(eventsMatch[1], req, res);
    }
    const downloadMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/download$/);
    if (downloadMatch && req.method === "GET") {
      return downloadJob(downloadMatch[1], res);
    }
    const excelDownloadMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/download-excel$/);
    if (excelDownloadMatch && req.method === "GET") {
      return downloadExcelJob(excelDownloadMatch[1], res);
    }
    const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      const job = jobs.get(cancelMatch[1]);
      if (!job) return sendJson(res, 404, { error: "Job not found" });
      job.cancelled = true;
      emit(job, "log", { level: "warn", message: "Cancel requested. The current browser step will stop soon." });
      return sendJson(res, 200, { ok: true });
    }
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: String(error?.message || error) });
  }
});

server.listen(port, host, () => {
  console.log(`IG See All Expander running at http://${host}:${port}`);
});

async function discoverBrowsers() {
  const profileDirs = new Map();
  const debugPorts = new Map();
  const processes = await getChromiumProcesses();
  for (const proc of processes) {
    const browserType = detectBrowserType(proc.name || "", proc.commandLine || "");
    const userDataDir = extractUserDataDir(proc.commandLine || "");
    if (userDataDir) {
      profileDirs.set(path.normalize(userDataDir).toLowerCase(), {
        userDataDir,
        browserType,
        source: proc.name || "process",
        processId: proc.processId || "",
      });
    }
    const debugPort = extractRemoteDebuggingPort(proc.commandLine || "");
    if (debugPort) {
      debugPorts.set(debugPort, {
        debugPort,
        browserType,
        source: proc.name || "process",
        processId: proc.processId || "",
        userDataDir,
      });
    }
  }

  for (const dir of findLikelyYunProfileDirs()) {
    profileDirs.set(path.normalize(dir).toLowerCase(), { userDataDir: dir, browserType: "YunBrowser", source: "filesystem", processId: "" });
  }

  for (const candidate of profileDirs.values()) {
    const activePortPath = path.join(candidate.userDataDir, "DevToolsActivePort");
    if (!fs.existsSync(activePortPath)) continue;
    const [portLine] = fs.readFileSync(activePortPath, "utf8").split(/\r?\n/);
    const debugPort = Number(portLine);
    if (!Number.isFinite(debugPort) || debugPort <= 0) continue;
    debugPorts.set(debugPort, { ...candidate, debugPort });
  }

  for (const debugPort of commonDebugPorts()) {
    if (!debugPorts.has(debugPort)) debugPorts.set(debugPort, { debugPort, browserType: "Unknown Chromium", source: "common-port", processId: "", userDataDir: "" });
  }

  const out = [];
  for (const candidate of debugPorts.values()) {
    const cdpUrl = `http://127.0.0.1:${candidate.debugPort}`;
    const status = await probeBrowserCandidate(cdpUrl, candidate).catch((error) => ({
      ok: false,
      error: String(error?.message || error),
      instagramTabs: [],
    }));
    if (candidate.source === "common-port" && !(status.instagramTabs || []).length) continue;
    out.push({
      id: `${candidate.debugPort}`,
      cdpUrl,
      debugPort: candidate.debugPort,
      userDataDir: candidate.userDataDir || "",
      source: candidate.source || "process",
      browserType: status.browserType || candidate.browserType || "Unknown Chromium",
      processId: candidate.processId || "",
      ok: Boolean(status.ok),
      loginLikely: Boolean(status.loginLikely),
      hasSessionCookie: Boolean(status.hasSessionCookie),
      title: status.title || "",
      currentUrl: status.currentUrl || "",
      instagramTabs: status.instagramTabs || [],
      browserName: status.browserName || "",
      error: status.error || "",
    });
  }
  const sorted = out.sort((a, b) => browserCandidateScore(b) - browserCandidateScore(a));
  const live = sorted.filter((item) => item.ok);
  return live.length ? live : sorted;
}

async function launchChromeForInstagram() {
  if (process.platform !== "win32") throw new Error("Chrome launcher is currently supported on Windows only.");
  const chromePath = findChromeExecutable();
  if (!chromePath) throw new Error("Chrome was not found. Please install Google Chrome or use Manual CDP URL.");
  fs.mkdirSync(chromeProfileDir, { recursive: true });

  const existingPort = await findExistingManagedChromePort();
  if (existingPort) {
    const cdpUrl = `http://127.0.0.1:${existingPort}`;
    await waitForCdp(cdpUrl, 5000);
    return {
      ok: true,
      reused: true,
      cdpUrl,
      debugPort: existingPort,
      browserType: "Chrome",
      userDataDir: chromeProfileDir,
    };
  }

  const debugPort = await findAvailableDebugPort(9223, 9235);
  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeProfileDir}`,
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    "https://www.instagram.com/",
  ];
  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  const cdpUrl = `http://127.0.0.1:${debugPort}`;
  await waitForCdp(cdpUrl, 20000);
  return {
    ok: true,
    cdpUrl,
    debugPort,
    browserType: "Chrome",
    userDataDir: chromeProfileDir,
  };
}

async function findExistingManagedChromePort() {
  const processes = await getChromiumProcesses();
  const normalizedProfileName = path.basename(chromeProfileDir).toLowerCase();
  for (const proc of processes) {
    const commandLine = proc.commandLine || "";
    if (!/chrome\.exe/i.test(proc.name || "") && !/Google\\Chrome/i.test(commandLine)) continue;
    if (!commandLine.toLowerCase().includes(normalizedProfileName)) continue;
    const portNumber = extractRemoteDebuggingPort(commandLine);
    if (!portNumber) continue;
    const ready = await fetchJson(`http://127.0.0.1:${portNumber}/json/version`, {}, 800)
      .then(() => true)
      .catch(() => false);
    if (ready) return portNumber;
  }
  return 0;
}

async function probeBrowserCandidate(cdpUrl, candidate = {}) {
  const version = await fetchJson(`${cdpUrl}/json/version`, {}, 2500);
  const status = await getBrowserStatus(cdpUrl);
  return {
    ...status,
    browserType: refineBrowserType(candidate.browserType, version),
    browserName: version.Browser || "",
  };
}

function browserCandidateScore(item) {
  let score = 0;
  if (item.ok) score += 10;
  if (item.instagramTabs?.length) score += 60;
  if (item.loginLikely) score += 100;
  if (/AllweTouch|YunBrowser/i.test(item.browserType)) score += 25;
  if (/Chrome/i.test(item.browserType)) score += 15;
  if (/Electron|Unknown/i.test(item.browserType) && !item.instagramTabs?.length) score -= 30;
  return score;
}

async function getChromiumProcesses() {
  if (process.platform !== "win32") return [];
  const script =
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
    "Get-CimInstance Win32_Process | " +
    "Where-Object { $_.Name -match 'YunBrowser|AllweTouch|chrome|msedge' } | " +
    "Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Depth 3";
  const stdout = await execFileText("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]).catch(() => "");
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((item) => ({
    processId: item.ProcessId,
    name: item.Name,
    commandLine: item.CommandLine || "",
  }));
}

function findLikelyYunProfileDirs() {
  const roots = [];
  for (const drive of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    roots.push(`${drive}:\\.YunLogin\\User Data`);
  }
  const dirs = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const profile = path.join(root, entry.name);
      if (fs.existsSync(path.join(profile, "DevToolsActivePort"))) dirs.push(profile);
    }
  }
  return dirs;
}

function extractUserDataDir(commandLine) {
  const quoted = commandLine.match(/--user-data-dir="([^"]+)"/i);
  if (quoted) return quoted[1];
  const unquoted = commandLine.match(/--user-data-dir=([^\s]+)/i);
  return unquoted ? unquoted[1] : "";
}

function extractRemoteDebuggingPort(commandLine) {
  const match = String(commandLine || "").match(/--remote-debugging-port=(\d+)/i);
  if (!match) return 0;
  const portNumber = Number(match[1]);
  return Number.isFinite(portNumber) && portNumber > 0 ? portNumber : 0;
}

function detectBrowserType(name, commandLine) {
  const text = `${name || ""} ${commandLine || ""}`;
  if (/AllweTouch/i.test(text)) return "AllweTouch";
  if (/YunBrowser/i.test(text)) return "YunBrowser";
  if (/chrome\.exe|Google\\Chrome|Google\/Chrome/i.test(text)) return "Chrome";
  if (/msedge\.exe|Microsoft\\Edge|Microsoft\/Edge/i.test(text)) return "Edge";
  return "Unknown Chromium";
}

function refineBrowserType(currentType, version = {}) {
  if (currentType && currentType !== "Unknown Chromium") return currentType;
  const text = `${version.Browser || ""} ${version["User-Agent"] || ""}`;
  if (/Electron/i.test(text)) return "Electron";
  if (/Edg\//i.test(text)) return "Edge";
  if (/Chrome\//i.test(text)) return "Chrome";
  return currentType || "Unknown Chromium";
}

function commonDebugPorts() {
  const ports = [];
  for (let portNumber = 9222; portNumber <= 9230; portNumber += 1) ports.push(portNumber);
  return ports;
}

async function findAvailableDebugPort(start, end) {
  for (let portNumber = start; portNumber <= end; portNumber += 1) {
    const open = await fetchJson(`http://127.0.0.1:${portNumber}/json/version`, {}, 500)
      .then(() => true)
      .catch(() => false);
    if (!open) return portNumber;
  }
  throw new Error(`No available Chrome debug port between ${start} and ${end}.`);
}

async function waitForCdp(cdpUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await fetchJson(`${cdpUrl}/json/version`, {}, 800)
      .then(() => true)
      .catch(() => false);
    if (ready) return true;
    await sleep(300);
  }
  throw new Error(`Chrome started, but ${cdpUrl} did not become ready in time.`);
}

function findChromeExecutable() {
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LocalAppData || "", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

async function getBrowserStatus(cdpUrl) {
  const list = await fetchJson(`${cdpUrl}/json/list`, {}, 5000);
  const instagramTabs = list
    .filter((tab) => tab.type === "page" && String(tab.url || "").includes("instagram.com"))
    .map((tab) => ({ title: tab.title || "", url: tab.url || "", id: tab.id || "" }));
  let loginLikely = false;
  let hasSessionCookie = false;
  let currentUrl = instagramTabs[0]?.url || "";
  let title = instagramTabs[0]?.title || "";

  const tab = list.find((item) => item.type === "page" && String(item.url || "").includes("instagram.com") && item.webSocketDebuggerUrl);
  if (tab) {
    const cdp = await connect(tab.webSocketDebuggerUrl);
    try {
      await cdp.send("Runtime.enable");
      await cdp.send("Network.enable").catch(() => {});
      const cookieResult = await cdp.send("Network.getCookies", { urls: ["https://www.instagram.com/"] }).catch(() => ({ cookies: [] }));
      const cookies = Array.isArray(cookieResult.cookies) ? cookieResult.cookies : [];
      hasSessionCookie = cookies.some((cookie) => ["sessionid", "ds_user_id"].includes(cookie.name) && String(cookie.value || "").trim());
      const text = await evaluate(cdp, `(() => document.body ? document.body.innerText.slice(0, 1200) : '')()`);
      const positiveText = /Profile|Messages|Suggested for you|followers|following|Follow|Home|Search|Explore|Reels|首页|主页|搜索|探索|消息|通知|个人主页|粉丝|正在关注|推荐/i.test(text);
      const loginText = /Log in|Sign up to see|Sign up|Phone number, username, or email|登录|注册|手机号、用户名或邮箱|邮箱地址或手机号/i.test(text);
      loginLikely = hasSessionCookie || (positiveText && !loginText);
      currentUrl = tab.url || currentUrl;
      title = tab.title || title;
    } finally {
      cdp.close();
    }
  }
  return { ok: true, loginLikely, hasSessionCookie, title, currentUrl, instagramTabs };
}

function createJob({ seeds, cdpUrl, outputName }) {
  const id = String(nextJobId++);
  const job = {
    id,
    seeds,
    cdpUrl,
    outputName,
    status: "running",
    cancelled: false,
    events: [],
    clients: new Set(),
    rows: [],
    enrichedRows: [],
    bySeed: [],
    filePath: "",
    excelPath: "",
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  emit(job, "status", { status: "running", seeds });
  return job;
}

async function runJob(job) {
  emit(job, "log", { level: "info", message: `Starting ${job.seeds.length} seed account(s).` });
  const allRows = [];
  const seedSet = new Set(job.seeds);

  for (let index = 0; index < job.seeds.length; index += 1) {
    if (job.cancelled) break;
    const seed = job.seeds[index];
    emit(job, "seed:start", { seed, index, total: job.seeds.length });
    try {
      const result = await collectSeed({ cdpUrl: job.cdpUrl, seed, seedSet, job });
      job.bySeed.push(result);
      for (const handle of result.handles) allRows.push({ source: seed, handle });
      emit(job, "seed:done", { seed, count: result.handles.length });
    } catch (error) {
      const message = String(error?.message || error);
      job.bySeed.push({ seed, error: message, handles: [] });
      emit(job, "seed:error", { seed, error: message });
    }
  }

  const seen = new Set();
  const handles = [];
  for (const row of allRows) {
    if (seen.has(row.handle)) continue;
    seen.add(row.handle);
    handles.push(row.handle);
  }
  job.rows = handles;
  const basename = job.outputName || `ig-see-all-handles-${timestampForFile()}`;
  const filename = `${basename}.txt`;
  const excelFilename = `${basename}.xlsx`;
  job.filePath = path.join(outputDir, filename);
  job.excelPath = path.join(outputDir, excelFilename);
  fs.writeFileSync(job.filePath, `${handles.join("\n")}${handles.length ? "\n" : ""}`, "utf8");

  emit(job, "enrich:start", { total: handles.length });
  job.enrichedRows = await enrichHandles({ cdpUrl: job.cdpUrl, handles, job });
  await writeExcel(job.excelPath, job.enrichedRows);

  job.status = job.cancelled ? "cancelled" : "done";
  emit(job, "done", { status: job.status, count: handles.length, filename, excelFilename });
}

async function enrichHandles({ cdpUrl, handles, job }) {
  if (!handles.length || job.cancelled) return handles.map((handle) => ({ handle, followers: "未知", email: "没有" }));
  const tab = await getAnyInstagramTab(cdpUrl);
  const cdp = await connect(tab.webSocketDebuggerUrl);
  const rows = [];
  try {
    await cdp.send("Runtime.enable");
    for (let index = 0; index < handles.length; index += 1) {
      const handle = handles[index];
      if (job.cancelled) break;
      emit(job, "enrich:progress", { index: index + 1, total: handles.length, handle });
      try {
        const info = await getProfileInfoByApi(cdp, handle);
        rows.push({
          handle,
          followers: formatFollowers(info.followers),
          email: extractEmails(info.bio).join("; ") || "没有",
        });
      } catch (error) {
        emit(job, "log", { level: "warn", message: `Profile fallback for @${handle}: ${String(error?.message || error)}` });
        const fallback = await getProfileInfoByPage(cdp, handle).catch(() => ({ followers: null, bio: "" }));
        rows.push({
          handle,
          followers: formatFollowers(fallback.followers),
          email: extractEmails(fallback.bio).join("; ") || "没有",
        });
      }
      await sleep(450);
    }
  } finally {
    cdp.close();
  }
  return rows;
}

async function getAnyInstagramTab(cdpUrl) {
  const tabs = await fetchJson(`${cdpUrl}/json/list`, {}, 8000);
  const tab = tabs.find((item) => item.type === "page" && String(item.url || "").includes("instagram.com") && item.webSocketDebuggerUrl);
  if (tab) return tab;
  const opened = await fetchJson(`${cdpUrl}/json/new?${encodeURIComponent("https://www.instagram.com/")}`, { method: "PUT" }, 8000);
  if (!opened?.webSocketDebuggerUrl) throw new Error("Could not open Instagram tab for profile enrichment.");
  return opened;
}

async function getProfileInfoByApi(cdp, handle) {
  return evaluate(
    cdp,
    `(async () => {
      const response = await fetch('/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}', {
        credentials: 'include',
        headers: {
          'accept': 'application/json',
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest'
        }
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
      const user = json?.data?.user;
      if (!user) throw new Error('No user in profile response');
      return {
        followers: user.edge_followed_by?.count ?? null,
        bio: user.biography || ''
      };
    })()`
  );
}

async function getProfileInfoByPage(cdp, handle) {
  await cdp.send("Page.navigate", { url: `https://www.instagram.com/${handle}/` }).catch(() => {});
  await sleep(3500);
  return evaluate(
    cdp,
    `(() => {
      const text = document.body?.innerText || '';
      const followersMatch = text.match(/([\\d,.]+\\s*[KMB万萬]?)\\s+followers/i);
      return {
        followers: followersMatch ? followersMatch[1] : null,
        bio: text.slice(0, 1800)
      };
    })()`
  );
}

async function writeExcel(filePath, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IG See All Expander";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("handles");
  sheet.columns = [
    { header: "handle", key: "handle", width: 34 },
    { header: "followers", key: "followers", width: 14 },
    { header: "email", key: "email", width: 42 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.getRow(1).height = 22;
  for (const row of rows) sheet.addRow(row);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:C1";
  await workbook.xlsx.writeFile(filePath);
}

async function collectSeed({ cdpUrl, seed, seedSet, job }) {
  const tab = await getOrOpenInstagramTab(cdpUrl, seed);
  const cdp = await connect(tab.webSocketDebuggerUrl);
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable").catch(() => {});
    await cdp.send("Page.bringToFront").catch(() => {});
    await cdp.send("Page.navigate", { url: `https://www.instagram.com/${seed}/` }).catch(() => {});
    await sleep(6500);
    if (job.cancelled) return { seed, handles: [] };

    const similarClicked = await clickSimilarAccounts(cdp);
    if (!similarClicked) throw new Error("Similar accounts button was not found.");
    await waitForText(cdp, "Suggested for you", 8000).catch(() => {});

    const seeAllClicked = await clickSeeAll(cdp);
    if (!seeAllClicked) throw new Error("See all button was not found after opening suggestions.");
    await waitForDialog(cdp, 10000);

    const handles = new Map();
    let previousSize = 0;
    let staleRounds = 0;
    let lastScrollTop = -1;
    let finalScrollState = null;

    for (let round = 0; round < 120; round += 1) {
      if (job.cancelled) break;
      const items = await extractSuggestedModal(cdp, seed, seedSet);
      for (const handle of items) handles.set(handle, handle);
      emit(job, "seed:progress", { seed, count: handles.size });

      staleRounds = handles.size === previousSize ? staleRounds + 1 : 0;
      previousSize = handles.size;

      const scrollState = await scrollSuggestedModal(cdp);
      finalScrollState = scrollState;
      if (scrollState.atBottom && staleRounds >= 2) break;
      if (!scrollState.changed && scrollState.scrollTop === lastScrollTop && staleRounds >= 4) break;
      if (scrollState.atBottom && staleRounds >= 8) break;
      lastScrollTop = scrollState.scrollTop;
      await sleep(850);
    }

    if (finalScrollState) {
      const maxTop = Math.max(0, (finalScrollState.scrollHeight || 0) - (finalScrollState.clientHeight || 0));
      emit(job, "log", {
        level: finalScrollState.atBottom ? "success" : "warn",
        message: `@${seed} See all scroll ${finalScrollState.atBottom ? "bottom reached" : "stopped before confirmed bottom"} (${finalScrollState.scrollTop}/${maxTop}).`,
      });
    }

    await closeDialog(cdp).catch(() => {});
    return { seed, handles: [...handles.keys()] };
  } finally {
    cdp.close();
  }
}

async function getOrOpenInstagramTab(cdpUrl, seed) {
  const tabs = await fetchJson(`${cdpUrl}/json/list`, {}, 8000);
  const existing = tabs.find(
    (tab) => tab.type === "page" && String(tab.url || "").toLowerCase().includes(`instagram.com/${seed.toLowerCase()}`) && tab.webSocketDebuggerUrl
  );
  if (existing) return existing;
  const opened = await fetchJson(`${cdpUrl}/json/new?${encodeURIComponent(`https://www.instagram.com/${seed}/`)}`, { method: "PUT" }, 8000);
  if (!opened?.webSocketDebuggerUrl) throw new Error(`Could not open Instagram tab for ${seed}.`);
  return opened;
}

async function clickSimilarAccounts(cdp) {
  const result = await evaluate(cdp, `(() => {
    window.scrollTo(0, 0);
    const candidates = [...document.querySelectorAll('[role=button], button')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, text: (el.innerText || el.textContent || '').trim(), aria: el.getAttribute('aria-label') || '', r };
      })
      .filter((x) => x.r.width > 20 && x.r.height > 20 && x.r.top < 430);
    const target =
      candidates.find((x) => /similar accounts/i.test(x.text || x.aria)) ||
      candidates.find((x) => !/follow|message|options/i.test(x.text) && x.r.left > 900 && x.r.top > 220 && x.r.width <= 90);
    if (!target) return null;
    const x = target.r.left + target.r.width / 2;
    const y = target.r.top + target.r.height / 2;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      target.el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    }
    return { x, y };
  })()`);
  if (!result) return false;
  return true;
}

async function clickSeeAll(cdp) {
  const result = await evaluate(cdp, `(() => {
    const candidates = [...document.querySelectorAll('a, [role=button], button, div')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, text: (el.innerText || el.textContent || '').trim(), r };
      })
      .filter((x) => x.text === 'See all' && x.r.width > 20 && x.r.height > 10)
      .sort((a, b) => a.r.top - b.r.top);
    const target = candidates[0];
    if (!target) return null;
    const x = target.r.left + target.r.width / 2;
    const y = target.r.top + target.r.height / 2;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      target.el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    }
    return { x, y };
  })()`);
  if (!result) return false;
  return true;
}

async function extractSuggestedModal(cdp, seed, seedSet) {
  const data = await evaluate(
    cdp,
    `(() => {
      const pageHandle = ${JSON.stringify(seed)};
      const seedSet = new Set(${JSON.stringify([...seedSet])});
      const reserved = new Set(${JSON.stringify([...reservedHandles])});
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find((el) => (el.innerText || '').includes('Suggested for you'));
      if (!dialog) return [];
      const scrollBox = [...dialog.querySelectorAll('div')]
        .filter((el) => el.scrollHeight > el.clientHeight + 20)
        .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || dialog;
      const items = [];
      for (const a of [...scrollBox.querySelectorAll('a[href^="/"]')]) {
        const href = a.getAttribute('href') || '';
        const parts = href.split('/').filter(Boolean);
        const handle = (parts[0] || '').toLowerCase();
        const text = (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ');
        if (!handle || reserved.has(handle) || seedSet.has(handle) || handle === pageHandle) continue;
        if (!/^[a-z0-9._]{3,30}$/.test(handle)) continue;
        if (parts.length !== 1) continue;
        if (!text || text.toLowerCase() !== handle) continue;
        items.push(handle);
      }
      return [...new Set(items)];
    })()`
  );
  return Array.isArray(data) ? data : [];
}

async function scrollSuggestedModal(cdp) {
  const beforeState = await evaluate(cdp, `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((el) => (el.innerText || '').includes('Suggested for you'));
    if (!dialog) return { changed: false, atBottom: true, scrollTop: -1, scrollHeight: 0, clientHeight: 0, rect: null };
    const scrollBox = [...dialog.querySelectorAll('div')]
      .filter((el) => el.scrollHeight > el.clientHeight + 20)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || dialog;
    const before = scrollBox.scrollTop;
    const rect = scrollBox.getBoundingClientRect();
    scrollBox.scrollTop = Math.min(scrollBox.scrollTop + Math.max(180, Math.floor(scrollBox.clientHeight * 0.72)), scrollBox.scrollHeight);
    scrollBox.dispatchEvent(new Event('scroll', { bubbles: true }));
    return {
      changed: scrollBox.scrollTop !== before,
      scrollTop: scrollBox.scrollTop,
      scrollHeight: scrollBox.scrollHeight,
      clientHeight: scrollBox.clientHeight,
      atBottom: scrollBox.scrollTop >= scrollBox.scrollHeight - scrollBox.clientHeight - 3,
      rect: { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height - 12, Math.max(12, rect.height * 0.78)) }
    };
  })()`);
  if (!beforeState?.rect || beforeState.atBottom) return beforeState;
  await cdp
    .send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: beforeState.rect.x,
      y: beforeState.rect.y,
      deltaX: 0,
      deltaY: Math.max(260, Math.floor((beforeState.clientHeight || 400) * 0.85)),
    })
    .catch(() => {});
  await sleep(120);
  const afterState = await evaluate(cdp, `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((el) => (el.innerText || '').includes('Suggested for you'));
    if (!dialog) return { changed: false, atBottom: true, scrollTop: -1, scrollHeight: 0, clientHeight: 0 };
    const scrollBox = [...dialog.querySelectorAll('div')]
      .filter((el) => el.scrollHeight > el.clientHeight + 20)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || dialog;
    return {
      changed: scrollBox.scrollTop !== ${JSON.stringify(beforeState.scrollTop)},
      scrollTop: scrollBox.scrollTop,
      scrollHeight: scrollBox.scrollHeight,
      clientHeight: scrollBox.clientHeight,
      atBottom: scrollBox.scrollTop >= scrollBox.scrollHeight - scrollBox.clientHeight - 3
    };
  })()`);
  return {
    ...afterState,
    changed: Boolean(beforeState.changed || afterState.changed),
  };
}

async function closeDialog(cdp) {
  await evaluate(cdp, `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((el) => (el.innerText || '').includes('Suggested for you'));
    if (!dialog) return false;
    const close = [...dialog.querySelectorAll('[role=button], button')]
      .map((el) => ({ el, text: (el.innerText || el.textContent || '').trim(), aria: el.getAttribute('aria-label') || '', r: el.getBoundingClientRect() }))
      .find((x) => /close/i.test(x.text || x.aria) || (x.r.left < dialog.getBoundingClientRect().left + 90 && x.r.top < dialog.getBoundingClientRect().top + 90));
    if (!close) return false;
    close.el.click();
    return true;
  })()`);
}

async function waitForText(cdp, text, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await evaluate(cdp, `(() => (document.body?.innerText || '').includes(${JSON.stringify(text)}))()`).catch(() => false);
    if (found) return true;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${text}`);
}

async function waitForDialog(cdp, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await evaluate(
      cdp,
      `(() => [...document.querySelectorAll('[role="dialog"]')].some((el) => (el.innerText || '').includes('Suggested for you')))()`
    ).catch(() => false);
    if (found) return true;
    await sleep(400);
  }
  throw new Error("Suggested for you dialog did not open.");
}

async function mouseClick(cdp, { x, y }) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function connect(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
    else resolve(message.result || {});
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    send(method, params = {}) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 30000);
      });
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

function attachJobEvents(jobId, req, res) {
  const job = jobs.get(jobId);
  if (!job) {
    res.writeHead(404);
    res.end("Job not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const event of job.events) writeSse(res, event.type, event.data);
  job.clients.add(res);
  req.on("close", () => job.clients.delete(res));
}

function downloadJob(jobId, res) {
  const job = jobs.get(jobId);
  if (!job || !job.filePath || !fs.existsSync(job.filePath)) return sendJson(res, 404, { error: "Result file is not ready." });
  const filename = path.basename(job.filePath);
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  fs.createReadStream(job.filePath).pipe(res);
}

function downloadExcelJob(jobId, res) {
  const job = jobs.get(jobId);
  if (!job || !job.excelPath || !fs.existsSync(job.excelPath)) return sendJson(res, 404, { error: "Excel file is not ready." });
  const filename = path.basename(job.excelPath);
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  fs.createReadStream(job.excelPath).pipe(res);
}

function emit(job, type, data) {
  const event = { type, data: { ...data, at: new Date().toISOString() } };
  job.events.push(event);
  for (const client of job.clients) writeSse(client, type, event.data);
}

function writeSse(res, type, data) {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function failJob(job, error) {
  job.status = "failed";
  emit(job, "error", { error: String(error?.message || error) });
}

function serveStatic(urlPath, res) {
  const pathname = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(distDir, pathname));
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath)) {
    if (!fs.existsSync(path.join(distDir, "index.html"))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>IG See All Expander</h1><p>Run <code>npm.cmd run build</code> first, then restart.</p>");
      return;
    }
    return serveFile(path.join(distDir, "index.html"), res);
  }
  return serveFile(filePath, res);
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  return text ? JSON.parse(text) : {};
}

async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

function execFileText(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

function normalizeInputHandles(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\s,;\uFF0C\uFF1B]+/)
        .map(normalizeHandle)
        .filter(Boolean)
    ),
  ];
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
}

function normalizeCdpUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) return `http://127.0.0.1:${text}`;
  if (/^https?:\/\//i.test(text)) return text.replace(/\/+$/, "");
  return `http://${text}`.replace(/\/+$/, "");
}

function safeOutputName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/\.txt$/i, "")
    .slice(0, 80);
}

function extractEmails(text) {
  const matches = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((email) => email.toLowerCase().replace(/[.,;:)]$/, "")))];
}

function formatFollowers(value) {
  if (value === null || value === undefined || value === "") return "未知";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return "未知";
  return text;
}

function timestampForFile() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
