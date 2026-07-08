"use strict";

const { app, BrowserWindow, shell } = require("electron");
const http = require("http");
const { startServer } = require("../server/app");

let server;

async function createWindow() {
  const started = await ensureDaemon();
  server = started.server;

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 390,
    minHeight: 640,
    title: "Second",
    backgroundColor: "#F3F1EC",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(started.url);
}

async function ensureDaemon() {
  const host = "127.0.0.1";
  const preferredPort = Number(process.env.SECOND_PORT || 7317);
  try {
    return await startServer({ host, port: preferredPort });
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    const url = `http://${host}:${preferredPort}`;
    if (await isHealthy(url)) {
      return { server: null, host, port: preferredPort, url };
    }
    return startServer({ host, port: 0 });
  }
}

function isHealthy(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (server) server.close();
});
