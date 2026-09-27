"use strict";
const el = id => document.getElementById(id);
async function command(action, extra = {}) { try { render(await window.desktop.command({ action, ...extra })); } catch (error) { el("error").textContent = error.message; } }
function render(state) {
  el("error").textContent = state.fault;
  el("restart").disabled = state.running;
  el("home").className = state.selected === "home" ? "selected" : "";
  el("tabs").replaceChildren();
  for (const tab of state.tabs) {
    const group = document.createElement("span"); group.className = "tab";
    const title = document.createElement("button"); title.textContent = (tab.crashed ? "⚠ " : "") + tab.title;
    title.className = state.selected === tab.id ? "selected" : ""; title.onclick = () => command("select", { id: tab.id });
    const close = document.createElement("button"); close.textContent = "×"; close.title = "Explicitly close this page"; close.onclick = () => command("close", { id: tab.id });
    group.append(title, close); el("tabs").append(group);
  }
}
el("home").onclick = () => command("select", { id: "home" });
el("login").onclick = () => command("login");
el("restart").onclick = () => command("restart");
el("quit").onclick = () => command("quit");
window.desktop.onTabs(render); command("state");
