import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startLocalServer } from "../server/index.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error("LOCALAPPDATA is required for the live smoke test.");

const dataDir = path.join(localAppData, "IG See All Expander");
const token = "ig-see-all-live-smoke";
const seed = String(process.argv[2] || "richardg.us").replace(/^@/, "");
const service = await startLocalServer({
  distDir: path.join(rootDir, "dist"),
  dataDir,
  outputDir: path.join(dataDir, "outputs"),
  chromeProfileDir: path.join(dataDir, "chrome-profile"),
  logDir: path.join(dataDir, "logs"),
  host: "127.0.0.1",
  port: 0,
  token,
  mode: "live-smoke",
});

const headers = { authorization: `Bearer ${token}` };

try {
  const chromeCandidates = [
    path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  const chromeExe = chromeCandidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (chromeExe) execFile(chromeExe, [`https://www.instagram.com/${seed}/`], () => {});

  let sessions = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await fetch(`${service.url}/api/browser/discover`, { headers });
    const data = await response.json();
    sessions = Array.isArray(data.browsers) ? data.browsers : [];
    if (sessions.some((item) => item.source === "chrome-connector")) break;
  }

  const session = sessions.find((item) => item.source === "chrome-connector" && item.loginLikely);
  if (!session) throw new Error("No logged-in Chrome Connector session was discovered.");

  const expandResponse = await fetch(`${service.url}/api/expand`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ handlesText: seed, sessionId: session.sessionId, outputName: `live-smoke-${seed}` }),
  });
  const expandData = await expandResponse.json();
  if (!expandResponse.ok) throw new Error(expandData.error || "Could not start live smoke job.");

  const eventsResponse = await fetch(`${service.url}/api/jobs/${expandData.jobId}/events?token=${encodeURIComponent(token)}`);
  if (!eventsResponse.ok || !eventsResponse.body) throw new Error("Could not open live smoke event stream.");
  const decoder = new TextDecoder();
  let buffered = "";
  let completed = false;
  for await (const chunk of eventsResponse.body) {
    buffered += decoder.decode(chunk, { stream: true });
    const blocks = buffered.split("\n\n");
    buffered = blocks.pop() || "";
    for (const block of blocks) {
      const event = block.match(/^event:\s*(.+)$/m)?.[1];
      const rawData = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !rawData) continue;
      const data = JSON.parse(rawData);
      if (["log", "seed:error", "seed:done", "done", "error"].includes(event)) {
        console.log(`[${event}]`, data.message || data.error || JSON.stringify(data));
      }
      if (event === "done") {
        completed = true;
        if (!data.count) process.exitCode = 2;
        break;
      }
      if (event === "error") throw new Error(data.error || "Live smoke job failed.");
    }
    if (completed) break;
  }
  if (!completed) throw new Error("Live smoke job ended without a completion event.");
} finally {
  await service.close();
}
