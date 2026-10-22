import { inspectFile, convertPsd } from './pipeline';
import { filterFonts } from './font-search';

declare global { interface Window { __PSD_DIAGNOSTICS__?: { state: any; record: (stage: string, detail?: unknown) => void; sourceKind: (event: MessageEvent) => string } } }
const diagnostics = window.__PSD_DIAGNOSTICS__;
if (diagnostics) { diagnostics.state.uiScript = 'loaded'; diagnostics.record('application-loaded', { version: '0.1.4' }); }

type Font = { family: string; style: string };
type Source = Awaited<ReturnType<typeof inspectFile>>;
type Pending = { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout>; sessionId?: string };
const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
};
const pending = new Map<string, Pending>();
const requestNonce = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
let requestSequence = 0;
let source: Source | undefined;
let inputFile: File | undefined;
let isBusy = false;
let isParsing = false;
let isCancelled = false;
let sessionId = '';
let fonts: Font[] = [];
let fontsLoaded = false;
let fontsRequested = false;
let fontsLoadError = '';
let generation = 0;
let report: unknown;
const fontMap: Record<string, Font> = Object.create(null);
const fontSearchQueries = new Map<string, string>();
const request = <T = any>(type: string, payload: Record<string, unknown> = {}, timeout = 180_000): Promise<T> => {
  const requestId = `ui-${requestNonce}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      diagnostics?.record('request-timeout', { type, timeout });
      reject(new Error(type === 'ping' || type === 'begin'
        ? `Figma 通信未响应（${type}）；尚未开始图层转换。请关闭旧插件，再从新版 manifest.json 重新打开。`
        : `Figma 响应超时（${type}）。本次操作已停止等待，请检查 Figma 插件控制台。`));
    }, timeout);
    pending.set(requestId, { resolve, reject, timer, sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined });
    diagnostics?.record('request-sent', { type, requestId });
    try { parent.postMessage({ pluginMessage: { type, requestId, ...payload } }, '*'); }
    catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
  });
};
window.addEventListener('message', (event: MessageEvent) => {
  // The documented bridge contract does not promise event.source identity.
  // Accept ACKs only for a live random request ID, rather than dropping host relays.
  if (!event.data || typeof event.data !== 'object') return;
  const message = event.data.pluginMessage;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'ack' && typeof message.requestId === 'string' && typeof message.ok === 'boolean') {
    const item = pending.get(message.requestId);
    if (!item) return;
    diagnostics?.record('ack-received', { source: diagnostics.sourceKind(event), requestId: message.requestId, ok: message.ok });
    clearTimeout(item.timer);
    pending.delete(message.requestId);
    if (message.ok) item.resolve(message.result);
    else item.reject(new Error(typeof message.error === 'string' ? message.error : 'Figma 操作未完成'));
  } else if (message.type === 'progress' && isBusy && message.sessionId === sessionId) {
    if (isCancelled) return;
    const done = Number(message.done ?? message.completed ?? 0);
    const total = Number(message.total ?? 0);
    const label = typeof message.label === 'string' ? message.label : (typeof message.name === 'string' ? message.name : '正在构建图层');
    showProgress('正在写入 Figma', total > 0 ? 65 + Math.min(1, done / total) * 35 : undefined, label);
  }
});
const waitForPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
const formatBytes = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
function addLog(message: string, kind = '') {
  const log = el('log');
  log.hidden = false;
  const line = document.createElement('div');
  line.className = `log-line ${kind}`;
  line.textContent = message;
  log.append(line);
  while (log.childElementCount > 80) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}
function showProgress(title: string, value: number | undefined, detail: string, state: 'busy' | 'success' | 'error' | 'idle' = 'busy') {
  el('status').hidden = false;
  el('status-title').textContent = title;
  el('status-detail').textContent = detail;
  el('status-dot').className = `status-dot ${state}`;
  el('status-percent').textContent = value == null ? '' : `${Math.round(Math.max(0, Math.min(100, value)))}%`;
  const bar = el('progress-bar');
  bar.className = value == null && state === 'busy' ? 'progress-bar indeterminate' : 'progress-bar';
  bar.style.width = value == null ? (state === 'busy' ? '35%' : '0') : `${Math.max(0, Math.min(100, value))}%`;
  el('progress-track').hidden = state === 'error' || state === 'idle';
}
function setBusy(value: boolean, parsing = false) {
  isBusy = value;
  isParsing = value && parsing;
  const clear = el<HTMLButtonElement>('clear-source-btn');
  clear.disabled = value && !parsing;
  clear.title = value && !parsing ? '导入进行中，请先取消或等待完成再清除素材' : '清除当前素材，不删除原文件或已导入的 Figma 图层';
  el<HTMLButtonElement>('import-btn').disabled = value || !source;
  el<HTMLButtonElement>('replace-btn').disabled = value;
  el<HTMLInputElement>('file-input').disabled = value;
  el('drop-zone').classList.toggle('disabled', value);
  el('drop-zone').setAttribute('aria-disabled', String(value));
  el('cancel-btn').hidden = !value || parsing;
  el<HTMLButtonElement>('cancel-btn').disabled = false;
  el('cancel-btn').textContent = '取消';
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('.option input'))) input.disabled = value;
  for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>('.font-row select'))) select.disabled = value || !fontsLoaded;
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('.font-search-input'))) input.disabled = value || !fontsLoaded;
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.font-search-clear'))) button.disabled = value || !fontsLoaded || button.getAttribute('data-has-query') !== 'true';
  el('import-label').textContent = value ? (parsing ? '正在读取文件…' : '正在导入…') : source ? '导入到当前 Figma 页面' : '选择文件以开始';
}
function renderWarnings(warnings: string[]) {
  const host = el('warnings');
  host.replaceChildren();
  host.hidden = warnings.length === 0;
  for (const message of warnings) {
    const line = document.createElement('p');
    line.textContent = message;
    host.append(line);
  }
}
const fontKey = (value: string) => value.toLowerCase().replace(/[\s_\-.,]+/g, '');
function matchFont(name: string): Font | undefined {
  const key = fontKey(name);
  return fonts.find(font => fontKey(`${font.family}${font.style}`) === key)
    ?? fonts.find(font => fontKey(font.family) === key && /^(regular|normal|book|常规|標準|标准)$/i.test(font.style))
    ?? fonts.find(font => fontKey(font.family) === key);
}
function renderFonts() {
  const host = el('font-list');
  host.replaceChildren();
  const includeHidden = el<HTMLInputElement>('include-hidden').checked;
  const names = (includeHidden ? source?.summary.fonts : source?.summary.visibleFonts) ?? [];
  el('font-count').textContent = source ? `${names.length} 种源字体` : '选择文件后检查';
  el('font-empty').hidden = Boolean(names.length && fontsLoaded);
  el('font-empty').textContent = fontsLoadError || (!source ? '等待源文件…' : !names.length ? '该文件未检测到文字字体。' : !fontsLoaded ? '正在读取 Figma 可用字体…' : '');
  if (!names.length || !fontsLoaded) return;
  let missing = 0;
  const fontIndices = new Map(fonts.map((font, fontIndex) => [font, fontIndex]));
  names.forEach((name, index) => {
    const matched = matchFont(name);
    const selected = fontMap[name] || matched;
    if (!matched) missing++;
    const row = document.createElement('div'); row.className = 'font-row';
    const label = document.createElement('label'); label.className = 'font-source'; label.htmlFor = `font-${index}`;
    const sourceName = document.createElement('span'); sourceName.textContent = name;
    const tag = document.createElement('span'); tag.className = matched ? 'font-tag match' : 'font-tag'; tag.textContent = matched ? '已匹配' : '请确认替代字体';
    label.append(sourceName, tag);
    const searchBox = document.createElement('div'); searchBox.className = 'font-search-box';
    const search = document.createElement('input'); search.type = 'search'; search.className = 'font-search-input'; search.id = `font-search-${index}`;
    search.placeholder = '搜索字体名称或字重…'; search.autocomplete = 'off'; search.spellcheck = false;
    search.setAttribute('aria-label', `搜索“${name}”的替换字体`);
    search.setAttribute('aria-controls', `font-${index}`);
    search.value = fontSearchQueries.get(name) || ''; search.disabled = isBusy;
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'text-button font-search-clear'; clear.textContent = '清除';
    clear.setAttribute('aria-label', `清除“${name}”的字体搜索`);
    const resultStatus = document.createElement('div'); resultStatus.className = 'font-search-status'; resultStatus.id = `font-search-status-${index}`;
    resultStatus.setAttribute('role', 'status'); resultStatus.setAttribute('aria-live', 'polite');
    search.setAttribute('aria-describedby', resultStatus.id);
    const select = document.createElement('select'); select.id = `font-${index}`; select.disabled = isBusy;
    select.setAttribute('aria-describedby', resultStatus.id);
    if (selected) fontMap[name] = selected;
    const fillOptions = () => {
      const query = search.value;
      fontSearchQueries.set(name, query);
      const results = filterFonts(fonts, query);
      const retained = fontMap[name];
      const retainedIndex = retained ? fonts.findIndex(font => font.family === retained.family && font.style === retained.style) : -1;
      const retainedFont = retainedIndex >= 0 ? fonts[retainedIndex] : undefined;
      const pinned = Boolean(retainedFont && !results.includes(retainedFont));
      select.replaceChildren();
      const auto = document.createElement('option'); auto.value = ''; auto.textContent = '自动匹配 / 缺失时使用可用替代字体'; select.append(auto);
      const addOption = (font: Font, outsideSearch = false) => {
        const option = document.createElement('option'); option.value = String(fontIndices.get(font));
        option.textContent = `${font.family} · ${font.style}${outsideSearch ? '（当前已选，搜索外）' : ''}`; select.append(option);
      };
      if (pinned && retainedFont) addOption(retainedFont, true);
      results.forEach(font => addOption(font));
      select.value = retainedIndex >= 0 ? String(retainedIndex) : '';
      clear.setAttribute('data-has-query', String(Boolean(query)));
      clear.disabled = isBusy || !query;
      resultStatus.textContent = !query.trim() ? `${fonts.length} 个可用字体样式 · 输入名称筛选，Tab 切换到列表`
        : !results.length ? `没有匹配的字体${pinned ? '；已保留当前选择' : '，请换个关键词'}`
        : `${results.length} 个匹配${pinned ? '；另保留当前选择' : ''}`;
    };
    const clearSearch = () => { search.value = ''; fillOptions(); search.focus(); };
    search.addEventListener('input', fillOptions);
    search.addEventListener('keydown', event => {
      if (event.key === 'Escape' && search.value) { event.preventDefault(); event.stopPropagation(); clearSearch(); }
    });
    clear.addEventListener('click', clearSearch);
    select.addEventListener('change', () => {
      if (select.value === '') delete fontMap[name];
      else fontMap[name] = fonts[Number(select.value)];
      tag.textContent = select.value === '' ? (matched ? '自动匹配' : '自动替代') : '已选择';
      tag.className = 'font-tag match';
      fillOptions();
    });
    fillOptions();
    searchBox.append(search, clear);
    row.append(label, searchBox, select, resultStatus); host.append(row);
  });
  if (missing) {
    el('font-count').textContent = `${names.length} 种 · ${missing} 种需确认`;
    el<HTMLDetailsElement>('font-details').open = true;
  }
}
function clearSource() {
  // Clearing the local input must never cancel an import or delete canvas nodes.
  if (isBusy && !isParsing) return;
  const wasParsing = isParsing;
  ++generation; // Invalidates progress, results, errors and finally blocks from old reads.
  source = undefined; inputFile = undefined; report = undefined; sessionId = '';
  isCancelled = false;
  Object.keys(fontMap).forEach(key => delete fontMap[key]);
  fontSearchQueries.clear();
  el<HTMLInputElement>('file-input').value = '';
  el('file-card').hidden = true; el('drop-zone').hidden = false;
  el('drop-zone').classList.remove('dragover');
  for (const id of ['file-name', 'file-meta', 'file-glyph', 'stat-layers', 'stat-text', 'stat-images', 'stat-groups', 'canvas-size', 'hidden-count']) el(id).textContent = '';
  el('stats').hidden = true; el('canvas-row').hidden = true;
  renderWarnings([]);
  el('log').replaceChildren(); el('log').hidden = true;
  el('report-btn').hidden = true;
  el('status').hidden = true;
  el('status-title').textContent = ''; el('status-detail').textContent = ''; el('status-percent').textContent = '';
  el('progress-bar').style.width = '0'; el('progress-bar').className = 'progress-bar';
  el('status-dot').className = 'status-dot idle';
  el<HTMLDetailsElement>('font-details').open = false;
  renderFonts(); setBusy(false);
  diagnostics?.record('source-cleared', { wasParsing });
  el('drop-zone').focus();
}
async function chooseFile(file: File | undefined) {
  if (!file || isBusy) return;
  if (!/\.(psd|psb|zip)$/i.test(file.name)) {
    showProgress('文件格式不支持', undefined, '请选择 .psd、.psb，或包含 Photoshop 文件的 .zip 压缩包。', 'error');
    return;
  }
  const currentGeneration = ++generation;
  source = undefined; inputFile = file; report = undefined; isCancelled = false;
  Object.keys(fontMap).forEach(key => delete fontMap[key]);
  fontSearchQueries.clear();
  el('report-btn').hidden = true; el('log').replaceChildren(); el('log').hidden = true;
  renderWarnings([]);
  el('drop-zone').hidden = true; el('file-card').hidden = false;
  el('file-name').textContent = file.name;
  el('file-meta').textContent = `${formatBytes(file.size)} · 准备解析`;
  el('file-glyph').textContent = file.name.split('.').pop()!.toUpperCase();
  el('stats').hidden = true; el('canvas-row').hidden = true;
  renderFonts(); setBusy(true, true);
  showProgress('正在读取 Photoshop 文件', undefined, '大型 PSB 解析可能需要较长时间，请保持窗口开启。');
  await waitForPaint();
  if (generation !== currentGeneration) return;
  try {
    const progress = (...args: any[]) => {
      if (generation !== currentGeneration) return;
      const [done, total, label] = args;
      const text = typeof label === 'string' ? label : typeof done === 'string' ? done : '正在解析图层、文字与原始像素…';
      showProgress('正在检查源文件', typeof done === 'number' && typeof total === 'number' && total > 0 ? done / total * 100 : undefined, text);
    };
    const result = await inspectFile(file, progress, () => generation !== currentGeneration);
    if (generation !== currentGeneration) return;
    source = result;
    const info = result.summary;
    el('file-name').textContent = result.name || file.name;
    el('file-meta').textContent = `${formatBytes(file.size)} · 解析完成`;
    el('stat-layers').textContent = String(info.layers);
    el('stat-text').textContent = String(info.textLayers);
    el('stat-images').textContent = String(info.imageLayers);
    el('stat-groups').textContent = String(info.groups);
    el('canvas-size').textContent = `${info.width.toLocaleString()} × ${info.height.toLocaleString()} px`;
    el('hidden-count').textContent = info.hiddenLayers ? ` · ${info.hiddenLayers} 个隐藏图层${el<HTMLInputElement>('include-hidden').checked ? '（保留）' : '（将跳过）'}` : '';
    el('stats').hidden = false; el('canvas-row').hidden = false;
    renderWarnings(info.warnings || []);
    renderFonts();
    showProgress('已准备好导入', undefined, '确认字体与还原选项后，点击下方按钮。', 'idle');
  } catch (error) {
    if (generation !== currentGeneration) return;
    const message = error instanceof Error ? error.message : String(error);
    el('file-meta').textContent = `${formatBytes(file.size)} · 解析未完成`;
    showProgress('无法读取文件', undefined, message, 'error');
    addLog(message, 'error');
  } finally {
    if (generation === currentGeneration) setBusy(false);
  }
}
async function startImport() {
  if (!source || isBusy) return;
  const original = source;
  sessionId = `psd-${requestNonce}-${Date.now()}-${++requestSequence}`;
  isCancelled = false; report = undefined;
  el('report-btn').hidden = true;
  el('log').replaceChildren(); el('log').hidden = true;
  setBusy(true);
  const options = {
    includeHidden: el<HTMLInputElement>('include-hidden').checked,
    includeComposite: el<HTMLInputElement>('include-reference').checked,
    rasterizeGradients: el<HTMLInputElement>('rasterize-gradients').checked,
  };
  const importOptions = {
    includeReference: options.includeComposite,
    keepTextBackup: el<HTMLInputElement>('keep-text-backup').checked,
    fontMap: { ...fontMap },
  };
  const skippedHidden = options.includeHidden ? 0 : original.summary.hiddenLayers;
  if (skippedHidden) addLog(`本次将跳过 ${skippedHidden} 个隐藏图层（包含隐藏组的所有子图层）。`);
  const started = Date.now();
  showProgress('正在检查 Figma 连接', 0, '检查面板与主程序的往返通信（最多 8 秒）…');
  try {
    const host = await request('ping', { sessionId }, 8_000);
    if (host?.version !== '0.1.4' || host?.handlerRegistered !== true) throw new Error('主程序与面板版本不匹配，请重新导入完整的 0.1.4 安装包。');
    if (isCancelled) throw new Error('导入已取消');
    showProgress('正在准备导入', 0, '建立 Figma 导入会话…');
    await request('begin', { sessionId, name: original.name.replace(/\.(psd|psb)$/i, ''), width: original.summary.width, height: original.summary.height }, 8_000);
    if (isCancelled) throw new Error('导入已取消');
    addLog(`原始画布：${original.summary.width} × ${original.summary.height} px`);
    const document = await convertPsd(original.psd, original.name, options, {
      onAsset: async (assetId, bytes) => {
        if (isCancelled) throw new Error('导入已取消');
        await request('asset', { sessionId, assetId, bytes });
      },
      onProgress: (done, total, label) => {
        if (!isCancelled) showProgress('正在转换图层', total > 0 ? Math.min(done / total, 1) * 65 : undefined, label || '保留原始像素与可编辑内容…');
      },
      isCancelled: () => isCancelled,
    });
    if (isCancelled) throw new Error('导入已取消');
    for (const issue of document.report ?? []) if (issue.code === 'HIDDEN_LAYERS_SKIPPED') addLog(issue.message);
    addLog(`转换完成，发现 ${document.report?.length || 0} 项还原记录。`);
    showProgress('正在写入 Figma', 65, '构建画布、图层与可编辑文字…');
    const result = await request('import', { sessionId, document, options: importOptions }, 30 * 60_000);
    if (isCancelled) throw new Error('导入已取消');
    report = {
      tool: 'PSD to Figma', version: '0.1.4', createdAt: new Date().toISOString(),
      source: { name: original.name, size: inputFile?.size, ...original.summary },
      options: { ...options, ...importOptions },
      durationSeconds: Math.round((Date.now() - started) / 1000),
      diagnostics: diagnostics?.state,
      conversion: document.report,
      sourceStructure: document.layers,
      figma: result,
    };
    el('report-btn').hidden = false;
    showProgress('导入完成', 100, '已在当前页面创建画布。可下载报告，核对字体替换与效果兼容情况。', 'success');
    addLog(`已完成，用时 ${Math.round((Date.now() - started) / 1000)} 秒。`, 'success');
    const issues = Array.isArray(result?.issues) ? result.issues : Array.isArray(result?.report) ? result.report : [];
    for (const issue of issues.slice(0, 8)) addLog(typeof issue === 'string' ? issue : issue.message || JSON.stringify(issue));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showProgress(isCancelled ? '已取消导入' : '导入未完成', undefined, isCancelled ? '已停止发送和等待，并已请求 Figma 取消本轮导入。若重试提示忙，请稍候。' : message, isCancelled ? 'idle' : 'error');
    addLog(message, isCancelled ? '' : 'error');
    // Release any assets from a failed conversion before starting another import.
    if (!isCancelled) void request('cancel', { sessionId }, 30_000).catch(() => {});
    report = { tool: 'PSD to Figma', version: '0.1.4', createdAt: new Date().toISOString(), source: { name: original.name, ...original.summary }, options: { ...options, ...importOptions }, cancelled: isCancelled, error: message, diagnostics: diagnostics?.state };
    el('report-btn').hidden = false;
  } finally {
    setBusy(false);
  }
}
const openPicker = () => { if (!isBusy) el<HTMLInputElement>('file-input').click(); };
el('drop-zone').addEventListener('click', openPicker);
el('replace-btn').addEventListener('click', openPicker);
el('clear-source-btn').addEventListener('click', clearSource);
el('drop-zone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker(); } });
el<HTMLInputElement>('file-input').addEventListener('change', event => { const input = event.currentTarget as HTMLInputElement; void chooseFile(input.files?.[0]); input.value = ''; });
for (const eventName of ['dragenter', 'dragover']) document.addEventListener(eventName, event => { event.preventDefault(); if (!isBusy) el('drop-zone').classList.add('dragover'); });
for (const eventName of ['dragleave', 'drop']) document.addEventListener(eventName, event => { event.preventDefault(); el('drop-zone').classList.remove('dragover'); });
document.addEventListener('drop', event => { if (!isBusy) void chooseFile(event.dataTransfer?.files[0]); });
el('include-hidden').addEventListener('change', () => {
  renderFonts();
  const hidden = source?.summary.hiddenLayers ?? 0;
  el('hidden-count').textContent = hidden ? ` · ${hidden} 个隐藏图层${el<HTMLInputElement>('include-hidden').checked ? '（保留）' : '（将跳过）'}` : '';
});
el('import-btn').addEventListener('click', () => { void startImport(); });
el('cancel-btn').addEventListener('click', () => {
  if (!isBusy || isCancelled) return;
  isCancelled = true;
  // Reject current-session waits now, rather than waiting up to 30 minutes
  // for an import ACK that may never arrive. Late ACKs are ignored.
  for (const [id, item] of pending) {
    if (item.sessionId !== sessionId) continue;
    clearTimeout(item.timer); pending.delete(id); item.reject(new Error('导入已取消'));
  }
  el<HTMLButtonElement>('cancel-btn').disabled = true; el('cancel-btn').textContent = '停止中…';
  el('status-detail').textContent = '正在停止当前步骤并清理本次导入…';
  const cancelledSession = sessionId;
  void request('cancel', { sessionId: cancelledSession }, 30_000).catch(error => { if (sessionId === cancelledSession) addLog(error.message); });
});
el('report-btn').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${(source?.name || 'PSD').replace(/\.(psd|psb|zip)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-还原报告.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
void request('ping', {}, 8_000).then(host => {
  if (host?.version !== '0.1.4' || host?.handlerRegistered !== true) throw new Error('主程序版本不匹配，请重新导入完整的 0.1.4 安装包。');
  fontsRequested = true;
  if (diagnostics) diagnostics.state.fontState = 'requesting';
  return request<Font[] | { fonts: Font[] }>('fonts', {}, 15_000);
}).then(result => {
  const availableFonts = Array.isArray(result) ? result : result?.fonts;
  fonts = (Array.isArray(availableFonts) ? availableFonts : []).filter(font => font && typeof font.family === 'string' && typeof font.style === 'string');
  fonts.sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
  fontsLoaded = true;
  if (diagnostics) diagnostics.state.fontState = 'loaded';
  renderFonts();
}).catch(error => {
  if (diagnostics) { diagnostics.state.fontState = fontsRequested ? 'failed' : 'not-started-connection-failed'; diagnostics.record(fontsRequested ? 'fonts-failed' : 'connection-failed-before-fonts', error.message); }
  fontsLoadError = fontsRequested
    ? `字体列表读取失败：${error.message}。导入时将尝试自动匹配。`
    : `尚未连接 Figma 主程序，未开始读取字体。${error.message} 请查看上方连接诊断。`;
  renderFonts();
});
