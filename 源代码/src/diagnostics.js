/* Standalone ES5 diagnostics: runs before the application bundle and needs no PSD parser. */
(function () {
  var VERSION = '0.1.6';
  var boot = /*PSD_BRIDGE_BOOT*/null;
  var state = { uiVersion: VERSION, uiScript: 'not-started', hostBootstrap: boot,
    connection: 'checking', fontState: 'not-requested', events: [], lastProbe: null };
  var sequence = 0, pending = {}, timer;
  var nonce = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var status = document.getElementById('connection-status');
  var button = document.getElementById('connection-check');
  function sourceKind(event) {
    return event.source === parent ? 'parent' : event.source === window.top ? 'top' : event.source === window ? 'self' : event.source === null ? 'null' : event.source === undefined ? 'undefined' : 'relay';
  }
  function record(stage, detail) {
    state.events.push({ at: new Date().toISOString(), stage: stage, detail: detail });
    if (state.events.length > 40) state.events.shift();
  }
  function render() {
    if (!status) return;
    var host = state.lastProbe && state.lastProbe.host;
    var prefix = 'UI ' + VERSION + ' · ';
    if (state.uiScript === 'error') status.textContent = prefix + '应用脚本异常；连接检查仍可用，请下载诊断';
    else if (state.connection === 'connected') status.textContent = prefix + '主程序 ' + host.version + ' · 通信正常';
    else if (state.connection === 'version-mismatch') status.textContent = prefix + '主程序版本不匹配，请重新导入完整安装包';
    else if (state.connection === 'unresponsive') status.textContent = prefix + (boot ? '主程序已加载，但通信回执未收到' : '主程序启动标记未收到，请检查是否打开了旧版插件') + '；可下载诊断';
    else status.textContent = prefix + (boot ? '主程序启动标记已收到，正在检查通信…' : '正在检查主程序与通信…');
  }
  function probe() {
    // One bounded read-only probe; no automatic reconnect or file processing loop.
    for (var old in pending) { clearTimeout(pending[old]); delete pending[old]; }
    var id = 'diagnostic-' + nonce + '-' + (++sequence);
    state.connection = 'checking'; render();
    record('probe-sent', {requestId: id});
    pending[id] = setTimeout(function () {
      delete pending[id]; state.connection = 'unresponsive'; record('probe-timeout', {timeoutMs: 8000}); render();
    }, 8000);
    try { parent.postMessage({pluginMessage:{type:'ping',requestId:id}}, '*'); }
    catch (error) { clearTimeout(pending[id]); delete pending[id]; state.connection = 'unresponsive'; record('post-failed', String(error)); render(); }
  }
  window.addEventListener('message', function (event) {
    var message = event.data && event.data.pluginMessage;
    if (!message || message.type !== 'ack' || typeof message.ok !== 'boolean' || typeof message.requestId !== 'string' || !Object.prototype.hasOwnProperty.call(pending, message.requestId)) return;
    // A unique correlated request ID associates this read-only probe reply, independent
    // of whether the host relays through parent, self or a synthetic event.
    clearTimeout(pending[message.requestId]); delete pending[message.requestId];
    var host = message.result || {};
    state.lastProbe = {host: host, source: sourceKind(event), origin: typeof event.origin === 'string' ? event.origin : ''};
    state.connection = message.ok && host.version === VERSION && host.handlerRegistered === true ? 'connected' : 'version-mismatch';
    record('probe-received', state.lastProbe); render();
  });
  window.addEventListener('error', function (event) { state.uiScript = 'error'; record('ui-error', String(event.message || 'Unknown script error')); render(); });
  window.addEventListener('unhandledrejection', function (event) { record('ui-unhandled-rejection', String(event.reason)); });
  window.__PSD_DIAGNOSTICS__ = {state:state,record:record,probe:probe,sourceKind:sourceKind};
  if (button) button.addEventListener('click', probe);
  var download = document.getElementById('diagnostics-download');
  if (download) download.addEventListener('click', function () {
    var url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], {type:'application/json;charset=utf-8'}));
    var a = document.createElement('a'); a.href=url; a.download='PSD-Bridge-0.1.6-连接诊断.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
  record('diagnostics-started', {hostBootstrapPresent:!!boot}); render(); probe();
}());
