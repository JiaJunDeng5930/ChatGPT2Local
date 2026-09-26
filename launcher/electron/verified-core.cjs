"use strict";

// One generated Bend library for both the daemon and the Electron effect host.
// There is no handwritten transition fallback when packaging is incomplete.
const path = require("node:path");
const { app } = require("electron");
module.exports = require(app?.isPackaged
  ? path.join(process.resourcesPath, "runtime", "app", "verified-core.cjs")
  : path.join(__dirname, "../../src/verified/generated/core.cjs"));
