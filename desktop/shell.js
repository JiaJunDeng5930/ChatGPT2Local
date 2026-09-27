"use strict";
const el = id => document.getElementById(id);
let snapshot = null;
let surface = "browser";
let sidebarOpen = true;
let mcpStep = 0;
let setupMessage = "";
let modelsInstalled = false;
let doctorReport = null;
let refreshing = false;

function messageOf(error) { return error instanceof Error ? error.message : String(error); }
function showError(error) {
  el("error-message").textContent = messageOf(error);
  el("error-toast").hidden = false;
}
function clearError() { el("error-toast").hidden = true; el("error-message").textContent = ""; }
async function invoke(action, extra = {}) { return window.desktop.command({ action, ...extra }); }
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { snapshot = await invoke("snapshot"); render(); }
  catch (error) { showError(error); }
  finally { refreshing = false; }
}
function mergeState(state) {
  if (!snapshot) snapshot = state;
  else snapshot = { ...snapshot, ...state, config: state.config ?? snapshot.config, status: snapshot.status };
  render();
}
function setSurface(next) {
  surface = next;
  document.querySelectorAll(".surface").forEach(node => { node.hidden = node.id !== `surface-${next}`; });
  document.querySelectorAll(".sidebar-item[data-surface]").forEach(node => node.classList.toggle("is-active", node.dataset.surface === next));
  if (next === "browser") requestAnimationFrame(syncBrowserBounds);
  else void invoke("browser-bounds", { bounds: null }).catch(showError);
}
function setSidebar(open) {
  sidebarOpen = open;
  el("app").classList.toggle("is-sidebar-open", open);
  el("sidebar-toggle").title = open ? "Hide sidebar" : "Show sidebar";
  requestAnimationFrame(syncBrowserBounds);
  setTimeout(syncBrowserBounds, 320);
}
function selectedTab() { return snapshot?.tabs?.find(tab => tab.id === snapshot.selectedTab) ?? null; }
function syncBrowserBounds() {
  if (surface !== "browser" || !snapshot?.selectedTab) { void invoke("browser-bounds", { bounds: null }).catch(showError); return; }
  const rect = el("browser-slot").getBoundingClientRect();
  void invoke("browser-bounds", { bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }).catch(showError);
}
function dotClass(phase, fault) {
  if (fault) return "state-dot is-error";
  if (["Completed", "Closed"].includes(phase)) return "state-dot is-ready";
  if (["Attempted", "Running", "Prepared"].includes(phase)) return "state-dot is-busy";
  return "state-dot";
}
function actionButton(label, action) {
  const button = document.createElement("button");
  button.textContent = label;
  button.addEventListener("click", event => { event.stopPropagation(); void action(button); });
  return button;
}
function renderBrowser() {
  const tabs = el("browser-tabs"); tabs.replaceChildren();
  for (const tab of snapshot?.tabs ?? []) {
    const row = document.createElement("button"); row.className = `browser-tab${tab.active ? " is-active" : ""}`; row.type = "button";
    const brand = document.createElement("span"); brand.className = "brand-mark"; brand.textContent = "✣";
    const title = document.createElement("span"); title.className = "browser-tab-title"; title.textContent = tab.crashed ? `⚠ ${tab.title}` : tab.title || "ChatGPT";
    if (tab.loading) { const spin = document.createElement("i"); spin.className = "tab-spinner"; row.append(brand, title, spin); }
    else if (tab.crashed) { const bad = document.createElement("i"); bad.className = "tab-error"; row.append(brand, title, bad); }
    else row.append(brand, title);
    const close = document.createElement("span"); close.className = "browser-tab-close"; close.textContent = "×"; close.title = "Close page";
    close.addEventListener("click", event => { event.stopPropagation(); void invoke("close-tab", { id: tab.id }).then(mergeState).catch(showError); });
    row.append(close);
    row.addEventListener("click", () => void invoke("select-tab", { id: tab.id }).then(mergeState).catch(showError));
    tabs.append(row);
  }
  const current = selectedTab();
  el("browser-empty").hidden = !!current;
  el("browser-location").textContent = current?.url || "No ChatGPT page open";
  for (const id of ["browser-back", "browser-forward", "browser-reload", "browser-zoom-out", "browser-zoom-reset", "browser-zoom-in"]) el(id).disabled = !current;
  requestAnimationFrame(syncBrowserBounds);
}
function renderSetup() {
  if (!snapshot) return;
  const hasPage = snapshot.tabs?.length > 0;
  el("setup-chatgpt").classList.toggle("is-complete", hasPage);
  el("setup-runtime").classList.toggle("is-complete", snapshot.running);
  el("setup-codex").classList.toggle("is-complete", modelsInstalled);
  el("setup-open").textContent = hasPage ? "Open another page" : "Open ChatGPT";
  el("setup-runtime-action").textContent = snapshot.running ? "Restart runtime" : "Start runtime";
  el("setup-message").hidden = !setupMessage;
  el("setup-message").textContent = setupMessage;
  el("setup-message").className = "notice-row is-success";
}
function renderAstra() {
  if (!snapshot) return;
  const card = el("astra-card"); card.replaceChildren();
  if (!snapshot.config?.jev) {
    const text = document.createElement("p"); text.textContent = "Astra Jev is not configured in this profile. The webpage path remains independent of this optional native route."; card.append(text); return;
  }
  const dl = document.createElement("dl");
  for (const [label, value] of [["Advisor", snapshot.config.jev.baseUrl], ["Model", snapshot.config.jev.model], ["Credential", snapshot.config.jev.keyEnv], ["Target", snapshot.config.jev.targetModel]]) {
    const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; dl.append(dt, dd);
  }
  card.append(dl);
}
function renderMcp() {
  document.querySelectorAll(".wizard-stepper button").forEach(button => button.classList.toggle("is-active", Number(button.dataset.step) === mcpStep));
  document.querySelectorAll("[data-step-panel]").forEach(panel => { panel.hidden = Number(panel.dataset.stepPanel) !== mcpStep; });
  el("mcp-previous").disabled = mcpStep === 0;
  el("mcp-next").textContent = mcpStep === 2 ? "Done" : "Next";
  if (!snapshot) return;
  const full = snapshot.config?.mode === "full";
  el("mcp-mode-notice").className = `notice-row ${full ? "is-success" : "is-warning"}`;
  el("mcp-mode-notice").textContent = full ? "Full mode is configured. Restart the runtime after configuration changes." : "Browser-only is active; native connector requests are disabled.";
  el("mcp-enable-full").disabled = full;
  el("connector-name").textContent = snapshot.config?.connectorName || "Codex Native2";
  el("connector-address").textContent = snapshot.status?.connector || (full ? "Runtime status unavailable" : "Disabled in browser-only mode");
  el("mcp-tunnel-toggle").textContent = snapshot.tunnelRunning ? "Stop tunnel" : "Start tunnel";
  el("mcp-tunnel-toggle").disabled = !snapshot.config?.tunnelConfigured;
  if (snapshot.tunnelFault) { el("mcp-tunnel-message").hidden = false; el("mcp-tunnel-message").className = "notice-row is-warning"; el("mcp-tunnel-message").textContent = snapshot.tunnelFault; }
}
function renderActivity() {
  const table = el("activity-table"); table.replaceChildren();
  const operations = snapshot?.status?.operations ?? [];
  if (!operations.length) { const empty = document.createElement("div"); empty.className = "surface-empty"; empty.textContent = "No durable operations yet"; table.append(empty); return; }
  const faultMap = new Map((snapshot?.status?.faults ?? []).map(entry => [entry.id, entry.fault]));
  for (const operation of operations) {
    const row = document.createElement("div"); row.className = "activity-row";
    const dot = document.createElement("i"); dot.className = dotClass(operation.phase, faultMap.get(operation.id));
    const text = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = `${operation.model} · ${operation.phase}`;
    const detail = document.createElement("span"); detail.textContent = operation.id;
    text.append(title, detail);
    const actions = document.createElement("div"); actions.className = "activity-actions";
    if (operation.page) actions.append(actionButton("Show", async button => { button.disabled = true; try { await invoke("show-operation", { id: operation.id }); await refresh(); } catch (error) { showError(error); } finally { button.disabled = false; } }));
    actions.append(actionButton("Resume", async button => { button.disabled = true; try { snapshot = await invoke("resume-operation", { id: operation.id }); render(); } catch (error) { showError(error); } finally { button.disabled = false; } }));
    actions.append(actionButton("Confirm", async button => { if (!confirm("Confirm that the current answer on the original page is complete, including all tool results?")) return; button.disabled = true; try { snapshot = await invoke("resume-operation", { id: operation.id, confirm: true }); render(); } catch (error) { showError(error); } finally { button.disabled = false; } }));
    actions.append(actionButton("Cancel", async button => { if (!confirm("Explicitly request Stop on this operation's original page? The task will not be resent.")) return; button.disabled = true; try { snapshot = await invoke("cancel-operation", { id: operation.id }); render(); } catch (error) { showError(error); } finally { button.disabled = false; } }));
    row.append(dot, text, actions); table.append(row);
  }
}
function renderSettings() {
  if (!snapshot) return;
  el("settings-mode").value = snapshot.config?.mode || "browser-only";
  const options = el("effort-options"); options.replaceChildren();
  for (const effort of ["light", "medium", "high", "xhigh", "pro"]) {
    const label = document.createElement("label"); label.className = "effort-option";
    const input = document.createElement("input"); input.type = "checkbox"; input.value = effort; input.checked = snapshot.config?.efforts?.includes(effort) ?? false;
    const text = document.createElement("span"); text.textContent = effort; label.append(input, text); options.append(label);
  }
  el("about-version").textContent = `${snapshot.platform} · v${snapshot.version}${snapshot.packaged ? " · packaged" : " · development"}${snapshot.status?.kernel ? ` · ${snapshot.status.kernel.slice(0, 12)}` : ""}`;
  el("doctor-output").hidden = !doctorReport;
  if (doctorReport) el("doctor-output").textContent = JSON.stringify(doctorReport, null, 2);
}
function renderSidebar() {
  if (!snapshot) return;
  const browserBadge = el("browser-badge"); browserBadge.className = "sidebar-item-badge";
  if (snapshot.fault) browserBadge.classList.add("is-error"); else if (!snapshot.tabs?.length) browserBadge.classList.add("is-required");
  const setupBadge = el("setup-badge"); setupBadge.className = `sidebar-item-badge${snapshot.running ? "" : " is-required"}`;
  const mcpBadge = el("mcp-badge"); mcpBadge.className = `sidebar-item-badge${snapshot.config?.mode === "full" ? "" : " is-optional"}`;
  const count = snapshot.status?.operations?.length ?? 0; el("activity-count").textContent = count ? String(count) : "";
}
function render() {
  document.querySelectorAll(".surface").forEach(node => { node.hidden = node.id !== `surface-${surface}`; });
  document.querySelectorAll(".sidebar-item[data-surface]").forEach(node => node.classList.toggle("is-active", node.dataset.surface === surface));
  renderSidebar(); renderBrowser(); renderSetup(); renderAstra(); renderMcp(); renderActivity(); renderSettings();
  if (snapshot?.fault) showError(snapshot.fault);
}

el("sidebar-toggle").addEventListener("click", () => setSidebar(!sidebarOpen));
document.querySelectorAll(".sidebar-item[data-surface]").forEach(button => button.addEventListener("click", () => setSurface(button.dataset.surface)));
el("error-dismiss").addEventListener("click", clearError);
const openChat = async () => { try { mergeState(await invoke("new-chat")); setSurface("browser"); } catch (error) { showError(error); } };
el("new-tab").addEventListener("click", openChat); el("browser-open").addEventListener("click", openChat); el("setup-open").addEventListener("click", openChat);
for (const [id, direction] of [["browser-back", "back"], ["browser-forward", "forward"], ["browser-reload", "reload"]]) el(id).addEventListener("click", () => void invoke("navigate", { direction }).then(mergeState).catch(showError));
for (const [id, direction] of [["browser-zoom-out", "out"], ["browser-zoom-reset", "reset"], ["browser-zoom-in", "in"]]) el(id).addEventListener("click", () => void invoke("zoom", { direction }).then(mergeState).catch(showError));
el("setup-runtime-action").addEventListener("click", async () => { try { snapshot = await invoke("restart-runtime"); render(); } catch (error) { showError(error); } });
el("setup-install").addEventListener("click", async () => { try { const result = await invoke("install-models"); modelsInstalled = true; setupMessage = result.message || "Codex model profile installed."; snapshot = result.snapshot; render(); } catch (error) { showError(error); } });
el("setup-mcp").addEventListener("click", () => setSurface("mcp"));

document.querySelectorAll(".wizard-stepper button").forEach(button => button.addEventListener("click", () => { mcpStep = Number(button.dataset.step); renderMcp(); }));
el("mcp-previous").addEventListener("click", () => { if (mcpStep > 0) mcpStep--; renderMcp(); });
el("mcp-next").addEventListener("click", () => { if (mcpStep < 2) { mcpStep++; renderMcp(); } else setSurface("browser"); });
el("mcp-enable-full").addEventListener("click", async () => { try { snapshot = await invoke("save-settings", { mode: "full", efforts: snapshot.config.efforts }); render(); } catch (error) { showError(error); } });
el("mcp-restart").addEventListener("click", async () => { try { snapshot = await invoke("restart-runtime"); render(); } catch (error) { showError(error); } });
el("mcp-connect-tunnel").addEventListener("click", async () => { try { const result = await invoke("connect-tunnel", { tunnelId: el("tunnel-id").value }); if (!result.cancelled) { el("mcp-tunnel-message").hidden = false; el("mcp-tunnel-message").className = "notice-row is-success"; el("mcp-tunnel-message").textContent = result.message; } snapshot = result.snapshot; render(); } catch (error) { showError(error); } });
el("mcp-tunnel-toggle").addEventListener("click", async () => { try { mergeState(await invoke(snapshot.tunnelRunning ? "stop-tunnel" : "start-tunnel")); } catch (error) { showError(error); } });

el("activity-refresh").addEventListener("click", refresh);
el("settings-save").addEventListener("click", async () => {
  const efforts = [...el("effort-options").querySelectorAll("input:checked")].map(input => input.value);
  try { snapshot = await invoke("save-settings", { mode: el("settings-mode").value, efforts }); el("settings-save-state").textContent = "Saved · restart runtime to apply"; render(); }
  catch (error) { showError(error); }
});
el("settings-doctor").addEventListener("click", async () => { try { doctorReport = await invoke("doctor"); renderSettings(); } catch (error) { showError(error); } });
el("settings-restart").addEventListener("click", async () => { try { snapshot = await invoke("restart-runtime"); render(); } catch (error) { showError(error); } });
el("settings-quit").addEventListener("click", () => void invoke("quit").catch(showError));
window.addEventListener("resize", syncBrowserBounds);
window.desktop.onState(mergeState);
window.desktop.onShowBrowser(() => { setSurface("browser"); void refresh(); });
void refresh().then(() => setSurface("browser"));
setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 1800);
