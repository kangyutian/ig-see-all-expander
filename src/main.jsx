import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  CheckCircle2,
  Chrome,
  Download,
  FolderOpen,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  ScrollText,
  Square,
  TerminalSquare,
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

function App() {
  const [handlesText, setHandlesText] = useState("");
  const [outputName, setOutputName] = useState("");
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

  const normalizedPreview = useMemo(() => normalizeHandles(handlesText), [handlesText]);
  const selectedBrowser = browsers.find((browser) => browser.sessionId === selectedSessionId);
  const activeSessionLabel = manualCdpUrl.trim() || selectedBrowser?.currentUrl || selectedBrowser?.cdpUrl || "Not selected";
  const activeCapture = Object.entries(seedStats).find(([, stat]) => stat.status === "running");

  useEffect(() => {
    loadSystemInfo();
    loadConnectorInfo();
    discoverBrowsers();
    return () => eventSourceRef.current?.close();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logs]);

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
      addLog(`Job started for ${data.seeds?.length || 0} seed account(s).`, "info");
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse(event.data);
      addLog(data.message, data.level || "info");
    });
    source.addEventListener("seed:start", (event) => {
      const data = JSON.parse(event.data);
      setSeedStats((prev) => ({ ...prev, [data.seed]: { status: "running", count: 0 } }));
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
        [data.seed]: { ...(prev[data.seed] || {}), status: "done", count: data.count, bottomConfirmed: true },
      }));
      addLog(`@${data.seed}: ${data.count} handle(s), full bottom confirmed.`, "success");
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
      setEnrichProgress({ current: 0, total: data.total || 0, handle: "" });
      addLog(`Profile enrichment started for ${data.total || 0} handle(s).`, "info");
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

  return (
    <main className="shell">
      <section className="toolbar">
        <div>
          <h1>IG See All Expander</h1>
          <p>Live browser scan - full-bottom capture - profile enrichment</p>
        </div>
        <div className="toolbarActions">
          {systemInfo && <span className="versionBadge">v{systemInfo.version} - {systemInfo.mode}</span>}
          <button className="iconButton" onClick={() => openSystemFolder("outputs")} title="Open output folder">
            <FolderOpen size={18} />
          </button>
          <button className="iconButton" onClick={() => openSystemFolder("logs")} title="Open log folder">
            <ScrollText size={18} />
          </button>
          <button className="iconButton" onClick={() => openSystemFolder("connector")} title="Open Chrome connector folder">
            <Chrome size={18} />
          </button>
          <button className="iconButton" onClick={discoverBrowsers} disabled={discovering} title="Scan browser sessions">
            {discovering ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
      </section>

      <section className="layout">
        <div className="panel inputPanel">
          <div className="sectionHeader">
            <h2>Seeds</h2>
            <span>{normalizedPreview.length} account(s)</span>
          </div>
          <textarea
            value={handlesText}
            onChange={(event) => setHandlesText(event.target.value)}
            spellCheck={false}
            placeholder={sampleHandles}
          />
          <div className="fieldRow">
            <label>
              Output name
              <input
                value={outputName}
                onChange={(event) => setOutputName(event.target.value)}
                placeholder="ig-see-all-handles"
              />
            </label>
          </div>

          <div className="sectionHeader browserHeader">
            <h2>Browser</h2>
            <span>{browsers.length} found</span>
          </div>
          <div className="browserActions">
            <button className="secondary compactButton" onClick={discoverBrowsers} disabled={discovering}>
              {discovering ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              Scan
            </button>
            <button className="secondary compactButton chromeButton" onClick={() => openSystemFolder("connector")}>
              <FolderOpen size={16} />
              Connector folder
            </button>
            <button className="secondary compactButton chromeButton" onClick={openChromeExtensions}>
              <Chrome size={16} />
              Chrome extensions
            </button>
          </div>
          <div className="connectorHint">
            <strong>Chrome Connector</strong>
            <span>
              {connectorInfo?.connectedClients
                ? `${connectorInfo.connectedClients} Chrome connector(s) online.`
                : "Normal Chrome cannot be controlled directly. Load this Connector once to reuse your existing logged-in Instagram tab."}
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
                    <em>{browser.source === "chrome-connector" ? "Chrome Connector" : browser.browserType || "Browser"}</em>
                    {browser.source === "chrome-connector" ? browser.currentUrl : browser.cdpUrl}
                  </strong>
                  <small>{browser.currentUrl || browser.userDataDir || browser.browserName || browser.source}</small>
                  <small className="browserMeta">
                    {browser.instagramTabs?.length ? `${browser.instagramTabs.length} Instagram tab(s)` : "No Instagram tab"}
                    {" - "}
                    {browser.hasSessionCookie ? "Session cookie detected" : browser.loginLikely ? "Logged in likely" : "Login not confirmed"}
                  </small>
                </span>
                {browser.loginLikely ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
              </label>
            ))}
            {!browsers.length && <p className="empty">Open a logged-in Instagram tab in a detectable fingerprint browser. For normal Chrome, load the Connector once, then Scan.</p>}
          </div>
          <label className="manualField">
            Manual CDP URL
            <input value={manualCdpUrl} onChange={(event) => setManualCdpUrl(event.target.value)} placeholder="http://127.0.0.1:65229" />
          </label>

          <div className="actions">
            <button className="primary" onClick={startJob} disabled={running}>
              {running ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              Start
            </button>
            <button className="secondary" onClick={cancelJob} disabled={!running || !jobId}>
              <Square size={16} />
              Stop
            </button>
          </div>
        </div>

        <div className="panel resultsPanel">
          <div className="statusGrid">
            <Metric icon={<Radar size={19} />} label="Unique handles" value={complete ? totalCount : running ? "Running" : "Ready"} />
            <Metric icon={<TerminalSquare size={19} />} label="Session" value={activeSessionLabel} />
          </div>

          <div className="phaseGrid">
            <PhaseCard
              title="See all capture"
              value={captureSummary(seedStats, running, complete)}
              detail={captureDetail(activeCapture, complete)}
              tone={complete && Object.values(seedStats).every((stat) => stat.status === "done") ? "success" : "default"}
            />
            <PhaseCard
              title="Profile enrichment"
              value={
                enrichProgress
                  ? `${enrichProgress.current}/${enrichProgress.total}${enrichProgress.handle ? ` @${enrichProgress.handle}` : ""}`
                  : complete
                    ? "Done"
                    : "Waiting"
              }
              detail={enrichmentDetail(enrichProgress)}
            />
          </div>

          <div className="sectionHeader">
            <h2>Seed Status</h2>
            {complete && jobId ? (
              <div className="downloadGroup">
                <a className="download" href={apiUrl(`/api/jobs/${jobId}/download`)}>
                  <Download size={17} />
                  TXT
                </a>
                <a className="download excelDownload" href={apiUrl(`/api/jobs/${jobId}/download-excel`)}>
                  <Download size={17} />
                  Excel
                </a>
              </div>
            ) : (
              <span>{running ? "Capturing" : "Idle"}</span>
            )}
          </div>
          <div className="seedList">
            {Object.keys(seedStats).length ? (
              Object.entries(seedStats).map(([seed, stat]) => (
                <div className={`seedRow ${stat.status}`} key={seed}>
                  <div className="seedIdentity">
                    <span>@{seed}</span>
                    <small>{seedStatusLabel(stat)}</small>
                  </div>
                  <strong>{stat.status === "error" ? "Failed" : `${stat.count || 0} handles`}</strong>
                  {stat.status === "running" && stat.maxTop > 0 && (
                    <div className="scrollTrack" aria-label={`Scroll progress for ${seed}`}>
                      <span style={{ width: `${Math.min(100, Math.max(2, (stat.scrollTop / stat.maxTop) * 100))}%` }} />
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="empty">Run a batch to see per-account counts.</p>
            )}
          </div>

          <div className="sectionHeader logHeader">
            <h2>Log</h2>
            <span>{logs.length}</span>
          </div>
          <div className="logBox">
            {logs.length ? (
              logs.map((log) => (
                <div className={`logLine ${log.level}`} key={log.id}>
                  {log.message}
                </div>
              ))
            ) : (
              <p className="empty">No activity yet.</p>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </section>
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

function PhaseCard({ title, value, detail, tone = "default" }) {
  return (
    <div className={`phaseCard ${tone}`}>
      <div className="phaseTitle">
        {title === "Profile enrichment" ? <UsersRound size={16} /> : <CheckCircle2 size={16} />}
        <span>{title}</span>
      </div>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function captureSummary(seedStats, running, complete) {
  const values = Object.values(seedStats);
  if (!values.length) return running ? "Starting" : complete ? "Done" : "Waiting";
  const done = values.filter((item) => item.status === "done").length;
  const total = values.length;
  if (complete && values.some((item) => item.status === "cancelled")) return `${done}/${total} confirmed - stopped`;
  if (complete && values.some((item) => item.status === "error")) return `${done}/${total} confirmed - check failures`;
  return `${done}/${total} seeds confirmed`;
}

function captureDetail(activeCapture, complete) {
  if (activeCapture) {
    const [, stat] = activeCapture;
    const position = stat.maxTop > 0 ? `${Math.round(stat.scrollTop || 0)}/${Math.round(stat.maxTop)} px` : "Locating list";
    if (stat.atBottom) return `${position} - bottom check ${stat.bottomStable || 0}/${stat.bottomRequired || 8}`;
    return `${position} - scrolling inside dialog`;
  }
  return complete ? "Each completed seed passed the stable-bottom check" : "Requires 8 stable checks at the dialog bottom";
}

function seedStatusLabel(stat) {
  if (stat.status === "done") return "Bottom confirmed";
  if (stat.status === "cancelled") return "Stopped before bottom";
  if (stat.status === "error") return stat.error || "Capture failed";
  if (stat.atBottom) return `Confirming bottom ${stat.bottomStable || 0}/${stat.bottomRequired || 8}`;
  if (stat.maxTop > 0) return `Scrolling ${Math.round(stat.scrollTop || 0)}/${Math.round(stat.maxTop)} px`;
  return "Opening See all";
}

function enrichmentDetail(progress) {
  if (!progress?.handle) return "followers - following - public email";
  if (!progress.pageChecked) return "Opening profile and checking More";
  const bioState = progress.bioExpanded ? "More opened" : "Bio already visible";
  return `${bioState} - ${progress.contactOpened ? "Contact opened" : "public contact checked"}`;
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
