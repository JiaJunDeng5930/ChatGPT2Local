"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", Object.freeze({
  command: input => ipcRenderer.invoke("desktop", input),
  onTabs: callback => { const handler = (_event, state) => callback(state); ipcRenderer.on("tabs", handler); return () => ipcRenderer.removeListener("tabs", handler); },
}));
