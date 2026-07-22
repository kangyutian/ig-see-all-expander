import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  CheckCircle2,
  Chrome,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Languages,
  Play,
  Radar,
  RefreshCw,
  ScrollText,
  Sparkles,
  Square,
  TerminalSquare,
  Users,
  UsersRound,
} from "lucide-react";
import "./styles.css";

const appToken = new URLSearchParams(window.location.search).get("token") || "";

const sampleHandles = [
  "the_vintage_tourists",
  "kait.holt",
  "miss_anita_simpson",
  "richardheeps",
  "every_night_something_awful",
  "irainamancini",
  "katenamedsue",
].join("\n");

const UI_TEXT = {
  zh: {
    subtitle: "浏览器实时连接 · 完整到底抓取 · 账号资料补充",
    language: "界面语言",
    guide: "连接指南",
    openOutputs: "打开输出文件夹",
    openLogs: "打开日志文件夹",
    openConnector: "打开 Chrome Connector 文件夹",
    scanSessions: "扫描浏览器会话",
    captureMode: "抓取模式",
    suggested: "推荐账号",
    followers: "粉丝列表",
    seeds: "种子账号",
    accounts: "{count} 个账号",
    outputName: "输出文件名",
    enrichment: "资料补充",
    none: "不补充",
    first500: "前 500 个",
    all: "全部",
    browser: "浏览器连接",
    found: "发现 {count} 个",
    scan: "扫描",
    connectorFolder: "Connector 文件夹",
    chromeExtensions: "Chrome 扩展程序",
    connectorOnline: "{count} 个 Chrome Connector 已在线。",
    connectorHint: "普通 Chrome 默认无法直接控制。只需安装一次 Connector，即可复用当前已登录 Instagram 的标签页。",
    instagramTabs: "{count} 个 Instagram 标签页",
    noInstagramTab: "没有 Instagram 标签页",
    sessionCookie: "检测到登录 Cookie",
    loggedLikely: "可能已登录",
    loginUnknown: "未确认登录",
    browserEmpty: "请先打开已登录 Instagram 的指纹浏览器标签页。普通 Chrome 请按“连接指南”安装一次 Connector，然后点击扫描。",
    manualCdp: "手动 CDP 地址",
    start: "开始",
    stop: "停止",
    uniqueFollowers: "去重粉丝账号",
    uniqueHandles: "去重推荐账号",
    ready: "准备就绪",
    running: "运行中",
    session: "当前会话",
    notSelected: "未选择",
    followersCapture: "粉丝列表抓取",
    suggestedCapture: "查看全部抓取",
    waiting: "等待中",
    done: "已完成",
    profileEnrichment: "账号资料补充",
    seedStatus: "种子账号状态",
    capturing: "抓取中",
    idle: "空闲",
    seedEmpty: "运行任务后，这里会显示每个种子账号的数量和到底状态。",
    runtimeLog: "运行日志",
    noActivity: "暂无运行记录。",
    txt: "TXT",
    excel: "Excel",
    guideTitle: "浏览器连接指南",
    guideIntro: "先选择你正在使用的浏览器方式。普通 Chrome 安装一次 Connector 后，后续只需打开 Instagram 并点击扫描。",
    normalChrome: "普通 Chrome",
    fingerprintBrowser: "指纹浏览器",
    stepConnectorFolder: "打开 Connector 文件夹，并记住或复制下面的文件夹路径。",
    stepExtensions: "打开 Chrome 扩展程序页面，开启右上角“开发者模式”。",
    stepLoadUnpacked: "点击“加载已解压的扩展程序”，选择整个 Connector 文件夹，不要选择其中某一个文件。",
    stepInstagram: "在同一个 Chrome 中打开 Instagram 并完成登录，保持标签页开启。",
    stepScan: "返回软件点击“扫描”，选择显示为 Chrome Connector 且已登录的结果。",
    connectorPath: "Connector 文件夹路径",
    copyPath: "复制路径",
    copiedPath: "Connector 文件夹路径已复制。",
    openExtensions: "打开扩展程序页面",
    instagramUrl: "Instagram 地址",
    openInstagram: "打开 Instagram",
    copyUrl: "复制链接",
    copiedUrl: "Instagram 链接已复制。",
    fingerprintStep1: "在指纹浏览器中打开一个环境，并登录 Instagram。",
    fingerprintStep2: "保持至少一个 Instagram 标签页开启，然后返回软件点击“扫描”。",
    fingerprintStep3: "如果浏览器自动暴露调试接口，软件会直接列出该会话，选择后即可开始。",
    fingerprintStep4: "只有浏览器明确提供 CDP/远程调试地址时，才复制到“手动 CDP 地址”；不要填写普通网页链接。",
    cdpExample: "CDP 示例：http://127.0.0.1:9222",
    close: "关闭",
  },
  en: {
    subtitle: "Live browser connection · full-bottom capture · profile enrichment",
    language: "Language",
    guide: "Connection guide",
    openOutputs: "Open output folder",
    openLogs: "Open log folder",
    openConnector: "Open Chrome Connector folder",
    scanSessions: "Scan browser sessions",
    captureMode: "Capture mode",
    suggested: "Suggested",
    followers: "Followers",
    seeds: "Seeds",
    accounts: "{count} account(s)",
    outputName: "Output name",
    enrichment: "Profile enrichment",
    none: "None",
    first500: "First 500",
    all: "All",
    browser: "Browser",
    found: "{count} found",
    scan: "Scan",
    connectorFolder: "Connector folder",
    chromeExtensions: "Chrome extensions",
    connectorOnline: "{count} Chrome connector(s) online.",
    connectorHint: "Normal Chrome cannot be controlled directly. Install the Connector once to reuse the current logged-in Instagram tab.",
    instagramTabs: "{count} Instagram tab(s)",
    noInstagramTab: "No Instagram tab",
    sessionCookie: "Session cookie detected",
    loggedLikely: "Logged in likely",
    loginUnknown: "Login not confirmed",
    browserEmpty: "Open a logged-in Instagram tab in a fingerprint browser. For normal Chrome, install the Connector once from the Connection guide, then Scan.",
    manualCdp: "Manual CDP URL",
    start: "Start",
    stop: "Stop",
    uniqueFollowers: "Unique followers",
    uniqueHandles: "Unique handles",
    ready: "Ready",
    running: "Running",
    session: "Session",
    notSelected: "Not selected",
    followersCapture: "Followers capture",
    suggestedCapture: "See all capture",
    waiting: "Waiting",
    done: "Done",
    profileEnrichment: "Profile enrichment",
    seedStatus: "Seed Status",
    capturing: "Capturing",
    idle: "Idle",
    seedEmpty: "Run a batch to see per-account counts and bottom status.",
    runtimeLog: "Log",
    noActivity: "No activity yet.",
    txt: "TXT",
    excel: "Excel",
    guideTitle: "Browser connection guide",
    guideIntro: "Choose the browser method you use. After installing the Connector once in normal Chrome, later sessions only need an open logged-in Instagram tab and Scan.",
    normalChrome: "Normal Chrome",
    fingerprintBrowser: "Fingerprint browser",
    stepConnectorFolder: "Open the Connector folder and keep or copy the folder path below.",
    stepExtensions: "Open Chrome extensions and enable Developer mode in the top-right corner.",
    stepLoadUnpacked: "Click Load unpacked and select the whole Connector folder, not an individual file inside it.",
    stepInstagram: "Open Instagram in the same Chrome, sign in, and keep the tab open.",
    stepScan: "Return to the app, click Scan, and select the logged-in Chrome Connector result.",
    connectorPath: "Connector folder path",
    copyPath: "Copy path",
    copiedPath: "Connector folder path copied.",
    openExtensions: "Open extensions",
    instagramUrl: "Instagram URL",
    openInstagram: "Open Instagram",
    copyUrl: "Copy URL",
    copiedUrl: "Instagram URL copied.",
    fingerprintStep1: "Open a profile in the fingerprint browser and sign in to Instagram.",
    fingerprintStep2: "Keep at least one Instagram tab open, return to the app, and click Scan.",
    fingerprintStep3: "If the browser exposes a debugging endpoint, the app lists the session automatically. Select it and start.",
    fingerprintStep4: "Only paste a CDP/remote-debugging address when the browser explicitly provides one. Do not paste a normal webpage URL.",
    cdpExample: "CDP example: http://127.0.0.1:9222",
    close: "Close",
  },
};

function uiText(locale, key, variables = {}) {
  let value = UI_TEXT[locale]?.[key] || UI_TEXT.en[key] || key;
  for (const [name, replacement] of Object.entries(variables)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

function App() {
  const [locale, setLocale] = useState(() => window.localStorage.getItem("ig-see-all-language") || "zh");
  const [handlesText, setHandlesText] = useState("");
  const [outputName, setOutputName] = useState("");
  const [captureMode, setCaptureMode] = useState("suggested");
  const [enrichmentMode, setEnrichmentMode] = useState("first500");
  const [guideOpen, setGuideOpen] = useState(false);
  const [manualCdpUrl, setManualCdpUrl] = useState("");
  const [browsers, setBrowsers] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [connectorInfo, setConnectorInfo] = useState(null);
  const [jobId, setJobId] = useState("");
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [enrichProgress, setEnrichProgress] = useState(null);
  const [logs, setLogs] = useState([]);
  const [seedStats, setSeedStats] = useState({});
  const [systemInfo, setSystemInfo] = useState(null);
  const eventSourceRef = useRef(null);
  const logEndRef = useRef(null);
  const t = (key, variables) => uiText(locale, key, variables);

  const normalizedPreview = useMemo(() => normalizeHandles(handlesText), [handlesText]);
  const selectedBrowser = browsers.find((browser) => browser.sessionId === selectedSessionId);
  const activeSessionLabel = manualCdpUrl.trim() || selectedBrowser?.currentUrl || selectedBrowser?.cdpUrl || t("notSelected");
  const activeCapture = Object.entries(seedStats).find(([, stat]) => stat.status === "running");
  const isFollowersMode = captureMode === "followers";
  const defaultOutputName = isFollowersMode ? "ig-followers-handles" : "ig-see-all-handles";

  useEffect(() => {
    loadSystemInfo();
    loadConnectorInfo();
    discoverBrowsers();
    return () => eventSourceRef.current?.close();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logs]);

  useEffect(() => {
    window.localStorage.setItem("ig-see-all-language", locale);
  }, [locale]);

  async function discoverBrowsers() {
    setDiscovering(true);
    setBrowsers([]);
    setSelectedSessionId("");
    addLog("Scanning current fingerprint browser and Chrome connector sessions...", "info");
    try {
      const data = await apiGet("/api/browser/discover");
      setBrowsers(data.browsers || []);
      setConnectorInfo((prev) => ({ ...(prev || {}), ...(data.diagnostics || {}) }));
      const best = (data.browsers || [])[0];
      if (best) {
        setManualCdpUrl("");
        setSelectedSessionId(best.sessionId);
        addLog(`Found ${best.browserType || "browser"} ${best.source === "chrome-connector" ? "via Chrome Connector" : best.cdpUrl} with logged-in Instagram tab.`, "success");
      } else {
        const hidden = data.diagnostics?.hiddenNoLoginOrNoInstagram || 0;
        const normalChrome = data.diagnostics?.normalChromeWithoutDebug || 0;
        addLog(
          `No live logged-in controllable Instagram session found${hidden ? ` (${hidden} candidate(s) hidden because IG/login was not confirmed)` : ""}${normalChrome ? `. Normal Chrome is open, but Chrome does not expose control access unless the Connector is installed or Chrome was started with a debug port` : ""}.`,
          "warn"
        );
      }
    } catch (error) {
      addLog(error.message || String(error), "error");
    } finally {
      setDiscovering(false);
    }
  }

  async function loadSystemInfo() {
    try {
      setSystemInfo(await apiGet("/api/system/info"));
    } catch (error) {
      addLog(error.message || String(error), "warn");
    }
  }

  async function loadConnectorInfo() {
    try {
      setConnectorInfo(await apiGet("/api/browser/connector-info"));
    } catch (error) {
      addLog(error.message || String(error), "warn");
    }
  }

  async function openSystemFolder(kind) {
    try {
      const data = await apiPost(`/api/system/open-${kind}`, {});
      addLog(`Opened ${kind} folder: ${data.path}`, "success");
    } catch (error) {
      addLog(error.message || String(error), "error");
    }
  }

  async function openChromeExtensions() {
    try {
      await apiPost("/api/system/open-chrome-extensions", {});
      addLog("Opened chrome://extensions. Enable Developer mode, then Load unpacked.", "info");
    } catch (error) {
      addLog(error.message || String(error), "error");
    }
  }

  async function openInstagram() {
    try {
      await apiPost("/api/system/open-instagram", {});
      addLog("Opened Instagram in the default browser.", "info");
    } catch (error) {
      addLog(error.message || String(error), "error");
    }
  }

  async function copyGuideValue(value, successMessage) {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      addLog(successMessage, "success");
    } catch {
      addLog("Could not copy to the clipboard.", "error");
    }
  }

  async function startJob() {
    if (!normalizedPreview.length) {
      addLog("Enter at least one Instagram handle.", "error");
      return;
    }
    if (!manualCdpUrl.trim() && !selectedSessionId) {
      addLog("Choose a live browser session or enter a Manual CDP URL.", "error");
      return;
    }
    eventSourceRef.current?.close();
    setComplete(false);
    setTotalCount(0);
    setEnrichProgress(null);
    setSeedStats({});
    setLogs([]);
    setRunning(true);
    try {
      const data = await apiPost("/api/expand", {
        handlesText,
        sessionId: manualCdpUrl.trim() ? "" : selectedSessionId,
        cdpUrl: manualCdpUrl.trim(),
        outputName,
        captureMode,
        enrichmentMode: isFollowersMode ? enrichmentMode : "all",
      });
      setJobId(data.jobId);
      attachEvents(data.jobId);
    } catch (error) {
      addLog(error.message || String(error), "error");
      setRunning(false);
    }
  }

  async function cancelJob() {
    if (!jobId) return;
    await apiPost(`/api/jobs/${jobId}/cancel`, {});
  }

  function attachEvents(id) {
    const source = new EventSource(apiUrl(`/api/jobs/${id}/events`));
    eventSourceRef.current = source;
    source.addEventListener("status", (event) => {
      const data = JSON.parse(event.data);
      addLog(`${data.captureMode === "followers" ? "Followers" : "Suggested"} job started for ${data.seeds?.length || 0} seed account(s).`, "info");
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse(event.data);
      addLog(data.message, data.level || "info");
    });
    source.addEventListener("seed:start", (event) => {
      const data = JSON.parse(event.data);
      setSeedStats((prev) => ({ ...prev, [data.seed]: { status: "running", count: 0, captureMode: data.captureMode } }));
      addLog(`Opening @${data.seed} (${data.index + 1}/${data.total})`, "info");
    });
    source.addEventListener("seed:progress", (event) => {
      const data = JSON.parse(event.data);
      setSeedStats((prev) => ({
        ...prev,
        [data.seed]: { ...(prev[data.seed] || {}), ...data, status: "running" },
      }));
    });
    source.addEventListener("seed:done", (event) => {
      const data = JSON.parse(event.data);
      setSeedStats((prev) => ({
        ...prev,
        [data.seed]: { ...(prev[data.seed] || {}), ...data, status: "done", count: data.count, bottomConfirmed: true },
      }));
      addLog(`@${data.seed}: ${data.count} ${data.captureMode === "followers" ? "follower(s)" : "handle(s)"}, full bottom confirmed.`, "success");
    });
    source.addEventListener("seed:limited", (event) => {
      const data = JSON.parse(event.data);
      setSeedStats((prev) => ({
        ...prev,
        [data.seed]: { ...(prev[data.seed] || {}), ...data, status: "limited", bottomConfirmed: true },
      }));
      addLog(`@${data.seed}: follower dialog bottom confirmed, but Instagram exposed ${data.count}/${data.expectedCount}.`, "warn");
    });
    source.addEventListener("seed:unavailable", (event) => {
      const data = JSON.parse(event.data);
      setSeedStats((prev) => ({
        ...prev,
        [data.seed]: { ...(prev[data.seed] || {}), ...data, status: "unavailable", count: 0, bottomConfirmed: false },
      }));
      addLog(`@${data.seed}: followers unavailable. ${data.reason || "Current session cannot view this list."}`, "warn");
    });
    source.addEventListener("seed:cancelled", (event) => {
      const data = JSON.parse(event.data);
      setSeedStats((prev) => ({
        ...prev,
        [data.seed]: { ...(prev[data.seed] || {}), status: "cancelled", count: data.count, bottomConfirmed: false },
      }));
      addLog(`@${data.seed}: stopped before full-bottom confirmation.`, "warn");
    });
    source.addEventListener("seed:error", (event) => {
      const data = JSON.parse(event.data);
      setSeedStats((prev) => ({ ...prev, [data.seed]: { status: "error", count: 0, error: data.error } }));
      addLog(`@${data.seed}: ${data.error}`, "error");
    });
    source.addEventListener("enrich:start", (event) => {
      const data = JSON.parse(event.data);
      setEnrichProgress({ current: 0, total: data.total || 0, handleTotal: data.handleTotal || 0, skipped: data.skipped || 0, mode: data.mode, handle: "" });
      addLog(
        data.mode === "none"
          ? `Profile enrichment skipped; ${data.handleTotal || 0} Excel row(s) will be marked as not captured.`
          : `Profile enrichment started for ${data.total || 0} of ${data.handleTotal || data.total || 0} handle(s).`,
        data.mode === "none" ? "warn" : "info"
      );
    });
    source.addEventListener("enrich:progress", (event) => {
      const data = JSON.parse(event.data);
      setEnrichProgress((prev) => ({
        ...(prev || {}),
        ...data,
        current: data.index || 0,
        total: data.total || 0,
        handle: data.handle || "",
      }));
    });
    source.addEventListener("enrich:done", (event) => {
      const data = JSON.parse(event.data);
      setEnrichProgress((prev) => ({ ...(prev || {}), ...data, current: data.current || 0, completed: true, handle: "" }));
    });
    source.addEventListener("done", (event) => {
      const data = JSON.parse(event.data);
      setTotalCount(data.count || 0);
      setComplete(true);
      setRunning(false);
      source.close();
      addLog(`TXT ready: ${data.count || 0} unique handle(s).`, data.status === "cancelled" ? "warn" : "success");
    });
    source.addEventListener("error", () => {
      if (!complete) addLog("Event stream disconnected.", "warn");
    });
  }

  function addLog(message, level = "info") {
    const text = String(message || "").trim();
    if (!text) return;
    setLogs((prev) => [...prev.slice(-300), { id: `${Date.now()}-${Math.random()}`, message: text, level }]);
  }

  function changeCaptureMode(nextMode) {
    if (running || nextMode === captureMode) return;
    setCaptureMode(nextMode);
    setComplete(false);
    setTotalCount(0);
    setEnrichProgress(null);
    setSeedStats({});
    setJobId("");
  }

  return (
    <main className="shell">
      <section className="toolbar">
        <div>
          <h1>IG See All Expander</h1>
          <p>{t("subtitle")}</p>
        </div>
        <div className="toolbarActions">
          {systemInfo && <span className="versionBadge">v{systemInfo.version} - {systemInfo.mode}</span>}
          <label className="languageControl" title={t("language")}>
            <Languages size={17} />
            <select value={locale} onChange={(event) => setLocale(event.target.value)} aria-label={t("language")}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <button className="iconButton" onClick={() => setGuideOpen(true)} title={t("guide")}>
            <CircleHelp size={18} />
          </button>
          <button className="iconButton" onClick={() => openSystemFolder("outputs")} title={t("openOutputs")}>
            <FolderOpen size={18} />
          </button>
          <button className="iconButton" onClick={() => openSystemFolder("logs")} title={t("openLogs")}>
            <ScrollText size={18} />
          </button>
          <button className="iconButton" onClick={() => openSystemFolder("connector")} title={t("openConnector")}>
            <Chrome size={18} />
          </button>
          <button className="iconButton" onClick={discoverBrowsers} disabled={discovering} title={t("scanSessions")}>
            {discovering ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
      </section>

      <section className="layout">
        <div className="panel inputPanel">
          <div className="modeBar">
            <span>{t("captureMode")}</span>
            <div className="segmented" role="group" aria-label={t("captureMode")}>
              <button
                className={captureMode === "suggested" ? "active" : ""}
                onClick={() => changeCaptureMode("suggested")}
                disabled={running}
                aria-pressed={captureMode === "suggested"}
              >
                <Sparkles size={15} />
                {t("suggested")}
              </button>
              <button
                className={captureMode === "followers" ? "active" : ""}
                onClick={() => changeCaptureMode("followers")}
                disabled={running}
                aria-pressed={captureMode === "followers"}
              >
                <Users size={15} />
                {t("followers")}
              </button>
            </div>
          </div>
          <div className="sectionHeader">
            <h2>{t("seeds")}</h2>
            <span>{t("accounts", { count: normalizedPreview.length })}</span>
          </div>
          <textarea
            value={handlesText}
            onChange={(event) => setHandlesText(event.target.value)}
            spellCheck={false}
            placeholder={sampleHandles}
          />
          <div className="fieldRow">
            <label>
              {t("outputName")}
              <input
                value={outputName}
                onChange={(event) => setOutputName(event.target.value)}
                placeholder={defaultOutputName}
              />
            </label>
          </div>

          {isFollowersMode && (
            <div className="enrichmentChooser">
              <span>{t("enrichment")}</span>
              <div className="segmented compactSegments" role="group" aria-label={t("enrichment")}>
                {[
                  ["none", t("none")],
                  ["first500", t("first500")],
                  ["all", t("all")],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={enrichmentMode === value ? "active" : ""}
                    onClick={() => setEnrichmentMode(value)}
                    disabled={running}
                    aria-pressed={enrichmentMode === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sectionHeader browserHeader">
            <h2>{t("browser")}</h2>
            <span>{t("found", { count: browsers.length })}</span>
          </div>
          <div className="browserActions">
            <button className="secondary compactButton" onClick={discoverBrowsers} disabled={discovering}>
              {discovering ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              {t("scan")}
            </button>
            <button className="secondary compactButton chromeButton" onClick={() => openSystemFolder("connector")}>
              <FolderOpen size={16} />
              {t("connectorFolder")}
            </button>
            <button className="secondary compactButton chromeButton" onClick={openChromeExtensions}>
              <Chrome size={16} />
              {t("chromeExtensions")}
            </button>
          </div>
          <div className="connectorHint">
            <strong>Chrome Connector</strong>
            <span>
              {connectorInfo?.connectedClients
                ? t("connectorOnline", { count: connectorInfo.connectedClients })
                : t("connectorHint")}
            </span>
          </div>
          <div className="browserList">
            {browsers.map((browser) => (
              <label
                className={`browserItem ${selectedSessionId === browser.sessionId && !manualCdpUrl ? "selected" : ""}`}
                key={`${browser.sessionId}-${browser.userDataDir}-${browser.source}`}
              >
                <input
                  type="radio"
                  name="browser"
                  checked={selectedSessionId === browser.sessionId && !manualCdpUrl}
                  onChange={() => {
                    setManualCdpUrl("");
                    setSelectedSessionId(browser.sessionId);
                  }}
                />
                <span>
                  <strong>
                    <em>{browser.source === "chrome-connector" ? "Chrome Connector" : browser.browserType || t("browser")}</em>
                    {browser.source === "chrome-connector" ? browser.currentUrl : browser.cdpUrl}
                  </strong>
                  <small>{browser.currentUrl || browser.userDataDir || browser.browserName || browser.source}</small>
                  <small className="browserMeta">
                    {browser.instagramTabs?.length ? t("instagramTabs", { count: browser.instagramTabs.length }) : t("noInstagramTab")}
                    {" - "}
                    {browser.hasSessionCookie ? t("sessionCookie") : browser.loginLikely ? t("loggedLikely") : t("loginUnknown")}
                  </small>
                </span>
                {browser.loginLikely ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
              </label>
            ))}
            {!browsers.length && <p className="empty">{t("browserEmpty")}</p>}
          </div>
          <label className="manualField">
            {t("manualCdp")}
            <input value={manualCdpUrl} onChange={(event) => setManualCdpUrl(event.target.value)} placeholder="http://127.0.0.1:65229" />
          </label>

          <div className="actions">
            <button className="primary" onClick={startJob} disabled={running}>
              {running ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {t("start")}
            </button>
            <button className="secondary" onClick={cancelJob} disabled={!running || !jobId}>
              <Square size={16} />
              {t("stop")}
            </button>
          </div>
        </div>

        <div className="panel resultsPanel">
          <div className="statusGrid">
            <Metric
              icon={isFollowersMode ? <Users size={19} /> : <Radar size={19} />}
              label={isFollowersMode ? t("uniqueFollowers") : t("uniqueHandles")}
              value={complete ? totalCount : running ? t("running") : t("ready")}
            />
            <Metric icon={<TerminalSquare size={19} />} label={t("session")} value={activeSessionLabel} />
          </div>

          <div className="phaseGrid">
            <PhaseCard
              title={isFollowersMode ? t("followersCapture") : t("suggestedCapture")}
              kind="capture"
              value={captureSummary(seedStats, running, complete, locale)}
              detail={captureDetail(activeCapture, complete, captureMode, locale)}
              tone={captureTone(seedStats, complete)}
            />
            <PhaseCard
              title={t("profileEnrichment")}
              kind="enrichment"
              value={enrichmentSummary(enrichProgress, complete, captureMode, enrichmentMode, locale)}
              detail={enrichmentDetail(enrichProgress, captureMode, enrichmentMode, locale)}
            />
          </div>

          <div className="sectionHeader">
            <h2>{t("seedStatus")}</h2>
            {complete && jobId ? (
              <div className="downloadGroup">
                <a className="download" href={apiUrl(`/api/jobs/${jobId}/download`)}>
                  <Download size={17} />
                  {t("txt")}
                </a>
                <a className="download excelDownload" href={apiUrl(`/api/jobs/${jobId}/download-excel`)}>
                  <Download size={17} />
                  {t("excel")}
                </a>
              </div>
            ) : (
              <span>{running ? t("capturing") : t("idle")}</span>
            )}
          </div>
          <div className="seedList">
            {Object.keys(seedStats).length ? (
              Object.entries(seedStats).map(([seed, stat]) => (
                <div className={`seedRow ${stat.status}`} key={seed}>
                  <div className="seedIdentity">
                    <span>@{seed}</span>
                    <small>{seedStatusLabel(stat, captureMode, locale)}</small>
                  </div>
                  <strong>{seedStatusValue(stat, captureMode, locale)}</strong>
                  {stat.status === "running" && stat.maxTop > 0 && (
                    <div className="scrollTrack" aria-label={`Scroll progress for ${seed}`}>
                      <span style={{ width: `${Math.min(100, Math.max(2, (stat.scrollTop / stat.maxTop) * 100))}%` }} />
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="empty">{t("seedEmpty")}</p>
            )}
          </div>

          <div className="sectionHeader logHeader">
            <h2>{t("runtimeLog")}</h2>
            <span>{logs.length}</span>
          </div>
          <div className="logBox">
            {logs.length ? (
              logs.map((log) => (
                <div className={`logLine ${log.level}`} key={log.id}>
                  {localizeLogMessage(log.message, locale)}
                </div>
              ))
            ) : (
              <p className="empty">{t("noActivity")}</p>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </section>
      {guideOpen && (
        <ConnectionGuide
          t={t}
          connectorPath={connectorInfo?.extensionDir || systemInfo?.connectorExtensionDir || ""}
          onClose={() => setGuideOpen(false)}
          onOpenConnector={() => openSystemFolder("connector")}
          onOpenExtensions={openChromeExtensions}
          onOpenInstagram={openInstagram}
          onCopy={copyGuideValue}
        />
      )}
    </main>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PhaseCard({ title, value, detail, kind = "capture", tone = "default" }) {
  return (
    <div className={`phaseCard ${tone}`}>
      <div className="phaseTitle">
        {kind === "enrichment" ? <UsersRound size={16} /> : <CheckCircle2 size={16} />}
        <span>{title}</span>
      </div>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function ConnectionGuide({ t, connectorPath, onClose, onOpenConnector, onOpenExtensions, onOpenInstagram, onCopy }) {
  const instagramUrl = "https://www.instagram.com/";
  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="guideModal" role="dialog" aria-modal="true" aria-labelledby="connection-guide-title">
        <div className="guideHeader">
          <div>
            <h2 id="connection-guide-title">{t("guideTitle")}</h2>
            <p>{t("guideIntro")}</p>
          </div>
          <button className="iconButton" onClick={onClose} title={t("close")} aria-label={t("close")}>
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="guideColumns">
          <section className="guideSection">
            <div className="guideSectionTitle"><Chrome size={18} /><h3>{t("normalChrome")}</h3></div>
            <ol className="guideSteps">
              <li>{t("stepConnectorFolder")}</li>
              <li>{t("stepExtensions")}</li>
              <li>{t("stepLoadUnpacked")}</li>
              <li>{t("stepInstagram")}</li>
              <li>{t("stepScan")}</li>
            </ol>
            <div className="guideValue">
              <span>{t("connectorPath")}</span>
              <code>{connectorPath || "-"}</code>
              <div>
                <button className="secondary compactButton" onClick={onOpenConnector}><FolderOpen size={15} />{t("connectorFolder")}</button>
                <button className="secondary compactButton" onClick={() => onCopy(connectorPath, "Connector folder path copied.")} disabled={!connectorPath}><Copy size={15} />{t("copyPath")}</button>
              </div>
            </div>
            <div className="guideValue">
              <span>{t("instagramUrl")}</span>
              <code>{instagramUrl}</code>
              <div>
                <button className="secondary compactButton" onClick={onOpenExtensions}><Chrome size={15} />{t("openExtensions")}</button>
                <button className="secondary compactButton" onClick={onOpenInstagram}><ExternalLink size={15} />{t("openInstagram")}</button>
                <button className="secondary compactButton" onClick={() => onCopy(instagramUrl, "Instagram URL copied.")}><Copy size={15} />{t("copyUrl")}</button>
              </div>
            </div>
          </section>

          <section className="guideSection">
            <div className="guideSectionTitle"><Radar size={18} /><h3>{t("fingerprintBrowser")}</h3></div>
            <ol className="guideSteps">
              <li>{t("fingerprintStep1")}</li>
              <li>{t("fingerprintStep2")}</li>
              <li>{t("fingerprintStep3")}</li>
              <li>{t("fingerprintStep4")}</li>
            </ol>
            <div className="cdpExample"><TerminalSquare size={16} /><code>{t("cdpExample")}</code></div>
          </section>
        </div>

        <div className="guideFooter">
          <button className="primary guideClose" onClick={onClose}>{t("close")}</button>
        </div>
      </section>
    </div>
  );
}

function captureSummary(seedStats, running, complete, locale) {
  const zh = locale === "zh";
  const values = Object.values(seedStats);
  if (!values.length) return running ? (zh ? "正在启动" : "Starting") : complete ? (zh ? "已完成" : "Done") : (zh ? "等待中" : "Waiting");
  const done = values.filter((item) => ["done", "limited"].includes(item.status)).length;
  const total = values.length;
  if (complete && values.some((item) => item.status === "cancelled")) return zh ? `${done}/${total} 已确认 · 已停止` : `${done}/${total} confirmed - stopped`;
  if (complete && values.some((item) => item.status === "error")) return zh ? `${done}/${total} 已确认 · 请检查失败项` : `${done}/${total} confirmed - check failures`;
  if (complete && values.some((item) => item.status === "unavailable")) return zh ? `${done}/${total} 已抓取 · 存在无权限账号` : `${done}/${total} captured - unavailable`;
  if (complete && values.some((item) => item.status === "limited")) return zh ? `${done}/${total} 已抓取 · 部分受限` : `${done}/${total} captured - limited`;
  return zh ? `${done}/${total} 个种子已确认` : `${done}/${total} seeds confirmed`;
}

function captureTone(seedStats, complete) {
  if (!complete) return "default";
  const values = Object.values(seedStats);
  if (values.some((item) => ["error", "cancelled"].includes(item.status))) return "danger";
  if (values.some((item) => ["limited", "unavailable"].includes(item.status))) return "warning";
  return values.length && values.every((item) => item.status === "done") ? "success" : "default";
}

function captureDetail(activeCapture, complete, captureMode, locale) {
  const zh = locale === "zh";
  if (activeCapture) {
    const [, stat] = activeCapture;
    const position = stat.maxTop > 0 ? `${Math.round(stat.scrollTop || 0)}/${Math.round(stat.maxTop)} px` : (zh ? "正在定位列表" : "Locating list");
    const count = captureMode === "followers" && stat.expectedCount !== null && stat.expectedCount !== undefined
      ? `${stat.count || 0}/${formatDisplayCount(stat.expectedCount)}`
      : `${stat.count || 0}`;
    if (stat.atBottom) return zh ? `${count} · ${position} · 到底确认 ${stat.bottomStable || 0}/${stat.bottomRequired || 8}` : `${count} - ${position} - bottom check ${stat.bottomStable || 0}/${stat.bottomRequired || 8}`;
    return zh ? `${count} · ${position} · 正在滚动弹窗列表` : `${count} - ${position} - scrolling inside dialog`;
  }
  return complete
    ? (zh ? "所有完成项均已通过稳定到底检查" : "Each completed seed passed the stable-bottom check")
    : (zh ? "需要在弹窗底部连续稳定检查 8 次" : "Requires 8 stable checks at the dialog bottom");
}

function seedStatusLabel(stat, captureMode, locale) {
  const zh = locale === "zh";
  if (stat.status === "done") return zh ? "已确认到底" : "Bottom confirmed";
  if (stat.status === "limited") return zh ? `受限 ${stat.count || 0}/${formatDisplayCount(stat.expectedCount)}` : `Limited ${stat.count || 0}/${formatDisplayCount(stat.expectedCount)}`;
  if (stat.status === "unavailable") return zh ? localizeLogMessage(stat.reason || "Followers unavailable", locale) : stat.reason || "Followers unavailable";
  if (stat.status === "cancelled") return zh ? "在确认到底前停止" : "Stopped before bottom";
  if (stat.status === "error") return zh ? localizeLogMessage(stat.error || "Capture failed", locale) : stat.error || "Capture failed";
  if (stat.atBottom) return zh ? `正在确认到底 ${stat.bottomStable || 0}/${stat.bottomRequired || 8}` : `Confirming bottom ${stat.bottomStable || 0}/${stat.bottomRequired || 8}`;
  if (stat.maxTop > 0) return zh ? `正在滚动 ${Math.round(stat.scrollTop || 0)}/${Math.round(stat.maxTop)} px` : `Scrolling ${Math.round(stat.scrollTop || 0)}/${Math.round(stat.maxTop)} px`;
  return captureMode === "followers" ? (zh ? "正在打开粉丝列表" : "Opening Followers") : (zh ? "正在打开查看全部" : "Opening See all");
}

function seedStatusValue(stat, captureMode, locale) {
  const zh = locale === "zh";
  if (stat.status === "error") return zh ? "失败" : "Failed";
  if (stat.status === "unavailable") return zh ? "无法查看" : "Unavailable";
  if (captureMode === "followers" && stat.expectedCount !== null && stat.expectedCount !== undefined) {
    return `${formatDisplayCount(stat.count || 0)} / ${formatDisplayCount(stat.expectedCount)}`;
  }
  return `${formatDisplayCount(stat.count || 0)} ${captureMode === "followers" ? (zh ? "个粉丝" : "followers") : (zh ? "个账号" : "handles")}`;
}

function enrichmentSummary(progress, complete, captureMode, enrichmentMode, locale) {
  const zh = locale === "zh";
  if (progress?.mode === "none") return zh ? "已跳过" : "Skipped";
  if (progress) {
    const current = progress.current || 0;
    const total = progress.total || 0;
    return `${current}/${total}${progress.handle ? ` @${progress.handle}` : ""}`;
  }
  if (complete) return zh ? "已完成" : "Done";
  if (captureMode === "followers" && enrichmentMode === "none") return zh ? "将跳过" : "Will skip";
  if (captureMode === "followers" && enrichmentMode === "first500") return zh ? "前 500 个" : "First 500";
  return zh ? "等待中" : "Waiting";
}

function enrichmentDetail(progress, captureMode, enrichmentMode, locale) {
  const zh = locale === "zh";
  if (progress?.mode === "none") return zh ? `${progress.handleTotal || 0} 行标记为未抓取` : `${progress.handleTotal || 0} row(s) marked not captured`;
  if (progress?.completed && progress.skipped) return zh ? `剩余 ${progress.skipped} 行标记为未抓取` : `${progress.skipped} remaining row(s) marked not captured`;
  if (!progress?.handle) {
    if (captureMode === "followers" && enrichmentMode === "first500") return zh ? "补充前 500 个账号的粉丝量、关注量和邮箱" : "followers - following - email for first 500";
    return zh ? "粉丝量 · 关注量 · 公开邮箱" : "followers - following - public email";
  }
  if (!progress.pageChecked) return zh ? "正在打开主页并检查“更多”" : "Opening profile and checking More";
  const bioState = progress.bioExpanded ? (zh ? "已展开更多" : "More opened") : (zh ? "简介已完整显示" : "Bio already visible");
  return `${bioState} · ${progress.contactOpened ? (zh ? "已打开联系方式" : "Contact opened") : (zh ? "已检查公开联系方式" : "public contact checked")}`;
}

function formatDisplayCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : String(value ?? "-");
}

function localizeLogMessage(value, locale = "zh") {
  let text = String(value || "").trim();
  if (!text) return "";
  if (locale !== "zh") return text;
  const replacements = [
    [/Scanning current fingerprint browser and Chrome connector sessions\.\.\./i, "正在扫描当前可控制的指纹浏览器和 Chrome Connector 会话..."],
    [/Found (.+) via Chrome Connector with logged-in Instagram tab\./i, "已发现通过 Chrome Connector 连接的 $1，Instagram 已登录。"],
    [/Found (.+) (http[^ ]+) with logged-in Instagram tab\./i, "已发现已登录 Instagram 的 $1 会话：$2。"],
    [/No live logged-in controllable Instagram session found \((\d+) candidate\(s\) hidden because IG\/login was not confirmed\)/i, "未发现已登录且可控制的 Instagram 会话；已隐藏 $1 个未确认 Instagram 登录状态的候选会话"],
    [/No live logged-in controllable Instagram session found/i, "未发现已登录且可控制的 Instagram 会话"],
    [/\. Normal Chrome is open, but Chrome does not expose control access unless the Connector is installed or Chrome was started with a debug port\./i, "。检测到普通 Chrome 正在运行，但需要安装 Connector 或通过调试端口启动后才能控制。"],
    [/Opened outputs folder: (.+)/i, "已打开输出文件夹：$1"],
    [/Opened logs folder: (.+)/i, "已打开日志文件夹：$1"],
    [/Opened connector folder: (.+)/i, "已打开 Connector 文件夹：$1"],
    [/Opened chrome:\/\/extensions\. Enable Developer mode, then Load unpacked\./i, "已打开 Chrome 扩展程序页面。请开启“开发者模式”，然后点击“加载已解压的扩展程序”。"],
    [/Opened Instagram in the default browser\./i, "已在默认浏览器中打开 Instagram。"],
    [/Connector folder path copied\./i, "Connector 文件夹路径已复制。"],
    [/Instagram URL copied\./i, "Instagram 链接已复制。"],
    [/Could not copy to the clipboard\./i, "无法复制到剪贴板。"],
    [/Enter at least one Instagram handle\./i, "请至少输入一个 Instagram handle。"],
    [/Choose a live browser session or enter a Manual CDP URL\./i, "请选择一个在线浏览器会话，或输入手动 CDP 地址。"],
    [/Followers job started for (\d+) seed account\(s\)\./i, "粉丝列表任务已启动，共 $1 个种子账号。"],
    [/Suggested job started for (\d+) seed account\(s\)\./i, "推荐账号任务已启动，共 $1 个种子账号。"],
    [/Opening @(\S+) \((\d+)\/(\d+)\)/i, "正在打开 @$1（$2/$3）"],
    [/@(\S+): (\d+) follower\(s\), full bottom confirmed\./i, "@$1：已抓取 $2 个粉丝，列表已确认到底。"],
    [/@(\S+): (\d+) handle\(s\), full bottom confirmed\./i, "@$1：已抓取 $2 个推荐账号，列表已确认到底。"],
    [/@(\S+): follower dialog bottom confirmed, but Instagram exposed (\d+)\/(\d+)\./i, "@$1：粉丝列表已确认到底，但 Instagram 仅开放 $2/$3 个账号。"],
    [/@(\S+): followers unavailable\. /i, "@$1：当前会话无法查看粉丝列表。"],
    [/@(\S+): stopped before full-bottom confirmation\./i, "@$1：在确认列表到底前已停止，临时结果未导出。"],
    [/Profile enrichment skipped; (\d+) Excel row\(s\) will be marked as not captured\./i, "已跳过账号资料补充；Excel 中 $1 行将标记为“未抓取”。"],
    [/Profile enrichment started for (\d+) of (\d+) handle\(s\)\./i, "开始补充账号资料：本次处理 $1/$2 个账号。"],
    [/TXT ready: (\d+) unique handle\(s\)\./i, "TXT 和 Excel 已生成，共 $1 个去重 handle。"],
    [/Event stream disconnected\./i, "实时日志连接已断开。"],
    [/Starting (\d+) seed account\(s\) in Followers mode with (.+)\./i, "正在通过 $2 处理 $1 个种子账号，模式：粉丝列表。"],
    [/Starting (\d+) seed account\(s\) in Suggested mode with (.+)\./i, "正在通过 $2 处理 $1 个种子账号，模式：推荐账号。"],
    [/Profile page fallback for @(\S+):/i, "@$1：资料页面读取失败，继续尝试接口读取："],
    [/Profile API fallback for @(\S+):/i, "@$1：资料接口读取失败，使用页面可见结果："],
    [/@(\S+) See all bottom fully confirmed \((\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\) after (\d+) stable checks\./i, "@$1：推荐列表已确认到底（$2/$3），连续稳定检查 $4 次。"],
    [/@(\S+) follower dialog bottom fully confirmed \((\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\) after (\d+) stable checks\./i, "@$1：粉丝列表已确认到底（$2/$3），连续稳定检查 $4 次。"],
    [/@(\S+) follower dialog bottom confirmed, but the visible list is limited to (\d+)\/(\d+)\./i, "@$1：粉丝列表已到底，但 Instagram 仅开放 $2/$3 个账号。"],
    [/@(\S+) has 0 visible followers\./i, "@$1：当前显示粉丝数为 0。"],
    [/@(\S+) stopped by user before bottom confirmation with (\d+) handle\(s\)\./i, "@$1：用户在确认到底前停止，$2 个临时账号未导出。"],
    [/@(\S+) stopped before follower-list bottom confirmation with (\d+) temporary handle\(s\)\. No partial result was accepted\./i, "@$1：用户在确认粉丝列表到底前停止，$2 个临时账号未导出。"],
    [/Instagram login expired\. Log in again, then scan the browser session\./i, "Instagram 登录已失效，请重新登录后扫描浏览器。"],
    [/Instagram challenge or checkpoint is blocking this profile\./i, "Instagram 身份验证或检查点阻止了当前账号页面。"],
    [/Instagram rate limit is blocking the follower list\. Try again later\./i, "Instagram 触发了访问频率限制，请稍后再试。"],
    [/Instagram profile was not found or is unavailable\./i, "Instagram 账号不存在或当前不可访问。"],
    [/Current Instagram session cannot view this private or restricted follower list\./i, "当前 Instagram 会话无权查看该私密或受限粉丝列表。"],
    [/Current Instagram session cannot view or load this follower list\./i, "当前 Instagram 会话无法查看或加载该粉丝列表。"],
    [/Current Instagram session cannot view this follower list\./i, "当前 Instagram 会话无法查看该粉丝列表。"],
    [/Followers link was not found\./i, "未找到粉丝列表入口。"],
    [/Followers dialog did not open\./i, "粉丝列表弹窗未能打开。"],
    [/Followers dialog closed before the full list was captured\./i, "粉丝列表尚未抓取完成，弹窗已关闭。"],
    [/Followers list could not reach the bottom \(([^)]+)\)\. No partial result was accepted\./i, "粉丝列表无法滚动到底（$1），临时结果未导出。"],
    [/Followers list did not pass full-bottom confirmation \(([^)]+)\)\. No partial result was accepted\./i, "粉丝列表未通过完整到底确认（$1），临时结果未导出。"],
    [/Similar accounts button was not found\./i, "未找到相似账号按钮。"],
    [/See all button was not found after opening suggestions\./i, "打开推荐区域后未找到“查看全部”按钮。"],
    [/Suggested for you dialog closed before the full list was captured\./i, "推荐列表尚未抓取完成，弹窗已关闭。"],
    [/See all list could not reach the bottom \(([^)]+)\)\. No partial result was accepted\./i, "推荐列表无法滚动到底（$1），临时结果未导出。"],
    [/See all list did not pass full-bottom confirmation \(([^)]+)\)\. No partial result was accepted\./i, "推荐列表未通过完整到底确认（$1），临时结果未导出。"],
    [/Chrome connector is no longer connected\. Click Scan and choose the Chrome tab again\./i, "Chrome Connector 已断开，请点击“扫描”并重新选择 Chrome 标签页。"],
    [/Chrome connector is not connected\./i, "Chrome Connector 尚未连接。"],
    [/Could not open Instagram tab for profile enrichment\./i, "无法打开用于补充账号资料的 Instagram 标签页。"],
    [/Could not open Instagram tab for ([^.]*)\./i, "无法为 $1 打开 Instagram 标签页。"],
    [/No user in profile response/i, "账号资料接口没有返回用户数据"],
    [/Runtime\.evaluate failed/i, "浏览器页面脚本执行失败"],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text;
}

function normalizeHandles(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\s,;\uFF0C\uFF1B]+/)
        .map((item) =>
          item
            .trim()
            .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
            .replace(/^@/, "")
            .split(/[/?#]/)[0]
            .toLowerCase()
        )
        .filter(Boolean)
    ),
  ];
}

async function apiGet(url) {
  const response = await fetch(apiUrl(url), { headers: apiHeaders() });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function apiPost(url, body) {
  const response = await fetch(apiUrl(url), {
    method: "POST",
    headers: { ...apiHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function apiHeaders() {
  return appToken ? { "X-App-Token": appToken } : {};
}

function apiUrl(value) {
  const url = new URL(value, window.location.origin);
  if (appToken) url.searchParams.set("token", appToken);
  return `${url.pathname}${url.search}`;
}

createRoot(document.getElementById("root")).render(<App />);
