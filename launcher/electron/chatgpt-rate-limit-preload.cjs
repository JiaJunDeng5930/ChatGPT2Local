"use strict";

const chatGptRateLimitProtocol = Object.freeze({
  stateId: "codex-chatgpt-rate-limit-state",
  scanEvent: "codex-chatgpt-rate-limit-scan",
  dialogSelector: '[role="dialog"], [role="alertdialog"]',
  titlePattern: "^(请求过于频繁|請求過於頻繁|Too many requests|太多要求|太多请求|リクエストが多すぎます|요청이 너무 많습니다|요청을 너무 빠르게|너무 많은 요청)$",
  buttonPattern: "^(Got it|明白了|知道了|了解|알겠습니다|확인)$",
  closeTimeoutMs: 2_000,
});

// Keep this installer self-contained: Playwright serializes it into the page, while Electron
// executes the same file in its isolated preload world. DOM attributes bridge those worlds.
function installChatGptRateLimitHandler(protocol) {
  if (window.top !== window || location.origin !== "https://chatgpt.com") return;
  if (!document.documentElement) {
    const ready = new MutationObserver(() => {
      if (!document.documentElement) return;
      ready.disconnect();
      installChatGptRateLimitHandler(protocol);
    });
    ready.observe(document, { childList: true, subtree: true });
    return;
  }
  if (document.getElementById(protocol.stateId)) return;
  const state = document.createElement("meta");
  state.id = protocol.stateId;
  state.setAttribute("data-pending", "false");
  document.documentElement.appendChild(state);

  const titlePattern = new RegExp(protocol.titlePattern, "i");
  const buttonPattern = new RegExp(protocol.buttonPattern, "i");
  const active = new Map();
  let timer;
  let scanning = false;
  function visible(element) {
    return element.isConnected
      && !element.closest('[hidden], [aria-hidden="true"], [data-state="closed"]')
      && element.getClientRects().length > 0
      && getComputedStyle(element).visibility === "visible";
  }
  function set(name, value) {
    if (state.getAttribute(name) !== String(value)) state.setAttribute(name, String(value));
  }
  function isRateLimitDialog(dialog) {
    const title = dialog.querySelector('h1, h2, h3, [role="heading"]');
    return titlePattern.test(title?.textContent.trim() ?? "");
  }
  function scan() {
    if (scanning) return;
    scanning = true;
    try {
      clearTimeout(timer);
      for (const [dialog] of active) {
        if (!visible(dialog) || !isRateLimitDialog(dialog)) active.delete(dialog);
      }
      for (const dialog of document.querySelectorAll(protocol.dialogSelector)) {
        if (!visible(dialog) || !isRateLimitDialog(dialog)) continue;
        if (!active.has(dialog)) {
          active.set(dialog, { firstSeen: Date.now(), clicked: false });
        }
        const occurrence = active.get(dialog);
        if (occurrence.clicked) continue;
        const button = Array.from(dialog.querySelectorAll("button")).find(candidate =>
          buttonPattern.test(candidate.textContent.trim())
          && !candidate.matches(":disabled")
          && candidate.getAttribute("aria-disabled") !== "true"
          && visible(candidate));
        if (!button) continue;
        occurrence.clicked = true;
        // No keyboard events or focus restoration: they could target the concurrent composer.
        try { button.click(); } catch { /* Keep tracking the dialog as a UI blocker. */ }
      }
      for (const [dialog] of active) {
        if (!visible(dialog)) active.delete(dialog);
      }
      set("data-pending", active.size > 0);
      // Poll only during the bounded close window, including CSS-only closing animations.
      // Later DOM mutations still handle delayed buttons and dialog reuse without a busy loop.
      if ([...active.values()].some(item => Date.now() - item.firstSeen < protocol.closeTimeoutMs)) {
        timer = setTimeout(scan, 50);
      }
    } finally {
      scanning = false;
    }
  }
  new MutationObserver(records => {
    // React can hide/remove and reuse a dialog within a single mutation batch. Remember
    // that transition even when the final DOM is already visible again.
    for (const record of records) {
      const reopened = record.type === "attributes" && (
        (record.attributeName === "hidden" && record.oldValue !== null)
        || (record.attributeName === "aria-hidden" && record.oldValue === "true")
        || (record.attributeName === "data-state" && record.oldValue === "closed")
      );
      for (const [dialog] of active) {
        if ((reopened && record.target.contains(dialog))
          || [...record.removedNodes].some(node => node.contains(dialog))) active.delete(dialog);
      }
    }
    if (records.some(record => record.target !== state)) scan();
  }).observe(document, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "data-state", "disabled", "aria-disabled"],
  });
  document.addEventListener(protocol.scanEvent, scan);
  scan();
}

if (typeof window !== "undefined") installChatGptRateLimitHandler(chatGptRateLimitProtocol);
if (typeof module !== "undefined") module.exports = { installChatGptRateLimitHandler, chatGptRateLimitProtocol };
