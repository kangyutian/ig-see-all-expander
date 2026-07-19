import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createBottomConfirmationState,
  isOpenConnectorClient,
  startLocalServer,
  updateBottomConfirmation,
  writeExcel,
} from "./index.mjs";
import ExcelJS from "exceljs";

test("an open Chrome Connector does not expire only because its last heartbeat is old", () => {
  assert.equal(isOpenConnectorClient({ ws: { readyState: 1 }, lastSeen: Date.now() - 120_000 }), true);
  assert.equal(isOpenConnectorClient({ ws: { readyState: 3 }, lastSeen: Date.now() }), false);
});

test("See all completion requires eight stable checks at the real bottom", () => {
  let state = createBottomConfirmationState();
  const bottom = { changed: false, atBottom: true, scrollTop: 800, scrollHeight: 1200, clientHeight: 400 };

  for (let round = 0; round < 8; round += 1) {
    state = updateBottomConfirmation(state, bottom, 50);
    assert.equal(state.complete, false);
  }

  state = updateBottomConfirmation(state, bottom, 50);
  assert.equal(state.stableBottomRounds, 8);
  assert.equal(state.complete, true);
});

test("See all bottom confirmation resets when lazy loading changes height or handles", () => {
  let state = createBottomConfirmationState();
  const firstBottom = { changed: false, atBottom: true, scrollTop: 800, scrollHeight: 1200, clientHeight: 400 };
  for (let round = 0; round < 5; round += 1) state = updateBottomConfirmation(state, firstBottom, 50);
  assert.equal(state.stableBottomRounds, 4);

  const expandedBottom = { changed: true, atBottom: true, scrollTop: 1200, scrollHeight: 1600, clientHeight: 400 };
  state = updateBottomConfirmation(state, expandedBottom, 60);
  assert.equal(state.stableBottomRounds, 0);
  assert.equal(state.complete, false);
});

test("Excel export contains handle, followers, following, and email", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ig-see-all-excel-test-"));
  const filePath = path.join(dataDir, "handles.xlsx");
  try {
    await writeExcel(filePath, [{ handle: "sample", followers: 1234, following: 87, email: "hello@example.com" }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.getWorksheet("handles");
    assert.deepEqual(sheet.getRow(1).values.slice(1), ["handle", "followers", "following", "email"]);
    assert.deepEqual(sheet.getRow(2).values.slice(1), ["sample", 1234, 87, "hello@example.com"]);
    assert.equal(sheet.autoFilter, "A1:D1");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("local server protects APIs and exposes desktop system paths", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ig-see-all-test-"));
  const openedPaths = [];
  const service = await startLocalServer({
    dataDir,
    distDir: path.resolve("dist"),
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    mode: "test",
    version: "9.9.9",
    openPath: async (targetPath) => {
      openedPaths.push(targetPath);
      return "";
    },
  });

  context.after(async () => {
    await service.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const unauthorized = await fetch(`${service.url}/api/system/info`);
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${service.url}/api/system/info`, {
    headers: { "X-App-Token": "test-token" },
  });
  assert.equal(authorized.status, 200);
  const info = await authorized.json();
  assert.equal(info.version, "9.9.9");
  assert.equal(info.mode, "test");
  assert.equal(info.dataDir, dataDir);
  assert.equal(info.outputDir, path.join(dataDir, "outputs"));
  assert.equal(info.connectorExtensionDir, path.join(dataDir, "chrome-connector"));
  assert.ok(fs.existsSync(path.join(info.connectorExtensionDir, "manifest.json")));
  assert.ok(fs.existsSync(path.join(info.connectorExtensionDir, "content.js")));
  const connectorManifest = JSON.parse(fs.readFileSync(path.join(info.connectorExtensionDir, "manifest.json"), "utf8"));
  assert.deepEqual(connectorManifest.content_scripts?.[0]?.matches, ["https://www.instagram.com/*"]);
  const connectorBackground = fs.readFileSync(path.join(info.connectorExtensionDir, "background.js"), "utf8");
  assert.match(connectorBackground, /setInterval\(\(\) => sendHello\("heartbeat"\), 5000\)/);
  const connectorContent = fs.readFileSync(path.join(info.connectorExtensionDir, "content.js"), "utf8");
  assert.match(connectorContent, /ig-see-all-wake/);

  const connectorInfo = await fetch(`${service.url}/api/browser/connector-info`, {
    headers: { "X-App-Token": "test-token" },
  });
  assert.equal(connectorInfo.status, 200);
  const connector = await connectorInfo.json();
  assert.equal(connector.extensionDir, path.join(dataDir, "chrome-connector"));
  assert.ok(connector.port >= 47620);

  const openOutputs = await fetch(`${service.url}/api/system/open-outputs?token=test-token`, { method: "POST" });
  assert.equal(openOutputs.status, 200);
  const openConnector = await fetch(`${service.url}/api/system/open-connector?token=test-token`, { method: "POST" });
  assert.equal(openConnector.status, 200);
  assert.deepEqual(openedPaths, [path.join(dataDir, "outputs"), path.join(dataDir, "chrome-connector")]);

  const staticPage = await fetch(`${service.url}/`);
  assert.equal(staticPage.status, 200);
  assert.match(await staticPage.text(), /IG See All Expander/i);
});
