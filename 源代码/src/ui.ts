import { inspectFile, convertPsd } from './pipeline';
import { filterFonts } from './font-search';
import { createJobs, type QueueJob } from './queue';

declare global { interface Window { __PSD_DIAGNOSTICS__?: { state: any; record: (stage: string, detail?: unknown) => void; sourceKind: (event: MessageEvent) => string } } }
const diagnostics = window.__PSD_DIAGNOSTICS__;
if (diagnostics) { diagnostics.state.uiScript = 'loaded'; diagnostics.record('application-loaded', { version: '0.1.6' }); }

type Font = { family: string; style: string };
type Source = Awaited<ReturnType<typeof inspectFile>>;
type Pending = { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout>; sessionId?: string; type: string };
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
let sessionSequence = 0;
let fonts: Font[] = [];
let fontsLoaded = false;
let fontsRequested = false;
let fontsLoadError = '';
let generation = 0;
let report: unknown;
const fontMap: Record<string, Font> = Object.create(null);
const fontSearchQueries = new Map<string, string>();
const confirmedFonts = new Set<string>();
let jobs: QueueJob[] = [];
let activeJob: QueueJob | undefined;
let queueRunning = false;
let awaitingFonts = false;
let stopRequested = false;
let blocked = false;
let closing = false;
let pendingClear = false;
let batchId = '';
let targetPageId: string | undefined;
let cancelPromise: Promise<any> | undefined;
let fontContinuation: (() => void) | undefined;
let batchOptions: { includeHidden: boolean; includeComposite: false; rasterizeGradients: boolean; keepTextBackup: boolean } | undefined;
class BridgeError extends Error { uncertain = false; terminal?: any; }

const request = <T = any>(type: string, payload: Record<string, unknown> = {}, timeout = 180_000): Promise<T> => {
  const requestId = `ui-${requestNonce}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      diagnostics?.record('request-timeout', { type, timeout });
      const error = new BridgeError(type === 'ping' || type === 'begin'
        ? `Figma 通信未响应（${type}）；尚未开始图层转换。请关闭旧插件，再从新版 manifest.json 重新打开。`
        : `Figma 响应超时（${type}）。本次操作已停止等待，请检查 Figma 插件控制台。`); error.uncertain = true; reject(error);
    }, timeout);
    pending.set(requestId, { resolve, reject, timer, type, sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined });
    diagnostics?.record('request-sent', { type, requestId });
    try { parent.postMessage({ pluginMessage: { type, requestId, ...payload } }, '*'); }
    catch (error) {
      clearTimeout(timer); pending.delete(requestId);
      const failure = new BridgeError(`Figma 消息发送失败（${type}）：${errorText(error)}`);
      failure.uncertain = true; reject(failure);
    }
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
    else { const error = new BridgeError(typeof message.error === 'string' ? message.error : 'Figma 操作未完成'); error.terminal = message.result; item.reject(error); }
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
  if (activeJob && value != null) { activeJob.progress = Math.max(activeJob.progress, Math.min(99, value)); renderQueue(); }
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
  const locked = value || blocked || closing;
  const waitingCatalog = !fontsLoaded && !fontsLoadError && sourceFonts().length > 0;
  const fontLocked = (value && !awaitingFonts) || blocked || !fontsLoaded;
  const clear = el<HTMLButtonElement>('clear-source-btn');
  clear.disabled = blocked || closing || (value && (!parsing || queueRunning));
  clear.title = clear.disabled ? '请先取消或等待当前任务安全结束' : '清空队列，不删除原文件或已导入的 Figma 图层';
  el<HTMLButtonElement>('import-btn').disabled = locked || waitingCatalog || !jobs.some(job => ['queued','ready','cancelled'].includes(job.status) && job.file);
  el<HTMLButtonElement>('replace-btn').disabled = locked;
  el<HTMLInputElement>('file-input').disabled = locked;
  el('drop-zone').classList.toggle('disabled', locked);
  el('drop-zone').setAttribute('aria-disabled', String(locked));
  el('cancel-btn').hidden = !value;
  el<HTMLButtonElement>('cancel-btn').disabled = isCancelled || blocked;
  el('cancel-btn').textContent = isCancelled ? '等待停止…' : '取消当前';
  el('stop-all-btn').hidden = !queueRunning;
  el<HTMLButtonElement>('stop-all-btn').disabled = stopRequested || blocked;
  el('retry-btn').hidden = !jobs.some(job => job.status === 'failed' && job.retryable && job.file);
  el<HTMLButtonElement>('retry-btn').disabled = locked;
  el('confirm-fonts-btn').hidden = !awaitingFonts;
  el<HTMLButtonElement>('confirm-fonts-btn').disabled = isCancelled || blocked || waitingCatalog;
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('.option input'))) input.disabled = locked || Boolean(batchOptions);
  for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>('.font-row select'))) select.disabled = fontLocked;
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('.font-search-input'))) input.disabled = fontLocked;
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('.font-search-clear'))) button.disabled = fontLocked || button.getAttribute('data-has-query') !== 'true';
  el('import-label').textContent = blocked ? '等待宿主终态，队列已锁定' : value ? (awaitingFonts ? '等待字体确认…' : parsing ? '正在读取文件…' : '队列处理中…') : waitingCatalog ? '正在读取可用字体…' : jobs.some(job => ['queued','ready','cancelled'].includes(job.status) && job.file) ? '开始 / 继续串行导入' : '选择文件以开始';
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
    if (!matched && !confirmedFonts.has(name)) missing++;
    const row = document.createElement('div'); row.className = 'font-row';
    const label = document.createElement('label'); label.className = 'font-source'; label.htmlFor = `font-${index}`;
    const sourceName = document.createElement('span'); sourceName.textContent = name;
    const tag = document.createElement('span'); tag.className = matched || confirmedFonts.has(name) ? 'font-tag match' : 'font-tag'; tag.textContent = confirmedFonts.has(name) ? '本批已确认' : matched ? '已匹配' : '请确认替代字体';
    label.append(sourceName, tag);
    const searchBox = document.createElement('div'); searchBox.className = 'font-search-box';
    const search = document.createElement('input'); search.type = 'search'; search.className = 'font-search-input'; search.id = `font-search-${index}`;
    search.placeholder = '搜索字体名称或字重…'; search.autocomplete = 'off'; search.spellcheck = false;
    search.setAttribute('aria-label', `搜索“${name}”的替换字体`);
    search.setAttribute('aria-controls', `font-${index}`);
    search.value = fontSearchQueries.get(name) || ''; search.disabled = isBusy && !awaitingFonts;
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'text-button font-search-clear'; clear.textContent = '清除';
    clear.setAttribute('aria-label', `清除“${name}”的字体搜索`);
    const resultStatus = document.createElement('div'); resultStatus.className = 'font-search-status'; resultStatus.id = `font-search-status-${index}`;
    resultStatus.setAttribute('role', 'status'); resultStatus.setAttribute('aria-live', 'polite');
    search.setAttribute('aria-describedby', resultStatus.id);
    const select = document.createElement('select'); select.id = `font-${index}`; select.disabled = isBusy && !awaitingFonts;
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
      clear.disabled = (isBusy && !awaitingFonts) || !query;
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
const statusLabels: Record<QueueJob['status'], string> = { queued: '等待', ready: '已就绪', reading: '读取中', fonts: '等待字体确认', converting: '转换中', importing: '写入 Figma', success: '成功', failed: '失败', cancelled: '已取消' };
function renderQueue() {
  el('queue-panel').hidden = !jobs.length;
  const host = el('queue-list'); host.replaceChildren();
  const completed = jobs.filter(job => ['success','failed','cancelled'].includes(job.status)).length;
  const success = jobs.filter(job => job.status === 'success').length;
  const failed = jobs.filter(job => job.status === 'failed').length;
  const cancelled = jobs.filter(job => job.status === 'cancelled').length;
  const percent = jobs.length ? Math.round((completed + (activeJob && !['success','failed','cancelled'].includes(activeJob.status) ? activeJob.progress / 100 : 0)) / jobs.length * 100) : 0;
  el('queue-summary').textContent = `${completed} / ${jobs.length} 项已结束 · 成功 ${success} · 失败 ${failed} · 取消 ${cancelled}`;
  el('queue-percent').textContent = `${percent}%`;
  el('queue-progress').style.width = `${percent}%`;
  for (const job of jobs) {
    const row = document.createElement('li'); row.className = `queue-item ${job.status}`;
    row.setAttribute('data-job-id', job.id); row.setAttribute('data-status', job.status);
    const name = document.createElement('span'); name.className = 'queue-name'; name.textContent = job.name;
    const state = document.createElement('span'); state.className = 'queue-state'; state.textContent = statusLabels[job.status];
    const detail = document.createElement('div'); detail.className = 'queue-detail'; detail.textContent = job.error || `${formatBytes(job.size)} · 画板：${job.displayName}${job.attempts > 1 ? ` · 第 ${job.attempts} 次尝试` : ''}`;
    row.append(name, state, detail); host.append(row);
  }
}
function resetDisplay() {
  source = undefined; inputFile = undefined; report = undefined; sessionId = ''; activeJob = undefined;
  jobs = []; batchId = ''; targetPageId = undefined; batchOptions = undefined;
  isCancelled = false; stopRequested = false; pendingClear = false; cancelPromise = undefined;
  Object.keys(fontMap).forEach(key => delete fontMap[key]); confirmedFonts.clear(); fontSearchQueries.clear();
  el<HTMLInputElement>('file-input').value = '';
  el('file-card').hidden = true; el('drop-zone').hidden = false;
  el('drop-zone').classList.remove('dragover');
  for (const id of ['file-name','file-meta','file-glyph','stat-layers','stat-text','stat-images','stat-groups','canvas-size','hidden-count']) el(id).textContent = '';
  el('stats').hidden = true; el('canvas-row').hidden = true;
  renderWarnings([]); el('log').replaceChildren(); el('log').hidden = true;
  el('report-btn').hidden = true; el('status').hidden = true;
  el('status-title').textContent = ''; el('status-detail').textContent = ''; el('status-percent').textContent = '';
  el('progress-bar').style.width = '0'; el('progress-bar').className = 'progress-bar';
  el('status-dot').className = 'status-dot idle'; el<HTMLDetailsElement>('font-details').open = false;
  renderFonts(); renderQueue(); setBusy(false);
}
function clearSource() {
  if (blocked || closing || queueRunning || (isBusy && !isParsing)) return;
  if (isParsing) {
    // A File.arrayBuffer()/synchronous parser cannot be forcibly interrupted.
    // Keep the read lock until it settles so a new batch cannot overlap it.
    pendingClear = true; isCancelled = true; ++generation;
    showProgress('正在清空', undefined, '等待读取停止后清空队列；此时不会读取下一份文件。');
    setBusy(true, true); return;
  }
  ++generation; resetDisplay(); diagnostics?.record('source-cleared', { wasParsing: false }); el('drop-zone').focus();
}
function displaySource(job: QueueJob, result?: Source) {
  el('drop-zone').hidden = true; el('file-card').hidden = false;
  el('file-name').textContent = job.name;
  el('file-meta').textContent = `${formatBytes(job.size)} · ${statusLabels[job.status]}`;
  el('file-glyph').textContent = job.name.split('.').pop()!.toUpperCase();
  el('stats').hidden = !result; el('canvas-row').hidden = !result;
  if (!result) { renderWarnings([]); renderFonts(); return; }
  const info = result.summary;
  el('stat-layers').textContent = String(info.layers); el('stat-text').textContent = String(info.textLayers);
  el('stat-images').textContent = String(info.imageLayers); el('stat-groups').textContent = String(info.groups);
  el('canvas-size').textContent = `${info.width.toLocaleString()} × ${info.height.toLocaleString()} px`;
  el('hidden-count').textContent = info.hiddenLayers ? ` · ${info.hiddenLayers} 个隐藏图层${el<HTMLInputElement>('include-hidden').checked ? '（保留）' : '（将跳过）'}` : '';
  renderWarnings(info.warnings || []); renderFonts();
}
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function requiresPause(error: unknown) {
  return (error instanceof BridgeError && error.uncertain) || /out of memory|allocation|heap|内存|timeout|timed out|超时|主程序.*不匹配|通信未响应|失联|身份不匹配|已有导入|会话已过期|目标页面.*(不可用|已删除)/i.test(errorText(error));
}
async function prepareJob(job: QueueJob) {
  if (!job.file) throw new Error('请重新选择此文件。');
  const token = generation;
  source = undefined; inputFile = job.file; activeJob = job; job.status = 'reading'; job.progress = 0;
  displaySource(job); renderQueue(); setBusy(true, true);
  showProgress('正在读取 Photoshop 文件', 0, '一次只读取一份文件；大型文件可能需要较长时间，请保持插件开启。');
  await waitForPaint();
  if (isCancelled || token !== generation || closing) throw new Error('源文件读取已取消');
  const result = await inspectFile(job.file, message => {
    if (token === generation && !isCancelled && activeJob === job) showProgress('正在检查源文件', undefined, message);
  }, () => isCancelled || token !== generation || closing);
  if (isCancelled || token !== generation || closing) throw new Error('源文件读取已取消');
  source = result; job.status = 'ready'; displaySource(job, result); renderQueue();
}
async function chooseFiles(files: readonly File[] | FileList | undefined) {
  if (!files?.length || isBusy || queueRunning || blocked || closing) return;
  const selected = Array.from(files); // FileList is live; resetDisplay clears the input.
  resetDisplay(); ++generation;
  batchId = `batch-${requestNonce}-${++requestSequence}`;
  jobs = createJobs(selected, () => `job-${requestNonce}-${++requestSequence}`);
  const first = jobs.find(job => job.status === 'queued');
  renderQueue();
  if (!first) {
    el('file-card').hidden = false; el('drop-zone').hidden = true;
    el('file-name').textContent = `${jobs.length} 份文件未通过检查`;
    showProgress('文件检查未通过', undefined, '请查看队列错误后重新选择文件；未读取这些文件的内容。', 'error');
    updateReport(); setBusy(false); return;
  }
  try {
    await prepareJob(first);
    showProgress('已准备好导入', undefined, `已选 ${jobs.length} 份；确认选项与第一份字体后启动。其余文件按顺序读取。`, 'idle');
  } catch (error) {
    first.status = isCancelled ? 'cancelled' : 'failed'; first.error = errorText(error);
    source = undefined; inputFile = undefined;
    if (requiresPause(error)) stopRequested = true;
    showProgress(isCancelled ? '已取消读取' : '无法读取文件', undefined, first.error, isCancelled ? 'idle' : 'error');
    updateReport();
  } finally {
    activeJob = undefined;
    if (pendingClear) { resetDisplay(); el('drop-zone').focus(); }
    else { isCancelled = false; renderQueue(); setBusy(false); }
  }
}
async function chooseFile(file: File | undefined) { if (file) await chooseFiles([file]); }
function sourceFonts() {
  return (batchOptions?.includeHidden ?? el<HTMLInputElement>('include-hidden').checked) ? source?.summary.fonts || [] : source?.summary.visibleFonts || [];
}
function confirmCurrentFonts() {
  if (!fontsLoaded && !fontsLoadError && sourceFonts().length) return;
  for (const name of sourceFonts()) {
    // Preserve the selected mapping (including Auto) across this batch. Auto
    // continues to use the importer's existing font resolution algorithm.
    confirmedFonts.add(name);
  }
  fontContinuation?.(); fontContinuation = undefined;
}
async function waitForFonts() {
  const missing = sourceFonts().filter(name => !matchFont(name) && !confirmedFonts.has(name));
  if (!missing.length) return;
  awaitingFonts = true; activeJob!.status = 'fonts'; renderFonts(); renderQueue(); setBusy(true);
  showProgress('请确认新增缺失字体', undefined, `此文件新增 ${missing.length} 种未确认字体。选择替代字体后继续，本批后续文件会复用。`, 'idle');
  await new Promise<void>(resolve => { fontContinuation = resolve; });
  awaitingFonts = false; setBusy(true);
  if (isCancelled || closing) throw new Error('导入已取消');
}
function rejectSessionWaits(id: string) {
  for (const [key, item] of pending) {
    if (item.sessionId !== id || item.type === 'cancel') continue;
    clearTimeout(item.timer); pending.delete(key); item.reject(new Error('导入已取消'));
  }
}
function requestTerminal() {
  if (!cancelPromise) {
    cancelPromise = request('cancel', { sessionId, clientId: requestNonce, sessionSequence }, 30_000);
    // Install a handler immediately, including while a synchronous conversion
    // yields later, so a rejected cancellation cannot become unhandled.
    void cancelPromise.catch(() => {});
  }
  return cancelPromise;
}
function cancelCurrent(stopAll = false) {
  if (!isBusy || blocked) return;
  if (stopAll) stopRequested = true;
  isCancelled = true; fontContinuation?.(); fontContinuation = undefined;
  if (sessionId) { rejectSessionWaits(sessionId); void requestTerminal(); }
  showProgress('正在停止当前任务', undefined, '等待本次读取、导入及回滚结束；此前成功的内容会保留。');
  setBusy(true, isParsing); renderQueue();
}
function compactResult(value: any) {
  return { frameId: value?.frameId, frameIds: Array.isArray(value?.frameIds) ? value.frameIds.slice(0, 1000) : undefined,
    counts: value?.counts ? { ...value.counts } : undefined,
    missingFonts: Array.isArray(value?.missingFonts) ? value.missingFonts.slice(0,100) : undefined,
    layerCount: value?.layerCount, issues: (Array.isArray(value?.issues) ? value.issues : Array.isArray(value?.report) ? value.report : []).slice(0, 100) };
}
function rememberAutoFonts(value: any) {
  if (!Array.isArray(value?.missingFonts)) return;
  for (const substitution of value.missingFonts) {
    const name = substitution?.source, font = substitution?.replacement;
    if (typeof name === 'string' && confirmedFonts.has(name) && !fontMap[name] &&
      typeof font?.family === 'string' && typeof font?.style === 'string') {
      fontMap[name] = {family:font.family,style:font.style};
    }
  }
}
function updateReport() {
  report = { tool: 'PSD to Figma', version: '0.1.6', createdAt: new Date().toISOString(), batchId, targetPageId,
    options: batchOptions ? { ...batchOptions, includeReference: false } : undefined,
    files: jobs.map(({id,name,displayName,size,status,error,attempts,report: detail}) => ({id,name,displayName,size,status,error,attempts,...detail})),
    summary: { total: jobs.length, success: jobs.filter(job => job.status === 'success').length, failed: jobs.filter(job => job.status === 'failed').length, cancelled: jobs.filter(job => job.status === 'cancelled').length },
    note: '报告保留精简统计与最多100条逐文件兼容提示，不保留像素或完整图层树。Figma 已导入内容与图片缓存仍会累计。' };
  el('report-btn').hidden = false;
}
async function runJob(job: QueueJob, firstConfirmed: boolean) {
  activeJob = job; isCancelled = false; cancelPromise = undefined; job.error = undefined; job.attempts++;
  const started = Date.now(); let document: Awaited<ReturnType<typeof convertPsd>> | undefined;
  let hostMayHaveSession = false;
  sessionSequence = ++requestSequence;
  sessionId = `psd-${requestNonce}-${sessionSequence}`;
  try {
    if (!source || inputFile !== job.file || job.status !== 'ready') await prepareJob(job);
    else displaySource(job, source);
    if (!firstConfirmed) await waitForFonts();
    if (isCancelled || closing) throw new Error('导入已取消');
    setBusy(true); showProgress('正在检查 Figma 连接', 0, '检查面板与主程序的往返通信（最多 8 秒）…');
    const host = await request('ping', {sessionId}, 8_000);
    if (host?.version !== '0.1.6' || host?.handlerRegistered !== true) throw new Error('主程序与面板版本不匹配，请重新导入完整的 0.1.6 安装包。');
    if (isCancelled || closing) throw new Error('导入已取消');
    hostMayHaveSession = true;
    const begun = await request('begin', {sessionId, clientId: requestNonce, sessionSequence, batchId, name: job.displayName, width: source!.summary.width, height: source!.summary.height}, 8_000);
    targetPageId = begun?.targetPageId || targetPageId;
    if (isCancelled || closing) throw new Error('导入已取消');
    job.status = 'converting'; renderQueue();
    const options = batchOptions!;
    document = await convertPsd(source!.psd, source!.name, options, {
      onAsset: async (assetId, bytes) => { if (isCancelled || closing) throw new Error('导入已取消'); await request('asset', {sessionId,assetId,bytes}); },
      onProgress: (done,total,label) => { if (!isCancelled && !closing) showProgress('正在转换图层', total > 0 ? Math.min(done / total, 1) * 65 : undefined, label || '保留原始像素与可编辑内容…'); },
      isCancelled: () => isCancelled || closing,
    });
    document.name = job.displayName;
    if (isCancelled || closing) throw new Error('导入已取消');
    job.status = 'importing'; renderQueue(); showProgress('正在写入 Figma', 65, '构建画布、图层与可编辑文字…');
    const result = await request('import', {sessionId,document,options:{includeReference:false,keepTextBackup:options.keepTextBackup,fontMap:{...fontMap}}}, 30 * 60_000);
    // An import ACK means commit is complete. A cancellation arriving after
    // that point must preserve and report success, never roll it back.
    if (result?.terminal !== true || result?.status !== 'success') {
      const error = new BridgeError('宿主未明确确认导入成功终态。'); error.uncertain = true; throw error;
    }
    job.status = 'success'; job.progress = 100;
    rememberAutoFonts(result);
    job.report = { source: {name:source!.name,width:source!.summary.width,height:source!.summary.height,layers:source!.summary.layers},
      durationSeconds: Math.round((Date.now()-started)/1000), fontMap:{...fontMap}, conversion:document.report.slice(0,100), figma:compactResult(result) };
    addLog(`${job.name}：导入成功。`, 'success');
  } catch (error) {
    let terminal: any;
    const wasCancelled = isCancelled || closing;
    if (hostMayHaveSession || cancelPromise) {
      try {
        terminal = await requestTerminal();
        if (terminal?.terminal !== true || !['success','failed','cancelled'].includes(terminal?.status)) throw new Error(terminal?.error || '未收到取消 / 回滚完成确认。');
      } catch (terminalError) {
        blocked = true; stopRequested = true;
        job.error = `${errorText(error)}；${errorText(terminalError)} 队列已锁定，请保持插件打开并检查 Figma；不要重复导入。`;
      }
    }
    if (terminal?.terminal === true && terminal.status === 'success') {
      rememberAutoFonts(terminal.result);
      job.status = 'success'; job.progress = 100; job.report = {figma:compactResult(terminal.result),note:'取消请求到达时当前文件已提交，成功内容已保留。'};
    } else {
      job.status = wasCancelled ? 'cancelled' : 'failed';
      job.error ||= errorText(error); addLog(`${job.name}：${job.error}`, wasCancelled ? '' : 'error');
    }
    if (!wasCancelled && requiresPause(error)) stopRequested = true;
  } finally {
    // Queue entries retain only retryable File handles and compact summaries.
    // No decoded PSD, source bytes, BridgeDocument tree or PNG arrays survive.
    document = undefined; source = undefined; inputFile = undefined; sessionId = ''; cancelPromise = undefined;
    fontContinuation = undefined; awaitingFonts = false; activeJob = undefined;
    fontSearchQueries.clear();
    if (job.status === 'success') job.file = undefined;
    el('file-meta').textContent = `${formatBytes(job.size)} · ${statusLabels[job.status]}`;
    updateReport(); renderFonts(); renderQueue();
  }
}
async function startImport(retryOnly = false) {
  if (isBusy || queueRunning || blocked || closing) return;
  if (!fontsLoaded && !fontsLoadError && sourceFonts().length) return;
  if (!jobs.some(job => ['ready','queued','cancelled'].includes(job.status) && job.file)) return;
  queueRunning = true; stopRequested = false; isCancelled = false;
  batchOptions ||= {includeHidden:el<HTMLInputElement>('include-hidden').checked,includeComposite:false,rasterizeGradients:el<HTMLInputElement>('rasterize-gradients').checked,keepTextBackup:el<HTMLInputElement>('keep-text-backup').checked};
  const prepared = jobs.find(job => job.status === 'ready' && job.file === inputFile);
  if (prepared) confirmCurrentFonts();
  if (!retryOnly) for (const job of jobs) if (job.status === 'cancelled' && job.file) { job.status = 'queued'; job.error = undefined; job.progress = 0; }
  setBusy(true); renderQueue();
  try {
    for (const job of jobs) {
      if (stopRequested || blocked || closing) break;
      if (!['queued','ready'].includes(job.status) || !job.file) continue;
      await runJob(job, job === prepared);
    }
  } finally {
    if (stopRequested || closing) for (const job of jobs) if (['queued','ready'].includes(job.status)) job.status = 'cancelled';
    queueRunning = false; isCancelled = false; activeJob = undefined;
    updateReport(); renderQueue(); setBusy(false);
    const summary = jobs.map(job=>job.status);
    if (blocked) showProgress('队列已锁定', undefined, '宿主取消 / 回滚终态尚未确认。为避免重叠导入，不能清空或继续。请检查 Figma 状态。', 'error');
    else if (closing) return;
    else if (stopRequested) showProgress('队列已停止', undefined, '此前成功的内容已保留。可继续未完成项，或清空后选择新批次。', 'idle');
    else if (summary.every(status=>status==='success')) showProgress(jobs.length===1?'导入完成':'队列导入完成', 100, '成功内容已保留。每文件解析数据已释放引用；实际画布与 Figma 图片缓存仍会累计。', 'success');
    else showProgress('队列处理完成', 100, '请查看逐文件结果。失败项可重试；已成功内容不会再次导入。', summary.includes('failed')?'error':'idle');
  }
}
async function retryFailed() {
  if (isBusy || queueRunning || blocked || closing) return;
  let changed = false;
  for (const job of jobs) if (job.status === 'failed' && job.retryable && job.file) {job.status='queued';job.progress=0;job.error=undefined;changed=true;}
  if (changed) await startImport(true);
}
const openPicker = () => { if (!isBusy && !blocked && !closing) el<HTMLInputElement>('file-input').click(); };
el('drop-zone').addEventListener('click', openPicker); el('replace-btn').addEventListener('click', openPicker);
el('clear-source-btn').addEventListener('click', clearSource);
el('drop-zone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();openPicker();} });
el<HTMLInputElement>('file-input').addEventListener('change', event => {const input=event.currentTarget as HTMLInputElement;void chooseFiles(input.files || undefined);input.value='';});
for (const eventName of ['dragenter','dragover']) document.addEventListener(eventName,event=>{event.preventDefault();if(!isBusy&&!blocked)el('drop-zone').classList.add('dragover');});
for (const eventName of ['dragleave','drop']) document.addEventListener(eventName,event=>{event.preventDefault();el('drop-zone').classList.remove('dragover');});
document.addEventListener('drop',event=>{if(!isBusy&&!blocked)void chooseFiles(event.dataTransfer?.files);});
el('include-hidden').addEventListener('change',()=>{renderFonts();if(source&&jobs.length)displaySource(jobs.find(job=>job.file===inputFile)!,source);});
el('import-btn').addEventListener('click',()=>{void startImport();});
el('cancel-btn').addEventListener('click',()=>cancelCurrent());
el('stop-all-btn').addEventListener('click',()=>cancelCurrent(true));
el('retry-btn').addEventListener('click',()=>{void retryFailed();});
el('confirm-fonts-btn').addEventListener('click',confirmCurrentFonts);
window.addEventListener('pagehide',()=>{closing=true;stopRequested=true;if(isBusy)cancelCurrent(true);});
el('report-btn').addEventListener('click',()=>{
  if(!report)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='PSD-串行导入报告.json';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
void request('ping',{},8_000).then(host=>{
  if(host?.version!=='0.1.6'||host?.handlerRegistered!==true)throw new Error('主程序版本不匹配，请重新导入完整的 0.1.6 安装包。');
  fontsRequested=true;if(diagnostics)diagnostics.state.fontState='requesting';return request<Font[]|{fonts:Font[]}>('fonts',{},15_000);
}).then(result=>{
  const availableFonts=Array.isArray(result)?result:result?.fonts;
  fonts=(Array.isArray(availableFonts)?availableFonts:[]).filter(font=>font&&typeof font.family==='string'&&typeof font.style==='string');
  fonts.sort((a,b)=>a.family.localeCompare(b.family)||a.style.localeCompare(b.style));fontsLoaded=true;
  if(diagnostics)diagnostics.state.fontState='loaded';renderFonts();setBusy(isBusy,isParsing);
}).catch(error=>{
  if(diagnostics){diagnostics.state.fontState=fontsRequested?'failed':'not-started-connection-failed';diagnostics.record(fontsRequested?'fonts-failed':'connection-failed-before-fonts',error.message);}
  fontsLoadError=fontsRequested?`字体列表读取失败：${error.message}。确认后将尝试自动匹配。`:`尚未连接 Figma 主程序，未开始读取字体。${error.message}`;renderFonts();setBusy(isBusy,isParsing);
});
