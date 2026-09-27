/** A view of committed state. Browser lifecycle decisions remain in Bend. */
export const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex Web · Bend</title><link rel="stylesheet" href="/ui.css"></head>
<body><header><h1>Codex Web</h1><span id="connection">Disconnected</span></header><main>
<p>The webpage owns its conversation. This application never automatically stops, reloads, or resends a task.</p>
<section id="authentication"><label>Local control token <input id="token" type="password" autocomplete="off"></label><button id="connect">Connect</button></section>
<section><h2>Application</h2><pre id="configuration"></pre><button id="refresh">Refresh status</button><button id="login">Open ChatGPT / sign in</button><button id="install">Install Codex model profile</button></section>
<section><h2>Operations</h2><p>Resume only observes the original page. Cancel is an explicit request to stop it.</p><div id="operations"></div></section>
<section><h2>Native tools connector</h2><p>Connect your tunnel to the application's MCP endpoint. In ChatGPT, create <strong>Codex Native2</strong>. Tool authority comes from the active turn token, not the transport connection.</p><pre id="connector"></pre></section>
<section><h2>Diagnostics</h2><pre id="diagnostics"></pre></section></main><script src="/ui.js"></script></body></html>`;

export const css = `:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0 auto;max-width:1080px;padding:24px;background:#101519;color:#e4e9e9}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #43515a}h1{font-size:28px}h2{font-size:19px}p{line-height:1.6;color:#b9c5cb}section{margin:24px 0;padding:20px;background:#1a2329;border-radius:8px}button,input{font:inherit;padding:8px 12px;margin:4px;border:1px solid #657680;border-radius:5px}button{cursor:pointer;background:#253843;color:#fff}button:disabled{opacity:.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}article{border-top:1px solid #43515a;padding:12px 0}.error{color:#ffb6a6}code{overflow-wrap:anywhere}`;

export const javascript = `"use strict";
const el=id=>document.getElementById(id);
let token=sessionStorage.getItem('control-token')||decodeURIComponent(location.hash.slice(1));
if(location.hash)history.replaceState(null,'',location.pathname);
el('token').value=token;
async function call(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error?.message||'Request failed');return data;}
function report(error){el('diagnostics').textContent=error.message;el('diagnostics').className='error';}
function button(label,action){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await action();await refresh();}catch(e){report(e);}finally{b.disabled=false;}};return b;}
async function refresh(){try{const state=await call('/control/status');el('connection').textContent='Connected · '+state.version;el('authentication').hidden=true;el('configuration').textContent=JSON.stringify({mode:state.mode,models:state.models,proof:state.kernel},null,2);el('connector').textContent=state.connector;el('diagnostics').textContent=JSON.stringify({faults:state.faults,legacy:state.legacy},null,2);el('diagnostics').className='';el('operations').replaceChildren();for(const operation of state.operations){const row=document.createElement('article');const text=document.createElement('pre');text.textContent=operation.id+'\\n'+operation.model+' · '+operation.phase;row.append(text);row.append(button('Show page',()=>call('/control/show',{id:operation.id})));row.append(button('Resume observation',()=>call('/control/resume',{id:operation.id})));row.append(button('Confirm current answer',async()=>{if(confirm('Confirm that the current answer on this original page is the completed answer, including all tool results?'))await call('/control/resume',{id:operation.id,confirm:true});}));row.append(button('Cancel task',async()=>{if(confirm('Explicitly stop this task on its existing webpage?'))await call('/control/cancel',{id:operation.id});}));el('operations').append(row);}}catch(error){report(error);el('connection').textContent='Disconnected';el('authentication').hidden=false;}}
el('connect').onclick=()=>{token=el('token').value;sessionStorage.setItem('control-token',token);refresh();};el('refresh').onclick=refresh;
el('login').onclick=()=>call('/control/login',{}).catch(report);
el('install').onclick=()=>{if(confirm('Write the isolated Codex web profile and model catalog, preserving your other configuration?'))call('/control/install',{}).then(data=>{el('diagnostics').textContent=data.message;}).catch(report);};
if(token)refresh();`;
