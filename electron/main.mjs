import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { createAccessToken, startLocalServer } from "../server/index.mjs";

const productName = "IG See All Expander";
const localAppData = process.env.LOCALAPPDATA || app.getPath("appData");
const dataDir = path.join(localAppData, productName);
const outputDir = path.join(dataDir, "outputs");
const chromeProfileDir = path.join(dataDir, "chrome-profile");
const logDir = path.join(dataDir, "logs");
const configPath = path.join(dataDir, "config.json");

fs.mkdirSync(dataDir, { recursive: true });
app.setPath("userData", dataDir);
app.setAppUserModelId("com.kangyutian.igseeallexpander");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;
let localService = null;
let quitting = false;

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktopApp).catch(handleFatalError);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && localService) createMainWindow(localService);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (!localService || quitting) return;
    event.preventDefault();
    quitting = true;
    localService
      .close()
      .catch((error) => writeDesktopLog("error", error?.stack || error))
      .finally(() => app.quit());
  });
}

async function startDesktopApp() {
  ensureConfig();
  const token = createAccessToken();
  localService = await startLocalServer({
    distDir: path.join(app.getAppPath(), "dist"),
    dataDir,
    outputDir,
    chromeProfileDir,
    logDir,
    host: "127.0.0.1",
    port: 0,
    token,
    mode: "desktop",
    version: app.getVersion(),
    openPath: (targetPath) => shell.openPath(targetPath),
  });
  createApplicationMenu();
  createMainWindow(localService);
  writeDesktopLog("info", `${productName} ${app.getVersion()} started.`);
}

function createMainWindow(service) {
  const appUrl = new URL(service.url);
  appUrl.searchParams.set("token", service.token);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#f6f7f9",
    title: productName,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const target = new URL(targetUrl);
    if (target.origin === service.url) return;
    event.preventDefault();
    if (/^https?:$/i.test(target.protocol)) shell.openExternal(targetUrl).catch(() => {});
  });
  mainWindow.loadURL(appUrl.toString());
}

function createApplicationMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        { label: "Open output folder", click: () => shell.openPath(outputDir) },
        { label: "Open log folder", click: () => shell.openPath(logDir) },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: `About ${productName}`,
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: `About ${productName}`,
              message: productName,
              detail: `Version ${app.getVersion()}\n\nLocal data:\n${dataDir}`,
              buttons: ["OK"],
            }),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function ensureConfig() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(chromeProfileDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    config = { schemaVersion: 1, createdAt: new Date().toISOString() };
  }
  config.schemaVersion = 1;
  config.lastVersion = app.getVersion();
  config.lastStartedAt = new Date().toISOString();
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function handleFatalError(error) {
  writeDesktopLog("error", error?.stack || error);
  dialog
    .showMessageBox({
      type: "error",
      title: `${productName} could not start`,
      message: "The desktop app could not start.",
      detail: `${String(error?.message || error)}\n\nLog folder:\n${logDir}`,
      buttons: ["Open logs", "Close"],
    })
    .then(({ response }) => {
      if (response === 0) shell.openPath(logDir).catch(() => {});
      app.quit();
    });
}

function writeDesktopLog(level, message) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "desktop.log"), `[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${String(message)}\n`, "utf8");
  } catch {
    // The startup error dialog is still useful when disk logging is unavailable.
  }
}
