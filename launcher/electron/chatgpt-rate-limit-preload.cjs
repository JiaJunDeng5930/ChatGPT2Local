(() => {
  "use strict";

  if (window.top !== window || location.origin !== "https://chatgpt.com") return;

  const dismissedDialogs = new Set();

  function isVisible(element) {
    return element.isConnected
      && !element.closest('[hidden], [aria-hidden="true"], [data-state="closed"]')
      && element.getClientRects().length > 0
      && getComputedStyle(element).visibility === "visible";
  }

  function dismissRateLimitDialog() {
    for (const dialog of dismissedDialogs) {
      if (!isVisible(dialog)) dismissedDialogs.delete(dialog);
    }

    for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      if (dismissedDialogs.has(dialog) || !isVisible(dialog)) continue;

      const title = dialog.querySelector('h1, h2, h3, [role="heading"]');
      if (title?.textContent.trim() !== "请求过于频繁") continue;

      const button = Array.from(dialog.querySelectorAll("button")).find(candidate =>
        candidate.textContent.trim() === "明白了"
        && !candidate.disabled
        && candidate.getAttribute("aria-disabled") !== "true"
        && isVisible(candidate));
      if (!button) continue;

      // Click once during the closing animation; a hidden or removed dialog can be reused.
      dismissedDialogs.add(dialog);
      button.click();
    }
  }

  new MutationObserver(dismissRateLimitDialog).observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "data-state", "disabled", "aria-disabled"],
  });

  dismissRateLimitDialog();
})();
