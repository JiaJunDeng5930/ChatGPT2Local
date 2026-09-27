"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", Object.freeze({
  command: input => ipcRenderer.invoke("desktop", input),
  onState: callback => { const handler = (_event, state) => callback(state); ipcRenderer.on("desktop-state", handler); return () => ipcRenderer.removeListener("desktop-state", handler); },
  onShowBrowser: callback => { const handler = () => callback(); ipcRenderer.on("show-browser", handler); return () => ipcRenderer.removeListener("show-browser", handler); },
}));
