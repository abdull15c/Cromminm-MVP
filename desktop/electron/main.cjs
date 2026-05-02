const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { fork } = require('child_process');

// Constants — keep in sync with local-api PORT (env PORT or LOCAL_API_PORT)
const PORT = Number(process.env.PORT || process.env.LOCAL_API_PORT || 8787);
const API_URL = `http://127.0.0.1:${PORT}`;
const BACKEND_WAIT_TIMEOUT_MS = 10000;
const BACKEND_POLL_INTERVAL_MS = 250;

let serverProcess;

function appendLog(message, data) {
  try {
    const logPath = path.join(app.getPath("userData"), "backend.log");
    
    // Mask proxy credentials in logs
    let sanitizedData = data;
    if (data && typeof data === 'object') {
      sanitizedData = JSON.parse(JSON.stringify(data));
      if (sanitizedData.proxy) {
        sanitizedData.proxy = maskProxyCredentials(sanitizedData.proxy);
      }
    }
    
    const line = `${new Date().toISOString()} ${message}${sanitizedData ? ` ${JSON.stringify(sanitizedData)}` : ""}\n`;
    fs.appendFileSync(logPath, line, "utf-8");
  } catch (err) {
    // Logging must never prevent the app from starting, but log to console as fallback
    console.error('Failed to write log:', err.message);
  }
}

function maskProxyCredentials(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== 'string') return proxyUrl;
  try {
    const url = new URL(proxyUrl);
    if (url.username || url.password) {
      return `${url.protocol}//${url.username ? '***' : ''}${url.password ? ':***' : ''}@${url.host}`;
    }
    return proxyUrl;
  } catch {
    return proxyUrl;
  }
}

async function waitForBackend(timeoutMs = BACKEND_WAIT_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, BACKEND_POLL_INTERVAL_MS));
    }
  }
  return false;
}

function startBackend() {
  const serverPath = app.isPackaged 
    ? path.join(app.getAppPath(), 'local-api/dist/server.js')
    : path.join(__dirname, '../../local-api/dist/server.js');
  
  // Security: Validate that serverPath is within expected directory
  const expectedRoot = app.isPackaged ? app.getAppPath() : path.join(__dirname, '../..');
  const resolvedPath = path.resolve(serverPath);
  const resolvedRoot = path.resolve(expectedRoot);
  if (!resolvedPath.startsWith(resolvedRoot)) {
    appendLog("Security error: serverPath outside expected directory", { serverPath, expectedRoot });
    throw new Error("Invalid server path");
  }
  
  appendLog("Starting backend", {
    serverPath,
    cwd: app.isPackaged ? app.getAppPath() : path.join(__dirname, '../..'),
    packaged: app.isPackaged,
  });
  serverProcess = fork(serverPath, [], {
    cwd: app.isPackaged ? app.getAppPath() : path.join(__dirname, '../..'),
    silent: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      APP_ROOT_DIR: app.isPackaged ? app.getAppPath() : path.join(__dirname, '../..'),
      APP_USER_DATA_DIR: app.getPath('userData'),
    }
  });
  serverProcess.stdout?.on("data", (chunk) => appendLog("backend stdout", String(chunk).trim()));
  serverProcess.stderr?.on("data", (chunk) => appendLog("backend stderr", String(chunk).trim()));
  serverProcess.on("error", (error) => appendLog("backend error", { message: error.message, stack: error.stack }));
  serverProcess.on("exit", (code, signal) => appendLog("backend exit", { code, signal }));
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  const shouldDebug = process.env.ELECTRON_DEBUG === "1";
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("Renderer failed to load", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone", details);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log("Renderer console", { level, message, line, sourceId });
  });
  if (shouldDebug) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  return mainWindow;
}

async function loadApp(mainWindow) {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    return;
  }

  const indexPath = path.join(__dirname, "..", "dist", "index.html");
  await mainWindow.loadFile(indexPath);
}

app.whenReady().then(async () => {
  startBackend();
  const mainWindow = createWindow();
  const backendReady = await waitForBackend();
  appendLog("Backend health check", { ready: backendReady });
  await loadApp(mainWindow);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWindow = createWindow();
      void loadApp(nextWindow);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on('quit', async () => {
  // Graceful shutdown: close all active sessions before killing server
  if (serverProcess) {
    try {
      // Send shutdown signal to API to close all sessions
      await fetch(`${API_URL}/shutdown`, { method: 'POST' }).catch(() => {});
      
      // Give it a moment to clean up
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch {
      // Ignore errors during shutdown
    }
    
    serverProcess.kill();
  }
});
