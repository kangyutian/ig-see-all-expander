import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceRootDir = path.resolve(__dirname, "..");
const sourcePackage = JSON.parse(fs.readFileSync(path.join(sourceRootDir, "package.json"), "utf8"));
let distDir = path.join(sourceRootDir, "dist");
let dataDir = sourceRootDir;
let outputDir = path.join(sourceRootDir, "outputs");
let chromeProfileDir = path.join(sourceRootDir, "chrome-profile");
let logDir = sourceRootDir;
let host = "127.0.0.1";
let port = Number(process.env.PORT || 4761);
let apiToken = "";
let runtimeMode = "source";
let appVersion = sourcePackage.version || "0.1.0";
let openPathHandler = null;
let openExternalHandler = null;
let server = null;
let connectorHttpServer = null;
let connectorWss = null;
let connectorPort = 0;
let connectorSecret = "";
let connectorExtensionDir = "";
let nextConnectorCommandId = 1;

const connectorClients = new Map();
let cachedChromiumProcesses = [];

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

const BOTTOM_CONFIRMATION_ROUNDS = 8;
const NON_BOTTOM_STALL_LIMIT = 18;

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith("/api/") && !isAuthorizedRequest(req, url)) {
      return sendJson(res, 401, { error: "Unauthorized local app request." });
    }
    if (url.pathname === "/api/browser/discover" && req.method === "GET") {
      return sendJson(res, 200, await discoverBrowserSessions());
    }
    if (url.pathname === "/api/browser/connector-info" && req.method === "GET") {
      return sendJson(res, 200, getConnectorInfo());
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
      const sessionId = String(body.sessionId || "");
      const outputName = safeOutputName(body.outputName || "");
      if (!seeds.length) return sendJson(res, 400, { error: "Please enter at least one Instagram handle." });
      const session = resolveBrowserSession({ sessionId, cdpUrl });
      if (!session) return sendJson(res, 400, { error: "Please choose a live browser session or enter a Manual CDP URL." });
      const job = createJob({ seeds, session, outputName });
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
    if (url.pathname === "/api/system/open-outputs" && req.method === "POST") {
      await openDirectory(outputDir);
      return sendJson(res, 200, { ok: true, path: outputDir });
    }
    if (url.pathname === "/api/system/open-logs" && req.method === "POST") {
      await openDirectory(logDir);
      return sendJson(res, 200, { ok: true, path: logDir });
    }
    if (url.pathname === "/api/system/open-connector" && req.method === "POST") {
      await openDirectory(connectorExtensionDir);
      return sendJson(res, 200, { ok: true, path: connectorExtensionDir });
    }
    if (url.pathname === "/api/system/open-chrome-extensions" && req.method === "POST") {
      await openExternalUrl("chrome://extensions/");
      return sendJson(res, 200, { ok: true, url: "chrome://extensions/" });
    }
    if (url.pathname === "/api/system/info" && req.method === "GET") {
      return sendJson(res, 200, {
        name: "IG See All Expander",
        version: appVersion,
        mode: runtimeMode,
        dataDir,
        outputDir,
        logDir,
        connectorPort,
        connectorExtensionDir,
      });
    }
    return serveStatic(url.pathname, res);
  } catch (error) {
    logRuntime("error", error?.stack || error?.message || String(error));
    return sendJson(res, 500, { error: String(error?.message || error) });
  }
}

export async function startLocalServer(options = {}) {
  if (server?.listening) throw new Error("IG See All Expander local server is already running.");

  distDir = path.resolve(options.distDir || path.join(sourceRootDir, "dist"));
  dataDir = path.resolve(options.dataDir || sourceRootDir);
  outputDir = path.resolve(options.outputDir || path.join(dataDir, "outputs"));
  chromeProfileDir = path.resolve(options.chromeProfileDir || path.join(dataDir, "chrome-profile"));
  logDir = path.resolve(options.logDir || path.join(dataDir, "logs"));
  host = options.host || "127.0.0.1";
  port = Number.isFinite(Number(options.port)) ? Number(options.port) : Number(process.env.PORT || 4761);
  apiToken = String(options.token || "");
  runtimeMode = options.mode || "source";
  appVersion = options.version || sourcePackage.version || "0.1.0";
  openPathHandler = typeof options.openPath === "function" ? options.openPath : null;
  openExternalHandler = typeof options.openExternal === "function" ? options.openExternal : null;

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(chromeProfileDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  connectorSecret = await ensureConnectorSecret();
  connectorExtensionDir = path.join(dataDir, "chrome-connector");
  writeConnectorExtension(connectorExtensionDir, connectorSecret);
  await startConnectorServer();
  jobs.clear();
  nextJobId = 1;

  server = http.createServer(handleRequest);
  await new Promise((resolve, reject) => {
    const handleError = (error) => reject(error);
    server.once("error", handleError);
    server.listen(port, host, () => {
      server.off("error", handleError);
      resolve();
    });
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${port}`;
  logRuntime("info", `Local service started at ${url} (${runtimeMode}).`);

  return {
    host,
    port,
    url,
    token: apiToken,
    async close() {
      if (!server?.listening) return;
      for (const job of jobs.values()) {
        job.cancelled = true;
        for (const client of job.clients) client.end();
        job.clients.clear();
      }
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      });
      await stopConnectorServer();
      logRuntime("info", "Local service stopped.");
      server = null;
    },
  };
}

export function createAccessToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function ensureConnectorSecret() {
  const configPath = path.join(dataDir, "connector.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (typeof parsed.secret === "string" && parsed.secret.length >= 24) return parsed.secret;
  } catch {
    // A missing connector config is normal on first launch.
  }
  const secret = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(configPath, `${JSON.stringify({ schemaVersion: 1, secret, createdAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return secret;
}

async function startConnectorServer() {
  if (connectorHttpServer?.listening) return;
  for (let candidatePort = 47620; candidatePort <= 47639; candidatePort += 1) {
    const started = await tryStartConnectorOnPort(candidatePort);
    if (started) {
      connectorPort = candidatePort;
      logRuntime("info", `Chrome connector listening at ws://127.0.0.1:${connectorPort}/connector.`);
      return;
    }
  }
  throw new Error("No available Chrome connector port between 47620 and 47639.");
}

function tryStartConnectorOnPort(candidatePort) {
  return new Promise((resolve) => {
    const httpServer = http.createServer((req, res) => {
      if (req.url === "/health") return sendJson(res, 200, { ok: true });
      res.writeHead(404);
      res.end("Not found");
    });
    const wss = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (req, socket, head) => {
      const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${candidatePort}`);
      if (requestUrl.pathname !== "/connector" || requestUrl.searchParams.get("secret") !== connectorSecret) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });
    wss.on("connection", registerConnectorClient);
    httpServer.once("error", () => {
      wss.close();
      resolve(false);
    });
    httpServer.listen(candidatePort, "127.0.0.1", () => {
      connectorHttpServer = httpServer;
      connectorWss = wss;
      resolve(true);
    });
  });
}

async function stopConnectorServer() {
  for (const client of connectorClients.values()) client.ws.close();
  connectorClients.clear();
  await new Promise((resolve) => connectorWss?.close(() => resolve()) || resolve());
  await new Promise((resolve) => connectorHttpServer?.close(() => resolve()) || resolve());
  connectorWss = null;
  connectorHttpServer = null;
  connectorPort = 0;
}

function registerConnectorClient(ws) {
  const clientId = crypto.randomBytes(12).toString("hex");
  const client = {
    id: clientId,
    ws,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    browserType: "Chrome",
    browserName: "",
    profileName: "",
    tabs: [],
    pending: new Map(),
  };
  connectorClients.set(clientId, client);
  ws.on("message", (raw) => handleConnectorMessage(client, raw));
  ws.on("close", () => connectorClients.delete(clientId));
  ws.on("error", () => connectorClients.delete(clientId));
  ws.send(JSON.stringify({ type: "welcome", clientId, protocolVersion: 1 }));
}

function handleConnectorMessage(client, raw) {
  let message = null;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }
  client.lastSeen = Date.now();
  if (message.type === "hello" || message.type === "heartbeat") {
    client.browserType = message.browserType || "Chrome";
    client.browserName = message.browserName || client.browserName || "Chrome";
    client.profileName = message.profileName || client.profileName || "";
    client.tabs = Array.isArray(message.tabs) ? message.tabs : [];
    return;
  }
  if (message.type === "result" || message.type === "error") {
    const pending = client.pending.get(message.id);
    if (!pending) return;
    client.pending.delete(message.id);
    if (message.type === "error") pending.reject(new Error(message.error || "Chrome connector command failed."));
    else pending.resolve(message.result);
  }
}

function sendConnectorCommand(client, command, payload = {}, timeoutMs = 30000) {
  if (!client || client.ws.readyState !== 1) throw new Error("Chrome connector is not connected.");
  const id = nextConnectorCommandId++;
  client.ws.send(JSON.stringify({ type: "command", id, command, payload }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.pending.delete(id);
      reject(new Error(`Chrome connector timeout: ${command}`));
    }, timeoutMs);
    client.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
  });
}

function liveConnectorClients() {
  // An open WebSocket is still a usable connector even when Chrome has not emitted
  // a tab event recently. Discovery sends a status command and drops dead clients.
  return [...connectorClients.values()].filter(isOpenConnectorClient);
}

export function isOpenConnectorClient(client) {
  return client?.ws?.readyState === 1;
}

function getConnectorInfo() {
  return {
    ok: Boolean(connectorPort),
    port: connectorPort,
    extensionDir: connectorExtensionDir,
    connectedClients: liveConnectorClients().length,
  };
}

function writeConnectorExtension(targetDir, secret) {
  fs.mkdirSync(targetDir, { recursive: true });
  const ports = [];
  for (let candidatePort = 47620; candidatePort <= 47639; candidatePort += 1) ports.push(candidatePort);
  fs.writeFileSync(
    path.join(targetDir, "manifest.json"),
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: "IG See All Expander Connector",
        version: appVersion,
        description: "Connects an already-open Instagram tab in Chrome to the local IG See All Expander app.",
        permissions: ["tabs", "cookies", "debugger"],
        host_permissions: ["https://www.instagram.com/*", "http://127.0.0.1/*", "ws://127.0.0.1/*"],
        background: { service_worker: "background.js" },
        content_scripts: [
          {
            matches: ["https://www.instagram.com/*"],
            js: ["content.js"],
            run_at: "document_idle",
          },
        ],
        action: { default_title: "IG See All Expander Connector" },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(targetDir, "config.js"),
    `self.IG_SEE_ALL_CONNECTOR_CONFIG = ${JSON.stringify({ secret, ports, protocolVersion: 1 }, null, 2)};\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(targetDir, "background.js"), connectorBackgroundJs(), "utf8");
  fs.writeFileSync(path.join(targetDir, "content.js"), connectorContentJs(), "utf8");
  fs.writeFileSync(
    path.join(targetDir, "README.txt"),
    [
      "IG See All Expander Connector",
      "",
      "Install once in Chrome:",
      "1. Open chrome://extensions/",
      "2. Enable Developer mode",
      "3. Click Load unpacked",
      `4. Choose this folder: ${targetDir}`,
      "",
      "After installing, keep your logged-in Instagram tab open and click Scan in IG See All Expander.",
    ].join("\n"),
    "utf8"
  );
}

function connectorBackgroundJs() {
  return String.raw`importScripts("config.js");

const config = self.IG_SEE_ALL_CONNECTOR_CONFIG || { ports: [], secret: "" };
let socket = null;
let activePortIndex = 0;
let reconnectTimer = null;
let heartbeatTimer = null;

connect();
chrome.tabs.onUpdated.addListener(queueHeartbeat);
chrome.tabs.onRemoved.addListener(queueHeartbeat);
chrome.tabs.onActivated.addListener(queueHeartbeat);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "ig-see-all-wake") ensureConnected();
});

function connect() {
  clearTimeout(reconnectTimer);
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  if (!config.secret || !Array.isArray(config.ports) || !config.ports.length) return;
  const port = config.ports[activePortIndex % config.ports.length];
  activePortIndex += 1;
  try {
    socket = new WebSocket("ws://127.0.0.1:" + port + "/connector?secret=" + encodeURIComponent(config.secret));
  } catch {
    reconnectSoon();
    return;
  }
  socket.addEventListener("open", () => {
    startHeartbeat();
    sendHello("hello");
  });
  socket.addEventListener("message", handleMessage);
  socket.addEventListener("close", () => {
    stopHeartbeat();
    socket = null;
    reconnectSoon();
  });
  socket.addEventListener("error", () => {
    try { socket.close(); } catch {}
  });
}

function reconnectSoon() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 1200);
}

function queueHeartbeat() {
  ensureConnected();
  setTimeout(() => sendHello("heartbeat"), 250);
}

function ensureConnected() {
  if (!socket || (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING)) connect();
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => sendHello("heartbeat"), 5000);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function sendHello(type = "heartbeat") {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const tabs = await getInstagramTabs();
  socket.send(JSON.stringify({
    type,
    protocolVersion: config.protocolVersion || 1,
    browserType: "Chrome",
    browserName: navigator.userAgent,
    tabs,
  }));
}

async function getInstagramTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://www.instagram.com/*"] });
  return tabs
    .filter((tab) => tab.id && tab.url && !/\/accounts\/login/i.test(tab.url))
    .map((tab) => ({
      id: tab.id,
      title: tab.title || "",
      url: tab.url || "",
      active: Boolean(tab.active),
      windowId: tab.windowId,
    }));
}

async function handleMessage(event) {
  let message = null;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === "welcome") {
    sendHello("hello");
    return;
  }
  if (message.type !== "command") return;
  try {
    const result = await handleCommand(message.command, message.payload || {});
    socket.send(JSON.stringify({ type: "result", id: message.id, result }));
    sendHello("heartbeat");
  } catch (error) {
    socket.send(JSON.stringify({ type: "error", id: message.id, error: String(error && error.message ? error.message : error) }));
  }
}

async function handleCommand(command, payload) {
  if (command === "status") return statusForTab(payload.tabId);
  if (command === "cdp") return runCdpLikeCommand(payload.tabId, payload.method, payload.params || {});
  throw new Error("Unknown command: " + command);
}

async function statusForTab(tabId) {
  const tab = await chrome.tabs.get(Number(tabId));
  const cookies = await chrome.cookies.getAll({ url: "https://www.instagram.com/" }).catch(() => []);
  const hasSessionCookie = cookies.some((cookie) => ["sessionid", "ds_user_id"].includes(cookie.name) && String(cookie.value || "").trim());
  let text = "";
  try {
    const result = await sendDebuggerCommand(tab.id, "Runtime.evaluate", {
      expression: "(() => document.body ? document.body.innerText.slice(0, 1200) : '')()",
      awaitPromise: true,
      returnByValue: true,
    });
    text = result?.result?.value || "";
  } catch {}
  const positiveText = /Profile|Messages|Suggested for you|followers|following|Follow|Home|Search|Explore|Reels|\u9996\u9875|\u4e3b\u9875|\u641c\u7d22|\u63a2\u7d22|\u6d88\u606f|\u901a\u77e5|\u4e2a\u4eba\u4e3b\u9875|\u7c89\u4e1d|\u6b63\u5728\u5173\u6ce8|\u63a8\u8350/i.test(text || "");
  const loginText = /Log in|Sign up to see|Sign up|Phone number, username, or email|\u767b\u5f55|\u6ce8\u518c|\u624b\u673a\u53f7\u3001\u7528\u6237\u540d\u6216\u90ae\u7bb1|\u90ae\u7bb1\u5730\u5740\u6216\u624b\u673a\u53f7/i.test(text || "");
  return {
    ok: true,
    title: tab.title || "",
    currentUrl: tab.url || "",
    hasSessionCookie,
    loginLikely: hasSessionCookie || (positiveText && !loginText),
  };
}

async function runCdpLikeCommand(tabId, method, params) {
  tabId = Number(tabId);
  if (!tabId) throw new Error("Missing tabId");
  if (method === "Page.bringToFront") {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
    return {};
  }
  if (method === "Page.navigate") {
    if (!params.url || !/^https:\/\/www\.instagram\.com\//i.test(params.url)) throw new Error("Only Instagram navigation is allowed.");
    await chrome.tabs.update(tabId, { url: params.url, active: true });
    await waitForTabComplete(tabId, 20000).catch(() => {});
    return {};
  }
  if (method === "Network.getCookies") {
    const cookies = await chrome.cookies.getAll({ url: "https://www.instagram.com/" }).catch(() => []);
    return { cookies };
  }
  return sendDebuggerCommand(tabId, method, params || {});
}

async function sendDebuggerCommand(tabId, method, params = {}) {
  const target = { tabId: Number(tabId) };
  await chrome.debugger.attach(target, "1.3").catch((error) => {
    const message = String(error && error.message ? error.message : error);
    if (!/Another debugger|already attached|already connected/i.test(message)) throw error;
  });
  return chrome.debugger.sendCommand(target, method, params || {});
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          cleanup();
          resolve();
        } else if (Date.now() - started > timeoutMs) {
          cleanup();
          reject(new Error("Tab load timeout"));
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    }, 350);
    function cleanup() {
      clearInterval(timer);
    }
  });
}
`;
}

function connectorContentJs() {
  return String.raw`(() => {
  const wake = () => chrome.runtime.sendMessage({ type: "ig-see-all-wake" }).catch(() => {});
  wake();
  setInterval(wake, 5000);
})();
`;
}

async function discoverBrowserSessions() {
  const [cdpBrowsers, extensionBrowsers] = await Promise.all([discoverCdpBrowsers(), discoverExtensionBrowsers()]);
  const all = [...extensionBrowsers, ...cdpBrowsers];
  const browsers = all
    .filter((item) => item.ok && item.instagramTabs?.length && item.loginLikely)
    .sort((a, b) => browserCandidateScore(b) - browserCandidateScore(a));
  return {
    browsers,
    diagnostics: {
      cdpCandidates: cdpBrowsers.length,
      connectorClients: liveConnectorClients().length,
      connectorPort,
      connectorExtensionDir,
      hiddenNoLoginOrNoInstagram: all.length - browsers.length,
      normalChromeWithoutDebug: countNormalChromeWithoutDebug(),
    },
  };
}

async function discoverCdpBrowsers() {
  const profileDirs = new Map();
  const debugPorts = new Map();
  const processes = await getChromiumProcesses();
  cachedChromiumProcesses = processes;
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

  for (const listener of await getLoopbackListeners()) {
    if (debugPorts.has(listener.port)) continue;
    const proc = processes.find((item) => String(item.processId) === String(listener.processId));
    if (!proc || !looksLikeChromiumProcess(proc)) continue;
    debugPorts.set(listener.port, {
      debugPort: listener.port,
      browserType: detectBrowserType(proc.name || "", proc.commandLine || ""),
      source: "listener",
      processId: proc.processId || "",
      userDataDir: extractUserDataDir(proc.commandLine || ""),
    });
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
      id: `cdp:${candidate.debugPort}`,
      sessionId: `cdp:${candidate.debugPort}`,
      sessionType: "cdp",
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
  return sorted.filter((item) => item.ok);
}

async function discoverExtensionBrowsers() {
  const out = [];
  for (const client of liveConnectorClients()) {
    const instagramTabs = (client.tabs || []).filter((tab) => String(tab.url || "").includes("instagram.com"));
    for (const tab of instagramTabs) {
      const status = await sendConnectorCommand(client, "status", { tabId: tab.id }, 8000).catch((error) => ({
        ok: false,
        error: String(error?.message || error),
      }));
      out.push({
        id: `extension:${client.id}:${tab.id}`,
        sessionId: `extension:${client.id}:${tab.id}`,
        sessionType: "extension",
        cdpUrl: "",
        debugPort: 0,
        userDataDir: "",
        source: "chrome-connector",
        browserType: "Chrome",
        processId: "",
        ok: Boolean(status.ok),
        loginLikely: Boolean(status.loginLikely),
        hasSessionCookie: Boolean(status.hasSessionCookie),
        title: status.title || tab.title || "",
        currentUrl: status.currentUrl || tab.url || "",
        instagramTabs: [{ title: status.title || tab.title || "", url: status.currentUrl || tab.url || "", id: String(tab.id) }],
        browserName: client.browserName || "",
        profileName: client.profileName || "",
        error: status.error || "",
      });
    }
  }
  return out;
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
    "Where-Object { $_.CommandLine -and ($_.CommandLine -match '--remote-debugging-port|--user-data-dir|DevToolsActivePort|instagram|Chrome|Chromium|Browser|Yun|Allwe|AdsPower|Dolphin|BitBrowser|Hubstudio|MoreLogin|ixBrowser|VMLogin|GoLogin|Multilogin|Kameleo|Incogniton|Octo|ClonBrowser|Edge|msedge') } | " +
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

async function getLoopbackListeners() {
  if (process.platform !== "win32") return [];
  const script =
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.LocalAddress -in @('127.0.0.1','::1') -and $_.LocalPort -ge 1024 } | " +
    "Select-Object LocalPort,OwningProcess | ConvertTo-Json -Depth 3";
  const stdout = await execFileText("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]).catch(() => "");
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .map((item) => ({ port: Number(item.LocalPort), processId: item.OwningProcess }))
    .filter((item) => Number.isFinite(item.port) && item.port > 0);
}

function countNormalChromeWithoutDebug() {
  let count = 0;
  for (const proc of cachedChromiumProcesses) {
    const text = `${proc.name || ""} ${proc.commandLine || ""}`;
    if (!/chrome\.exe|Google\\Chrome|Google\/Chrome/i.test(text)) continue;
    if (extractRemoteDebuggingPort(proc.commandLine || "")) continue;
    count += 1;
  }
  return count;
}

function looksLikeChromiumProcess(proc) {
  const text = `${proc.name || ""} ${proc.commandLine || ""}`;
  return /chrome|chromium|msedge|browser|yun|allwetouch|adspower|dolphin|bitbrowser|hubstudio|morelogin|ixbrowser|vmlogin|gologin|multilogin|kameleo|incogniton|octo|clonbrowser|devtoolsactiveport|--user-data-dir/i.test(text);
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
  if (/AdsPower/i.test(text)) return "AdsPower";
  if (/Dolphin/i.test(text)) return "Dolphin Anty";
  if (/BitBrowser/i.test(text)) return "BitBrowser";
  if (/Hubstudio/i.test(text)) return "Hubstudio";
  if (/MoreLogin/i.test(text)) return "MoreLogin";
  if (/ixBrowser/i.test(text)) return "ixBrowser";
  if (/VMLogin/i.test(text)) return "VMLogin";
  if (/GoLogin/i.test(text)) return "GoLogin";
  if (/Multilogin/i.test(text)) return "Multilogin";
  if (/Kameleo/i.test(text)) return "Kameleo";
  if (/Incogniton/i.test(text)) return "Incogniton";
  if (/Octo/i.test(text)) return "Octo Browser";
  if (/ClonBrowser/i.test(text)) return "ClonBrowser";
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
      const positiveText = /Profile|Messages|Suggested for you|followers|following|Follow|Home|Search|Explore|Reels|\u9996\u9875|\u4e3b\u9875|\u641c\u7d22|\u63a2\u7d22|\u6d88\u606f|\u901a\u77e5|\u4e2a\u4eba\u4e3b\u9875|\u7c89\u4e1d|\u6b63\u5728\u5173\u6ce8|\u63a8\u8350/i.test(text);
      const loginText = /Log in|Sign up to see|Sign up|Phone number, username, or email|\u767b\u5f55|\u6ce8\u518c|\u624b\u673a\u53f7\u3001\u7528\u6237\u540d\u6216\u90ae\u7bb1|\u90ae\u7bb1\u5730\u5740\u6216\u624b\u673a\u53f7/i.test(text);
      loginLikely = hasSessionCookie || (positiveText && !loginText);
      currentUrl = tab.url || currentUrl;
      title = tab.title || title;
    } finally {
      cdp.close();
    }
  }
  return { ok: true, loginLikely, hasSessionCookie, title, currentUrl, instagramTabs };
}

function resolveBrowserSession({ sessionId, cdpUrl }) {
  if (sessionId?.startsWith("extension:")) {
    const [, clientId, tabId] = sessionId.split(":");
    const client = connectorClients.get(clientId);
    if (!client || client.ws.readyState !== 1) return null;
    const tab = (client.tabs || []).find((item) => String(item.id) === String(tabId));
    if (!tab) return null;
    return { type: "extension", sessionId, clientId, tabId: Number(tabId), label: "Chrome Connector" };
  }
  if (sessionId?.startsWith("cdp:")) {
    const portNumber = Number(sessionId.split(":")[1]);
    if (Number.isFinite(portNumber) && portNumber > 0) return { type: "cdp", sessionId, cdpUrl: `http://127.0.0.1:${portNumber}` };
  }
  if (cdpUrl) return { type: "cdp", sessionId: `manual:${cdpUrl}`, cdpUrl };
  return null;
}

function createJob({ seeds, session, outputName }) {
  const id = String(nextJobId++);
  const job = {
    id,
    seeds,
    session,
    cdpUrl: session.cdpUrl || "",
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
  emit(job, "log", { level: "info", message: `Starting ${job.seeds.length} seed account(s) with ${job.session.type === "extension" ? "Chrome connector" : job.session.cdpUrl}.` });
  const allRows = [];
  const seedSet = new Set(job.seeds);

  for (let index = 0; index < job.seeds.length; index += 1) {
    if (job.cancelled) break;
    const seed = job.seeds[index];
    emit(job, "seed:start", { seed, index, total: job.seeds.length });
    try {
      const result = await collectSeed({ session: job.session, seed, seedSet, job });
      job.bySeed.push(result);
      for (const handle of result.handles) allRows.push({ source: seed, handle });
      if (result.cancelled) {
        emit(job, "seed:cancelled", { seed, count: result.handles.length });
        break;
      }
      emit(job, "seed:done", { seed, count: result.handles.length, bottomConfirmed: true });
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
  job.enrichedRows = await enrichHandles({ session: job.session, handles, job });
  await writeExcel(job.excelPath, job.enrichedRows);

  job.status = job.cancelled ? "cancelled" : "done";
  emit(job, "done", { status: job.status, count: handles.length, filename, excelFilename });
}

async function enrichHandles({ session, handles, job }) {
  if (!handles.length || job.cancelled) {
    return handles.map((handle) => ({ handle, followers: "\u672a\u77e5", following: "\u672a\u77e5", email: "\u6ca1\u6709" }));
  }
  const page = await createBrowserPage(session);
  const rows = [];
  try {
    await page.send("Runtime.enable");
    for (let index = 0; index < handles.length; index += 1) {
      const handle = handles[index];
      if (job.cancelled) break;
      emit(job, "enrich:progress", { index: index + 1, total: handles.length, handle });
      let pageInfo = { followers: null, following: null, bio: "", contactText: "", bioExpanded: false };
      try {
        pageInfo = await getProfileInfoByPage(page, handle);
        emit(job, "enrich:progress", {
          index: index + 1,
          total: handles.length,
          handle,
          pageChecked: true,
          bioExpanded: pageInfo.bioExpanded,
          contactOpened: pageInfo.contactOpened,
        });
      } catch (error) {
        emit(job, "log", { level: "warn", message: `Profile page fallback for @${handle}: ${String(error?.message || error)}` });
      }
      try {
        const apiInfo = await getProfileInfoByApi(page, handle);
        const info = mergeProfileInfo(apiInfo, pageInfo);
        rows.push({
          handle,
          followers: formatCount(info.followers),
          following: formatCount(info.following),
          email: collectProfileEmails(info).join("; ") || "\u6ca1\u6709",
        });
      } catch (error) {
        emit(job, "log", { level: "warn", message: `Profile API fallback for @${handle}: ${String(error?.message || error)}` });
        rows.push({
          handle,
          followers: formatCount(pageInfo.followers),
          following: formatCount(pageInfo.following),
          email: collectProfileEmails(pageInfo).join("; ") || "\u6ca1\u6709",
        });
      }
      await sleep(450);
    }
    if (rows.length < handles.length) {
      const completedHandles = new Set(rows.map((row) => row.handle));
      for (const handle of handles) {
        if (completedHandles.has(handle)) continue;
        rows.push({ handle, followers: "\u672a\u77e5", following: "\u672a\u77e5", email: "\u6ca1\u6709" });
      }
    }
  } finally {
    page.close();
  }
  return rows;
}

async function createBrowserPage(session, seed = "") {
  if (session.type === "extension") return createExtensionPage(session);
  if (seed) {
    const tab = await getOrOpenInstagramTab(session.cdpUrl, seed);
    return connect(tab.webSocketDebuggerUrl);
  }
  const tab = await getAnyInstagramTab(session.cdpUrl);
  return connect(tab.webSocketDebuggerUrl);
}

function createExtensionPage(session) {
  const client = connectorClients.get(session.clientId);
  if (!client || client.ws.readyState !== 1) throw new Error("Chrome connector is no longer connected. Click Scan and choose the Chrome tab again.");
  return {
    send(method, params = {}) {
      return sendConnectorCommand(client, "cdp", { tabId: session.tabId, method, params });
    },
    close() {},
  };
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
        following: user.edge_follow?.count ?? null,
        bio: user.biography || '',
        businessEmail: user.business_email || '',
        publicEmail: user.public_email || '',
        profileContactEmail: user.profile_contact_info?.email_address || user.contact_info?.email_address || ''
      };
    })()`
  );
}

async function getProfileInfoByPage(cdp, handle) {
  await cdp.send("Page.navigate", { url: `https://www.instagram.com/${handle}/` }).catch(() => {});
  await sleep(3500);
  const bioExpanded = await expandProfileBio(cdp).catch(() => false);
  if (bioExpanded) await sleep(350);
  let info = await readProfilePageInfo(cdp);
  let contactOpened = false;
  if (!collectProfileEmails(info).length) {
    contactOpened = await openProfileContactDetails(cdp).catch(() => false);
    if (contactOpened) {
      await sleep(500);
      info = mergeProfileInfo(info, await readProfilePageInfo(cdp));
    }
  }
  return { ...info, bioExpanded, contactOpened };
}

async function readProfilePageInfo(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const text = document.body?.innerText || '';
      const metadata = document.querySelector('meta[property="og:description"]')?.content || '';
      const source = metadata + '\n' + text;
      const mailto = [...document.querySelectorAll('a[href^="mailto:"]')]
        .map((node) => {
          const value = (node.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0];
          try { return decodeURIComponent(value); } catch { return value; }
        })
        .filter(Boolean);
      const dialogText = [...document.querySelectorAll('[role="dialog"]')]
        .map((node) => node.innerText || node.textContent || '')
        .join('\n');
      const readCount = (hrefPart, labelPattern) => {
        const link = [...document.querySelectorAll('a[href]')]
          .find((node) => (node.getAttribute('href') || '').includes(hrefPart));
        const linkMatch = (link?.innerText || link?.textContent || '').match(/([\\d,.]+\\s*[KMB\\u4e07\\u842c]?)/i);
        if (linkMatch) return linkMatch[1];
        const match = source.match(new RegExp('([\\\\d,.]+\\\\s*[KMB\\u4e07\\u842c]?)\\\\s*(?:' + labelPattern + ')', 'i'));
        return match ? match[1] : null;
      };
      return {
        followers: readCount('/followers/', 'followers|\\u7c89\\u4e1d|\\u7c89\\u7d72'),
        following: readCount('/following/', 'following|\\u5173\\u6ce8|\\u95dc\\u6ce8|\\u8ffd\\u8e64\\u4e2d|\\u8ffd\\u8e2a'),
        bio: text.slice(0, 2400),
        contactText: mailto.join('\n') + '\n' + dialogText
      };
    })()`
  );
}

async function expandProfileBio(cdp) {
  const target = await evaluate(cdp, `(() => {
    const pattern = /^(more|see more|read more|\\u66f4\\u591a|\\u67e5\\u770b\\u66f4\\u591a|plus|mehr|altro|mais|m\\u00e1s)$/i;
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button, [role="button"], span')]
      .map((node) => {
        const clickable = node.closest('button, [role="button"]') || node;
        const rect = clickable.getBoundingClientRect();
        return { clickable, text: normalize(node.innerText || node.textContent), rect };
      })
      .filter((item) => pattern.test(item.text))
      .filter((item) => item.rect.width > 8 && item.rect.height > 8 && item.rect.bottom > 0 && item.rect.top < Math.min(window.innerHeight, 760))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const item = candidates[0];
    if (!item) return null;
    return { x: item.rect.left + item.rect.width / 2, y: item.rect.top + item.rect.height / 2, label: item.text };
  })()`);
  if (!target) return false;
  await mouseClick(cdp, target);
  return true;
}

async function openProfileContactDetails(cdp) {
  const target = await evaluate(cdp, `(() => {
    const pattern = /^(contact|contact options|email|e-mail|\\u8054\\u7cfb|\\u806f\\u7d61|\\u8054\\u7cfb\\u65b9\\u5f0f|\\u806f\\u7d61\\u65b9\\u5f0f|\\u7535\\u5b50\\u90ae\\u4ef6|\\u96fb\\u5b50\\u90f5\\u4ef6)$/i;
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button, [role="button"], a')]
      .map((node) => ({
        node,
        text: normalize(node.innerText || node.textContent || node.getAttribute('aria-label')),
        href: node.getAttribute('href') || '',
        rect: node.getBoundingClientRect()
      }))
      .filter((item) => pattern.test(item.text))
      .filter((item) => !/^mailto:/i.test(item.href))
      .filter((item) => item.rect.width > 12 && item.rect.height > 8 && item.rect.bottom > 0 && item.rect.top < Math.min(window.innerHeight, 760))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const item = candidates[0];
    if (!item) return null;
    return { x: item.rect.left + item.rect.width / 2, y: item.rect.top + item.rect.height / 2, label: item.text };
  })()`);
  if (!target) return false;
  await mouseClick(cdp, target);
  return true;
}

export async function writeExcel(filePath, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IG See All Expander";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("handles");
  sheet.columns = [
    { header: "handle", key: "handle", width: 34 },
    { header: "followers", key: "followers", width: 14 },
    { header: "following", key: "following", width: 14 },
    { header: "email", key: "email", width: 42 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172033" } };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.getRow(1).height = 22;
  for (const row of rows) sheet.addRow(row);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:D1";
  await workbook.xlsx.writeFile(filePath);
}

async function collectSeed({ session, seed, seedSet, job }) {
  const cdp = await createBrowserPage(session, seed);
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable").catch(() => {});
    await cdp.send("Page.bringToFront").catch(() => {});
    await cdp.send("Page.navigate", { url: `https://www.instagram.com/${seed}/` }).catch(() => {});
    await sleep(6500);
    if (job.cancelled) return { seed, handles: [] };

    let similarResult = await clickSimilarAccounts(cdp);
    if (!similarResult?.clicked) throw new Error(`Similar accounts button was not found. ${similarResult?.diagnostic || ""}`.trim());

    let suggestedState = await waitForSuggestedSurface(cdp, 12000);
    if (!suggestedState.dialogOpen && !suggestedState.hasSeeAll) {
      // Instagram occasionally ignores the first click while the profile header is still hydrating.
      similarResult = await clickSimilarAccounts(cdp);
      if (similarResult?.clicked) suggestedState = await waitForSuggestedSurface(cdp, 8000);
    }

    if (!suggestedState.dialogOpen) {
      const seeAllClicked = await clickSeeAll(cdp, 12000);
      if (!seeAllClicked) {
        throw new Error(`See all button was not found after opening suggestions. ${formatSuggestedDiagnostic(suggestedState)}`.trim());
      }
      await waitForDialog(cdp, 12000);
    }

    const handles = new Map();
    let confirmation = createBottomConfirmationState();
    let finalScrollState = null;
    let bottomConfirmed = false;

    for (let round = 0; round < 240; round += 1) {
      if (job.cancelled) break;
      const items = await extractSuggestedModal(cdp, seed, seedSet);
      for (const handle of items) handles.set(handle, handle);

      const scrollState = await scrollSuggestedModal(cdp);
      if (!scrollState?.dialogFound) throw new Error("Suggested for you dialog closed before the full list was captured.");
      finalScrollState = scrollState;
      confirmation = updateBottomConfirmation(confirmation, scrollState, handles.size);
      const maxTop = Math.max(0, scrollState.scrollHeight - scrollState.clientHeight);
      emit(job, "seed:progress", {
        seed,
        count: handles.size,
        scrollTop: Math.max(0, scrollState.scrollTop),
        maxTop,
        atBottom: scrollState.atBottom,
        bottomStable: confirmation.stableBottomRounds,
        bottomRequired: BOTTOM_CONFIRMATION_ROUNDS,
      });

      if (confirmation.complete) {
        bottomConfirmed = true;
        break;
      }
      if (confirmation.nonBottomStallRounds >= NON_BOTTOM_STALL_LIMIT) {
        throw new Error(`See all list could not reach the bottom (${Math.max(0, scrollState.scrollTop)}/${maxTop}). No partial result was accepted.`);
      }
      await sleep(scrollState.atBottom ? 1150 : 720);
    }

    if (job.cancelled) {
      emit(job, "log", {
        level: "warn",
        message: `@${seed} stopped by user before bottom confirmation with ${handles.size} handle(s).`,
      });
      await closeDialog(cdp).catch(() => {});
      return { seed, handles: [...handles.keys()], cancelled: true, bottomConfirmed: false };
    }

    if (!bottomConfirmed) {
      const maxTop = Math.max(0, (finalScrollState?.scrollHeight || 0) - (finalScrollState?.clientHeight || 0));
      throw new Error(`See all list did not pass full-bottom confirmation (${Math.max(0, finalScrollState?.scrollTop || 0)}/${maxTop}). No partial result was accepted.`);
    }

    if (finalScrollState) {
      const maxTop = Math.max(0, (finalScrollState.scrollHeight || 0) - (finalScrollState.clientHeight || 0));
      emit(job, "log", {
        level: "success",
        message: `@${seed} See all bottom fully confirmed (${finalScrollState.scrollTop}/${maxTop}) after ${confirmation.stableBottomRounds} stable checks.`,
      });
    }

    await closeDialog(cdp).catch(() => {});
    return { seed, handles: [...handles.keys()], cancelled: false, bottomConfirmed: true };
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
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1200;
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = (r) => r.width > 18 && r.height > 18 && r.bottom > 0 && r.top < window.innerHeight;
    const candidates = [...document.querySelectorAll('[role=button], button, a')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const descendantLabels = [...el.querySelectorAll('[aria-label], [title]')]
          .slice(0, 8)
          .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || ''))
          .join(' ');
        return {
          el,
          text: normalize(el.innerText || el.textContent),
          aria: normalize((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + descendantLabels),
          r
        };
      })
      .filter((x) => visible(x.r) && x.r.top < Math.min(window.innerHeight * 0.62, 560));
    const semanticPattern = /similar accounts|discover people|suggested accounts|account suggestions|show account suggestions|recommendations|\\u63a8\\u8350|\\u76f8\\u4f3c|\\u53d1\\u73b0\\u7528\\u6237/i;
    const excludedPattern = /more options|options|menu|follow|message|share profile|\\u5173\\u6ce8|\\u6d88\\u606f|\\u66f4\\u591a|\\u9009\\u9879|\\u83dc\\u5355/i;
    const messageButton = candidates.find((x) => /^(message|\\u6d88\\u606f)$|send message|\\u53d1\\u9001\\u6d88\\u606f/i.test(x.text + ' ' + x.aria));
    const spatialCandidates = messageButton
      ? candidates
          .filter((x) => x.r.left >= messageButton.r.right - 6)
          .filter((x) => Math.abs((x.r.top + x.r.height / 2) - (messageButton.r.top + messageButton.r.height / 2)) < Math.max(34, messageButton.r.height))
          .filter((x) => x.r.width <= 90 && x.r.height <= 74 && !excludedPattern.test(x.text + ' ' + x.aria))
          .sort((a, b) => a.r.left - b.r.left)
      : [];
    const target =
      candidates.find((x) => semanticPattern.test(x.text + ' ' + x.aria)) ||
      spatialCandidates[0] ||
      candidates
        .filter((x) => !excludedPattern.test(x.text + ' ' + x.aria))
        .filter((x) => x.r.left > viewportWidth * 0.52 && x.r.width <= 90 && x.r.height <= 74)
        .sort((a, b) => b.r.left - a.r.left)[0];
    if (!target) {
      return {
        clicked: false,
        diagnostic: 'Visible profile controls: ' + candidates.slice(0, 12).map((x) => normalize(x.text + ' ' + x.aria) || '[icon]').join(' | ')
      };
    }
    return {
      clicked: true,
      x: target.r.left + target.r.width / 2,
      y: target.r.top + target.r.height / 2,
      label: normalize(target.text + ' ' + target.aria) || '[icon]'
    };
  })()`);
  if (!result?.clicked) return result || { clicked: false };
  await mouseClick(cdp, result);
  await sleep(450);
  return result;
}

async function clickSeeAll(cdp, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await evaluate(cdp, `(() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const seeAllPattern = /^(see all|view all|show all|\\u67e5\\u770b\\u5168\\u90e8|\\u67e5\\u770b\\u6240\\u6709|\\u5168\\u90e8\\u67e5\\u770b|ver todo|voir tout|voir tous|ver tudo|mostra tutti|alle ansehen|alle anzeigen|\\ubaa8\\ub450 \\ubcf4\\uae30)$/i;
      const titlePattern = /suggested for you|suggestions for you|recommended for you|\\u4e3a\\u4f60\\u63a8\\u8350|\\u63a8\\u8350\\u7ed9\\u4f60|\\u4f60\\u53ef\\u80fd\\u8ba4\\u8bc6|sugerencias para ti|suggestions pour vous|vorschl\\u00e4ge f\\u00fcr dich/i;
      const all = [...document.querySelectorAll('a, button, [role=button], span, div')];
      const headings = all.filter((el) => titlePattern.test(normalize(el.innerText || el.textContent)));
      const scored = all
        .map((el) => {
          const text = normalize(el.innerText || el.textContent);
          const r = el.getBoundingClientRect();
          const interactive = el.closest('a, button, [role=button]') || el;
          const ir = interactive.getBoundingClientRect();
          const nearHeading = headings.some((heading) => {
            const hr = heading.getBoundingClientRect();
            return ir.top >= hr.top - 80 && ir.top <= hr.bottom + Math.max(180, window.innerHeight * 0.55);
          });
          return { el: interactive, text, r: ir, nearHeading };
        })
        .filter((x) => seeAllPattern.test(x.text))
        .filter((x) => x.r.width > 12 && x.r.height > 8)
        .sort((a, b) => Number(b.nearHeading) - Number(a.nearHeading) || a.r.top - b.r.top || a.r.width - b.r.width);
      const target = scored[0];
      if (!target) return null;
      if (target.r.bottom <= 0 || target.r.top >= window.innerHeight) {
        target.el.scrollIntoView({ block: 'center', inline: 'nearest' });
        return { needsScroll: true, label: target.text };
      }
      return { x: target.r.left + target.r.width / 2, y: target.r.top + target.r.height / 2, label: target.text };
    })()`);
    if (result) {
      if (result.needsScroll) {
        await sleep(350);
        continue;
      }
      await mouseClick(cdp, result);
      return true;
    }
    await sleep(400);
  }
  return false;
}

async function waitForSuggestedSurface(cdp, timeoutMs) {
  const start = Date.now();
  let latest = { dialogOpen: false, hasHeading: false, hasSeeAll: false, candidates: [] };
  while (Date.now() - start < timeoutMs) {
    latest = await inspectSuggestedSurface(cdp).catch(() => latest);
    if (latest.dialogOpen || latest.hasSeeAll) return latest;
    await sleep(400);
  }
  return latest;
}

async function inspectSuggestedSurface(cdp) {
  return evaluate(cdp, `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const titlePattern = /suggested for you|suggestions for you|recommended for you|\\u4e3a\\u4f60\\u63a8\\u8350|\\u63a8\\u8350\\u7ed9\\u4f60|\\u4f60\\u53ef\\u80fd\\u8ba4\\u8bc6|sugerencias para ti|suggestions pour vous|vorschl\\u00e4ge f\\u00fcr dich/i;
    const seeAllPattern = /^(see all|view all|show all|\\u67e5\\u770b\\u5168\\u90e8|\\u67e5\\u770b\\u6240\\u6709|\\u5168\\u90e8\\u67e5\\u770b|ver todo|voir tout|voir tous|ver tudo|mostra tutti|alle ansehen|alle anzeigen|\\ubaa8\\ub450 \\ubcf4\\uae30)$/i;
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const dialogOpen = dialogs.some((el) => titlePattern.test(normalize(el.innerText || el.textContent)));
    const visible = [...document.querySelectorAll('a, button, [role=button], h1, h2, h3, span, div')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: normalize(el.innerText || el.textContent),
          aria: normalize((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')),
          r
        };
      })
      .filter((x) => x.r.width > 10 && x.r.height > 8 && x.r.bottom > 0 && x.r.top < window.innerHeight);
    const hasHeading = visible.some((x) => titlePattern.test(x.text + ' ' + x.aria));
    const hasSeeAll = visible.some((x) => seeAllPattern.test(x.text));
    const interesting = visible
      .filter((x) => /suggest|recommend|similar|see all|view all|show all|\\u63a8\\u8350|\\u76f8\\u4f3c|\\u67e5\\u770b\\u5168\\u90e8/i.test(x.text + ' ' + x.aria))
      .map((x) => normalize(x.text + ' ' + x.aria))
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 10);
    return { dialogOpen, hasHeading, hasSeeAll, candidates: interesting };
  })()`);
}

function formatSuggestedDiagnostic(state) {
  if (!state) return "No Suggested for you surface was detected.";
  const flags = `heading=${Boolean(state.hasHeading)}, seeAll=${Boolean(state.hasSeeAll)}, dialog=${Boolean(state.dialogOpen)}`;
  const candidates = Array.isArray(state.candidates) && state.candidates.length ? `; visible candidates: ${state.candidates.join(" | ")}` : "";
  return `Page state: ${flags}${candidates}`;
}

async function extractSuggestedModal(cdp, seed, seedSet) {
  const data = await evaluate(
    cdp,
    `(() => {
      const pageHandle = ${JSON.stringify(seed)};
      const seedSet = new Set(${JSON.stringify([...seedSet])});
      const reserved = new Set(${JSON.stringify([...reservedHandles])});
      const titlePattern = /suggested for you|suggestions for you|recommended for you|\\u4e3a\\u4f60\\u63a8\\u8350|\\u63a8\\u8350\\u7ed9\\u4f60|\\u4f60\\u53ef\\u80fd\\u8ba4\\u8bc6|sugerencias para ti|suggestions pour vous|vorschl\\u00e4ge f\\u00fcr dich/i;
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find((el) => titlePattern.test((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()));
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
    const titlePattern = /suggested for you|suggestions for you|recommended for you|\\u4e3a\\u4f60\\u63a8\\u8350|\\u63a8\\u8350\\u7ed9\\u4f60|\\u4f60\\u53ef\\u80fd\\u8ba4\\u8bc6|sugerencias para ti|suggestions pour vous|vorschl\\u00e4ge f\\u00fcr dich/i;
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((el) => titlePattern.test((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()));
    if (!dialog) return { dialogFound: false, changed: false, atBottom: false, scrollTop: -1, scrollHeight: 0, clientHeight: 0, rect: null };
    const scrollBox = [...dialog.querySelectorAll('div')]
      .filter((el) => el.scrollHeight > el.clientHeight + 20)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || dialog;
    const before = scrollBox.scrollTop;
    const rect = scrollBox.getBoundingClientRect();
    scrollBox.scrollTop = Math.min(scrollBox.scrollTop + Math.max(180, Math.floor(scrollBox.clientHeight * 0.72)), scrollBox.scrollHeight);
    scrollBox.dispatchEvent(new Event('scroll', { bubbles: true }));
    return {
      dialogFound: true,
      changed: scrollBox.scrollTop !== before,
      scrollTop: scrollBox.scrollTop,
      scrollHeight: scrollBox.scrollHeight,
      clientHeight: scrollBox.clientHeight,
      atBottom: scrollBox.scrollTop >= scrollBox.scrollHeight - scrollBox.clientHeight - 3,
      rect: { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height - 12, Math.max(12, rect.height * 0.78)) }
    };
  })()`);
  if (!beforeState?.rect) return beforeState;
  await cdp
    .send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: beforeState.rect.x,
      y: beforeState.rect.y,
      deltaX: 0,
      deltaY: Math.max(320, Math.floor((beforeState.clientHeight || 400) * 0.95)),
    })
    .catch(() => {});
  await sleep(120);
  const afterState = await evaluate(cdp, `(() => {
    const titlePattern = /suggested for you|suggestions for you|recommended for you|\\u4e3a\\u4f60\\u63a8\\u8350|\\u63a8\\u8350\\u7ed9\\u4f60|\\u4f60\\u53ef\\u80fd\\u8ba4\\u8bc6|sugerencias para ti|suggestions pour vous|vorschl\\u00e4ge f\\u00fcr dich/i;
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((el) => titlePattern.test((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()));
    if (!dialog) return { dialogFound: false, changed: false, atBottom: false, scrollTop: -1, scrollHeight: 0, clientHeight: 0 };
    const scrollBox = [...dialog.querySelectorAll('div')]
      .filter((el) => el.scrollHeight > el.clientHeight + 20)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || dialog;
    return {
      dialogFound: true,
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
    const titlePattern = /suggested for you|suggestions for you|recommended for you|\\u4e3a\\u4f60\\u63a8\\u8350|\\u63a8\\u8350\\u7ed9\\u4f60|\\u4f60\\u53ef\\u80fd\\u8ba4\\u8bc6|sugerencias para ti|suggestions pour vous|vorschl\\u00e4ge f\\u00fcr dich/i;
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((el) => titlePattern.test((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()));
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
      `(() => {
        const titlePattern = /suggested for you|suggestions for you|recommended for you|\\u4e3a\\u4f60\\u63a8\\u8350|\\u63a8\\u8350\\u7ed9\\u4f60|\\u4f60\\u53ef\\u80fd\\u8ba4\\u8bc6|sugerencias para ti|suggestions pour vous|vorschl\\u00e4ge f\\u00fcr dich/i;
        return [...document.querySelectorAll('[role="dialog"]')].some((el) => titlePattern.test((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()));
      })()`
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
  persistJobEvent(job, type, event.data);
  for (const client of job.clients) writeSse(client, type, event.data);
}

function persistJobEvent(job, type, data) {
  if (!["log", "seed:error", "error", "done"].includes(type)) return;
  const level = type === "seed:error" || type === "error" ? "warn" : data.level || "info";
  const message =
    type === "seed:error"
      ? `Job ${job.id} @${data.seed}: ${data.error}`
      : type === "done"
        ? `Job ${job.id} ${data.status}: ${data.count} handle(s).`
        : `Job ${job.id}: ${data.message || data.error || JSON.stringify(data)}`;
  logRuntime(level, message);
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

function isAuthorizedRequest(req, url) {
  if (!apiToken) return true;
  const provided = String(req.headers["x-app-token"] || url.searchParams.get("token") || "");
  const expectedBuffer = Buffer.from(apiToken);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

async function openDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
  if (openPathHandler) {
    const error = await openPathHandler(targetPath);
    if (error) throw new Error(error);
    return;
  }
  if (process.platform !== "win32") throw new Error("Opening folders is currently supported on Windows only.");
  const child = spawn("explorer.exe", [targetPath], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

async function openExternalUrl(targetUrl) {
  if (/^chrome:\/\//i.test(targetUrl)) {
    const chromePath = findChromeExecutable();
    if (!chromePath) throw new Error("Google Chrome was not found. Please open Chrome manually and go to chrome://extensions/.");
    const child = spawn(chromePath, [targetUrl], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return;
  }
  if (openExternalHandler) {
    const error = await openExternalHandler(targetUrl);
    if (error) throw new Error(error);
    return;
  }
  if (process.platform !== "win32") throw new Error("Opening Chrome URLs is currently supported on Windows only.");
  const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", targetUrl], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function findChromeExecutable() {
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function logRuntime(level, message) {
  const line = `[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${String(message)}\n`;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "app.log"), line, "utf8");
  } catch {
    // Logging must never interrupt a capture job.
  }
  if (level === "error") console.error(message);
  else console.log(message);
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

export function collectProfileEmails(info = {}) {
  return extractEmails([
    info.bio,
    info.businessEmail,
    info.publicEmail,
    info.profileContactEmail,
    info.contactText,
  ].filter(Boolean).join("\n"));
}

function mergeProfileInfo(primary = {}, fallback = {}) {
  const preferCount = (first, second) => first !== null && first !== undefined && first !== "" ? first : second;
  return {
    followers: preferCount(primary.followers, fallback.followers),
    following: preferCount(primary.following, fallback.following),
    bio: [primary.bio, fallback.bio].filter(Boolean).join("\n"),
    businessEmail: [primary.businessEmail, fallback.businessEmail].filter(Boolean).join("\n"),
    publicEmail: [primary.publicEmail, fallback.publicEmail].filter(Boolean).join("\n"),
    profileContactEmail: [primary.profileContactEmail, fallback.profileContactEmail].filter(Boolean).join("\n"),
    contactText: [primary.contactText, fallback.contactText].filter(Boolean).join("\n"),
    bioExpanded: Boolean(primary.bioExpanded || fallback.bioExpanded),
  };
}

function formatCount(value) {
  if (value === null || value === undefined || value === "") return "\u672a\u77e5";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return "\u672a\u77e5";
  return text;
}

export function createBottomConfirmationState() {
  return {
    previousCount: null,
    previousScrollTop: null,
    previousScrollHeight: null,
    previousMaxTop: null,
    stableBottomRounds: 0,
    nonBottomStallRounds: 0,
    complete: false,
  };
}

export function updateBottomConfirmation(previous, scrollState, handleCount) {
  const current = previous || createBottomConfirmationState();
  const scrollTop = Number(scrollState?.scrollTop || 0);
  const scrollHeight = Number(scrollState?.scrollHeight || 0);
  const clientHeight = Number(scrollState?.clientHeight || 0);
  const maxTop = Math.max(0, scrollHeight - clientHeight);
  const metricsStable =
    current.previousCount === handleCount &&
    current.previousScrollHeight === scrollHeight &&
    current.previousMaxTop === maxTop;
  const stayedAtBottom = Boolean(scrollState?.atBottom) && metricsStable;
  const samePosition = current.previousScrollTop === scrollTop;
  const stableBottomRounds = stayedAtBottom ? current.stableBottomRounds + 1 : 0;
  const nonBottomStallRounds = !scrollState?.atBottom && !scrollState?.changed && samePosition
    ? current.nonBottomStallRounds + 1
    : 0;

  return {
    previousCount: handleCount,
    previousScrollTop: scrollTop,
    previousScrollHeight: scrollHeight,
    previousMaxTop: maxTop,
    stableBottomRounds,
    nonBottomStallRounds,
    complete: stableBottomRounds >= BOTTOM_CONFIRMATION_ROUNDS,
  };
}

function timestampForFile() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const token = createAccessToken();
  startLocalServer({
    token,
    port: Number(process.env.PORT || 4761),
    mode: "source",
    version: process.env.npm_package_version || sourcePackage.version || "0.1.0",
  })
    .then(({ url }) => {
      const appUrl = `${url}/?token=${encodeURIComponent(token)}`;
      console.log(`IG See All Expander running at ${appUrl}`);
      if (process.env.OPEN_BROWSER !== "0" && process.platform === "win32") {
        const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", appUrl], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
