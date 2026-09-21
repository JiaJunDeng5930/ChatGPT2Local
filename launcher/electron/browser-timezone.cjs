function validateBrowserTimezone(value) {
  if (typeof value !== "string" || value.length > 128) {
    throw new Error("Browser timezone must be an IANA timezone name or an empty string");
  }
  const timezone = value.trim();
  if (timezone) {
    try {
      // Validate with Chromium's ICU data in Electron; keep the user's accepted spelling.
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new Error(`Invalid browser timezone: ${timezone}`);
    }
  }
  return timezone;
}

class BrowserTimezone {
  constructor(timezone = "", logger) {
    this.timezone = validateBrowserTimezone(timezone);
    this.logger = logger;
    this.targets = new Map();
    this.queue = Promise.resolve();
  }

  attach(contents) {
    const existing = this.targets.get(contents);
    if (existing) return existing.ready;
    const target = { sessions: new Set(), ready: null };
    const debuggerApi = contents.debugger;
    // Keep this independent CDP session attached: detaching clears Chromium's override.
    debuggerApi.attach("1.3");
    this.targets.set(contents, target);
    contents.once("destroyed", () => this.targets.delete(contents));
    debuggerApi.on("message", (_event, method, params) => {
      if (method === "Target.detachedFromTarget") target.sessions.delete(params.sessionId);
      if (method !== "Target.attachedToTarget") return;
      const sessionId = params.sessionId;
      target.sessions.add(sessionId);
      void this.applyTarget(contents, sessionId).catch(error => {
        this.logger?.error("browser.timezone_override_failed", { message: error.message });
      }).finally(() => {
        if (!contents.isDestroyed()) {
          void debuggerApi.sendCommand("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
        }
      });
    });
    debuggerApi.on("detach", (_event, reason) => {
      this.targets.delete(contents);
      if (!contents.isDestroyed()) {
        this.logger?.error("browser.timezone_override_detached", { reason });
      }
    });
    target.ready = this.applyTarget(contents);
    return target.ready;
  }

  async applyTarget(contents, sessionId) {
    await contents.debugger.sendCommand("Emulation.setTimezoneOverride", { timezoneId: this.timezone }, sessionId);
    // Out-of-process frames need their own override before executing page scripts.
    // Worker behavior follows Chromium's native override; do not patch Date/Intl in JavaScript.
    await contents.debugger.sendCommand("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "iframe", exclude: false }, { exclude: true }],
    }, sessionId);
  }

  async applyAll() {
    await Promise.all([...this.targets].map(async ([contents, target]) => {
      if (contents.isDestroyed()) return;
      await target.ready;
      await contents.debugger.sendCommand("Emulation.setTimezoneOverride", { timezoneId: this.timezone });
      await Promise.all([...target.sessions].map(sessionId =>
        contents.debugger.sendCommand("Emulation.setTimezoneOverride", { timezoneId: this.timezone }, sessionId)));
    }));
  }

  set(timezone) {
    const next = validateBrowserTimezone(timezone);
    const operation = this.queue.then(async () => {
      const previous = this.timezone;
      this.timezone = next;
      try {
        await this.applyAll();
      } catch (error) {
        this.timezone = previous;
        await this.applyAll().catch(rollbackError => {
          this.logger?.error("browser.timezone_rollback_failed", { message: rollbackError.message });
        });
        throw error;
      }
      return next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

module.exports = { BrowserTimezone, validateBrowserTimezone };
