import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } from "electron";
import { AppController } from "./src/main/app-controller.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let controller = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let dockEdge = null;
let suppressDockEvent = false;
let normalWidth = 360;

const WINDOW_DEFAULTS = {
  width: 360,
  height: 540,
  minWidth: 220,
  minHeight: 280
};
const WINDOW_MAX_WIDTH = 520;
const DOCKED_WIDTH = 168;
const SNAP_THRESHOLD = 20;
const UNDOCK_THRESHOLD = 80;

// Load icon from icon.png in project root.
// Put your own icon.png there — falls back to empty if missing.
const ICON_PATH = path.join(__dirname, "icon.png");
const APP_ICON = existsSync(ICON_PATH)
  ? nativeImage.createFromPath(ICON_PATH)
  : nativeImage.createEmpty();

async function createController() {
  controller = await AppController.create(app.getPath("userData"));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_DEFAULTS.width,
    height: WINDOW_DEFAULTS.height,
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    frame: false,
    transparent: true,
    hasShadow: false,
    titleBarStyle: "hidden",
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    autoHideMenuBar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: true,
    title: "I'm back",
    icon: APP_ICON, // Set taskbar icon
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "src/renderer/index.html"));

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("move", () => {
    handleWindowSnap();
  });
}

function emitDockState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("ui:dock-state", {
    docked: Boolean(dockEdge),
    edge: dockEdge
  });
}

function handleWindowSnap() {
  if (!mainWindow || suppressDockEvent) {
    return;
  }
  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const distanceLeft = Math.abs(bounds.x - workArea.x);
  const rightEdge = workArea.x + workArea.width;
  const distanceRight = Math.abs(rightEdge - (bounds.x + bounds.width));
  const nearLeft = distanceLeft <= SNAP_THRESHOLD;
  const nearRight = distanceRight <= SNAP_THRESHOLD;

  if (!dockEdge && (nearLeft || nearRight)) {
    dockWindow(nearLeft ? "left" : "right", workArea, bounds);
    return;
  }

  if (!dockEdge) {
    return;
  }

  const insideBand =
    bounds.x > workArea.x + UNDOCK_THRESHOLD &&
    bounds.x + bounds.width < workArea.x + workArea.width - UNDOCK_THRESHOLD;
  if (insideBand) {
    undockWindow(workArea, bounds);
  }
}

function dockWindow(edge, workArea, currentBounds) {
  if (!mainWindow) {
    return;
  }
  suppressDockEvent = true;
  if (!dockEdge) {
    normalWidth = Math.max(WINDOW_DEFAULTS.width, Math.min(currentBounds.width, WINDOW_MAX_WIDTH));
  }
  const nextX = edge === "left" ? workArea.x : workArea.x + workArea.width - DOCKED_WIDTH;
  mainWindow.setBounds({
    x: nextX,
    y: Math.max(workArea.y, currentBounds.y),
    width: DOCKED_WIDTH,
    height: Math.min(currentBounds.height, workArea.height)
  });
  dockEdge = edge;
  emitDockState();
  setTimeout(() => {
    suppressDockEvent = false;
  }, 10);
}

function undockWindow(workArea, currentBounds) {
  if (!mainWindow) {
    return;
  }
  suppressDockEvent = true;
  const width = Math.max(WINDOW_DEFAULTS.width, Math.min(normalWidth, WINDOW_MAX_WIDTH));
  const maxX = workArea.x + workArea.width - width;
  const nextX = Math.max(workArea.x, Math.min(currentBounds.x, maxX));
  mainWindow.setBounds({
    x: nextX,
    y: currentBounds.y,
    width,
    height: currentBounds.height
  });
  dockEdge = null;
  emitDockState();
  setTimeout(() => {
    suppressDockEvent = false;
  }, 10);
}

function createTray() {
  if (tray) {
    return;
  }
  tray = new Tray(APP_ICON); // Use the same icon for tray
  tray.setToolTip("I'm back");

  const template = [
    {
      label: "显示 / 隐藏主窗口",
      click: () => {
        if (!mainWindow) {
          return;
        }
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.setIgnoreMouseEvents(false);
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: "置顶 / 取消置顶",
      click: () => {
        if (!mainWindow) {
          return;
        }
        const next = !mainWindow.isAlwaysOnTop();
        mainWindow.setAlwaysOnTop(next);
      }
    },
    {
      label: "贴边 / 还原 (吸附)",
      click: () => {
        if (!mainWindow) {
          return;
        }
        const bounds = mainWindow.getBounds();
        const workArea = screen.getDisplayMatching(bounds).workArea;
        if (dockEdge) {
          undockWindow(workArea, bounds);
        } else {
          dockWindow("right", workArea, bounds);
        }
      }
    },
    {
      label: "显示 / 隐藏历史记录",
      click: () => {
        if (!mainWindow) {
          return;
        }
        mainWindow.setIgnoreMouseEvents(false);
        mainWindow.show();
        mainWindow.webContents.send("ui:toggle-history");
      }
    },
    {
      label: "💾 保存当前内容（下次继续）",
      click: async () => {
        if (!controller) {
          return;
        }
        await controller.saveSession();
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: async () => {
        isQuitting = true;
        if (controller) {
          await controller.shutdown();
        }
        app.quit();
      }
    }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));

  tray.on("double-click", () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.show();
    mainWindow.focus();
  });
}

function setupIpc() {
  ipcMain.handle("tree:getState", async () => controller.getState());
  ipcMain.handle("tree:addChild", async (_event, parentId, title) => controller.addChild(parentId, title));
  ipcMain.handle("tree:addSibling", async (_event, nodeId, title) => controller.addSibling(nodeId, title));
  ipcMain.handle("tree:renameNode", async (_event, nodeId, title) => controller.renameNode(nodeId, title));
  ipcMain.handle("tree:focusNode", async (_event, nodeId) => controller.focusNode(nodeId));
  ipcMain.handle("tree:completeNode", async (_event, nodeId) => controller.completeNode(nodeId));
  ipcMain.handle("tree:deleteNode", async (_event, nodeId) => controller.deleteNode(nodeId));
  ipcMain.handle("tree:undo", async () => controller.undo());
  ipcMain.handle("tree:redo", async () => controller.redo());
  ipcMain.handle("archive:listSessions", async () => controller.listSessions());
  ipcMain.handle("archive:readEvents", async (_event, sessionId) => controller.readEvents(sessionId));
  ipcMain.handle("session:save", async () => controller.saveSession());
  ipcMain.handle("ui:start-drag", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return [0, 0];
    }
    const pos = mainWindow.getPosition();
    return pos;
  });
  ipcMain.on("ui:drag-move", (_event, dx, dy) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    suppressDockEvent = true;
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({
      x: bounds.x + dx,
      y: bounds.y + dy,
      width: bounds.width,
      height: bounds.height
    });
  });
  ipcMain.on("ui:drag-end", () => {
    suppressDockEvent = false;
  });
  ipcMain.on("ui:set-ignore-mouse-events", (_event, ignore) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });

  ipcMain.handle("translate:lookup", async (_event, word) => {
    const trimmed = (word ?? "").trim();
    if (!trimmed) {
      return { error: "空输入" };
    }
    const hasChinese = /[\u4e00-\u9fff]/.test(trimmed);
    const langPair = hasChinese ? "zh-CN|en" : "en|zh-CN";
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${langPair}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.responseStatus === 200 && data.responseData) {
        return {
          result: data.responseData.translatedText,
          from: hasChinese ? "zh" : "en"
        };
      }
      return { error: "翻译失败" };
    } catch (err) {
      return { error: err.message || "网络错误" };
    }
  });
}

app.whenReady().then(async () => {
  await createController(); // sets controller
  createWindow();
  createTray();
  setupIpc();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.setIgnoreMouseEvents(false);
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("before-quit", async () => {
  isQuitting = true;
  if (controller) {
    await controller.shutdown();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
