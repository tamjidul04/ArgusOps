import path from "node:path";
import { app, BrowserWindow, Menu, nativeImage, session, Tray } from "electron";
import { Store } from "../../core/src/store";
import { agentsNeedingYou, ensureEngine, type Engine } from "./engine";

/**
 * The ArgusOps desktop app: a window and a tray icon around the local engine. The window shows the app's own screens
 * and can reach nothing else: no Node in the page, no other sites, no new windows. No browser is involved.
 */

const VERSION = "0.6.0";
let engine: Engine | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

/** An evergreen dot, drawn in code so the app needs no image files. */
function icon(size: number) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const o = (y * size + x) * 4;
      const a = d <= size * 0.46 ? 255 : d <= size * 0.5 ? Math.round(255 * (size * 0.5 - d) / (size * 0.04)) : 0;
      buf[o] = 0x37; // B
      buf[o + 1] = 0x3d; // G
      buf[o + 2] = 0x1f; // R
      buf[o + 3] = Math.max(0, Math.min(255, a));
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function show() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  if (!engine) return;
  const origin = new URL(engine.url).origin;
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    title: "ArgusOps",
    icon: icon(64),
    autoHideMenuBar: true,
    show: !process.env.ARGUSOPS_DESKTOP_SMOKE,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== origin) e.preventDefault();
  });
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault(); // keep watching from the tray
      win?.hide();
    }
  });
  void win.loadURL(engine.openUrl);
  return win;
}

function refreshTray() {
  if (!tray) return;
  const n = agentsNeedingYou(new Store());
  tray.setToolTip(n ? `ArgusOps: ${n} agent${n === 1 ? "" : "s"} waiting for you` : "ArgusOps: all quiet");
}

async function smoke() {
  // used by the test: load the page, report what it shows, quit
  const w = win;
  if (!w) return app.exit(2);
  await new Promise<void>((r) => w.webContents.once("did-finish-load", () => r()));
  await new Promise((r) => setTimeout(r, 2500));
  const info = await w.webContents.executeJavaScript(`JSON.stringify({ title: document.title, conn: document.getElementById("conn").textContent, sections: document.querySelectorAll("#side-top [data-page]").length, text: document.getElementById("main").textContent.slice(0, 600), node: typeof require, process: typeof process, url: location.href })`);
  process.stdout.write(`SMOKE ${info}\n`);
  quitting = true;
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => show());
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => {
    /* stay in the tray */
  });
  app.on("will-quit", () => {
    void engine?.close();
  });

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    const store = new Store();
    try {
      engine = await ensureEngine(store, { uiDir: path.join(__dirname, "ui"), version: VERSION });
    } catch (e) {
      const { dialog } = await import("electron");
      dialog.showErrorBox("ArgusOps could not start", e instanceof Error ? e.message : String(e));
      return app.exit(2);
    }
    createWindow();
    tray = new Tray(icon(32));
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open ArgusOps", click: show }, { type: "separator" }, { label: "Quit", click: () => app.quit() }]));
    tray.on("click", show);
    refreshTray();
    setInterval(refreshTray, 3000).unref();
    if (process.env.ARGUSOPS_DESKTOP_SMOKE) void smoke();
  });
}
