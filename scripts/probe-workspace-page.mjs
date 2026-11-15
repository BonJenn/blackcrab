// CI evidence only. Reads what the workspace window's page is doing through
// Chromium's debugging port, which only a test build of the launcher opens.
// Prints one JSON report; values that look like tokens are removed.
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('debugging port required');
const report = {targets: [], state: null, afterReload: null, console: [], exceptions: [], failed: [], responses: []};
const clean = text => String(text).replace(/[A-Za-z0-9_\-=]{32,}/g, '[redacted]').slice(0, 600);
const STATE = `(() => ({href: location.href, ready: document.readyState, title: document.title,
  text: (document.body?.innerText ?? '').slice(0, 400), elements: document.querySelectorAll('*').length,
  rootChildren: document.getElementById('root')?.childElementCount ?? null,
  scripts: [...document.scripts].map(s => s.src || 'inline:' + s.textContent.length),
  styles: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href),
  resources: performance.getEntriesByType('resource').map(e => [e.name, e.responseStatus, e.transferSize, Math.round(e.duration)]).slice(0, 80),
  bridge: typeof window.desktopBridge}))()`;
try {
  let targets;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!targets) throw Error('debugging port never answered');
  report.targets = targets.map(t => ({type: t.type, url: clean(t.url), title: clean(t.title)}));
  const page = targets.find(t => t.type === 'page');
  if (!page) throw Error('no page target');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(Error('debugger socket failed')); });
  let next = 0; const waiting = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); return; }
    const p = message.params ?? {};
    if (message.method === 'Runtime.consoleAPICalled') report.console.push(clean(p.type + ': ' + (p.args ?? []).map(a => a.value ?? a.description ?? a.type).join(' ')));
    if (message.method === 'Log.entryAdded') report.console.push(clean(p.entry.level + ': ' + p.entry.text + ' ' + (p.entry.url ?? '')));
    if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(clean(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
    if (message.method === 'Network.loadingFailed') report.failed.push(clean(p.type + ' ' + p.errorText + ' ' + (p.blockedReason ?? '')));
    if (message.method === 'Network.responseReceived') report.responses.push(clean(p.response.status + ' ' + p.response.mimeType + ' ' + p.response.url));
  };
  const send = (method, params = {}) => new Promise(resolve => { const id = ++next; waiting.set(id, resolve); socket.send(JSON.stringify({id, method, params})); });
  const evaluate = async () => { const r = await send('Runtime.evaluate', {expression: STATE, returnByValue: true}); return r.result?.result?.value ?? clean(JSON.stringify(r)); };
  report.state = await evaluate();
  for (const domain of ['Runtime', 'Log', 'Network', 'Page']) await send(domain + '.enable');
  await send('Page.reload');
  await new Promise(resolve => setTimeout(resolve, 20000));
  report.afterReload = await evaluate();
  socket.close();
} catch (error) { report.error = clean(error.message); }
for (const key of ['console', 'exceptions', 'failed', 'responses']) report[key] = report[key].slice(0, 60);
console.log(JSON.stringify(report, null, 1));
