import { importDocument, ImportRollbackError, type ImportOptions, type ImportResult } from './importer';
import type { BridgeDocument } from './types';

declare const __html__: string;
type Terminal = { terminal: boolean; status: 'success' | 'failed' | 'cancelled' | 'unknown'; error?: string; result?: { frameId: string; counts: ImportResult['counts']; targetPageId?: string } };
interface Session {
  id: string; sequence: number; name: string; width: number; height: number; hashes: Record<string, string>;
  cancelled: boolean; importing: boolean; bytes: number; page: PageNode;
  finished: Promise<Terminal>; finish: (value: Terminal) => void; blocked?: Terminal;
}
interface UiMessage { type?: string; requestId?: unknown; sessionId?: string; clientId?: string; sessionSequence?: number; batchId?: string; name?: string; width?: number; height?: number; assetId?: string; bytes?: Uint8Array | number[]; document?: BridgeDocument; options?: Partial<ImportOptions> }
let session: Session | undefined;
let batch: { id: string; page: PageNode } | undefined;
let clientId = '';
let highWater = 0;
// Only bounded, compact terminal receipts are retained. Never store documents,
// pixel bytes, image-hash maps or the full import report here.
const terminals = new Map<string, Terminal>();
const bootState = { version: '0.1.6', protocol: 3, mainLoaded: true, handlerRegistered: true, bootId: `host-${Date.now()}-${Math.random().toString(36).slice(2)}`, timerAvailable: typeof setTimeout === 'function' };
const relaunchCommand = 'a80214a9-5a59-4a0c-9428-2ff65637b34f';

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const reply = (requestId: unknown, ok: boolean, result?: unknown, error?: string) => figma.ui.postMessage({ type: 'ack', requestId, ok, ...(result !== undefined ? { result } : {}), ...(error ? { error } : {}) });
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const receiptKey = (id: string, sequence: number) => `${sequence}:${id}`;
function ticket(msg: UiMessage): number {
  if (!validId(msg.clientId) || (clientId && msg.clientId !== clientId)) throw new Error('面板会话身份不匹配，请关闭并重新打开插件。');
  if (!Number.isSafeInteger(msg.sessionSequence) || msg.sessionSequence! < 1) throw new Error('导入序号无效，请重新打开插件。');
  return msg.sessionSequence!;
}
function remember(id: string, sequence: number, terminal: Terminal) {
  terminals.set(receiptKey(id, sequence), terminal);
  while (terminals.size > 128) terminals.delete(terminals.keys().next().value!);
}
function settle(active: Session, terminal: Terminal) {
  // This function runs only after importDocument has committed or finished rollback.
  active.hashes = Object.create(null); active.bytes = 0; active.importing = false;
  if (terminal.terminal) {
    remember(active.id, active.sequence, terminal);
    if (session === active) session = undefined;
  } else active.blocked = terminal;
  active.finish(terminal);
}
function current(id: unknown): Session {
  if (!session || session.id !== id) throw new Error('导入会话已过期，请重新选择文件。');
  if (session.blocked) throw new Error(session.blocked.error);
  if (session.cancelled) throw new Error('此导入会话已取消。');
  return session;
}
function safeFrameName(page: PageNode, name: string) {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').trim().slice(0, 160) || 'PSD';
  const existing = new Set(page.children.map(node => node.name));
  let result = `${clean} · 可编辑`, index = 2;
  while (existing.has(result)) result = `${clean} (${index++}) · 可编辑`;
  return result;
}

figma.ui.onmessage = async (message: unknown) => {
  const msg = message as UiMessage;
  if (!msg || typeof msg.type !== 'string') return;
  const { requestId } = msg;
  try {
    if (msg.type === 'ping') { reply(requestId, true, bootState); return; }
    if (msg.type === 'fonts') {
      const fonts = (await figma.listAvailableFontsAsync()).map(f => f.fontName);
      reply(requestId, true, { fonts }); return;
    }
    if (msg.type === 'begin') {
      if (session) throw new Error(session.blocked?.error || '已有导入正在运行，请先取消并等待终态确认或等待完成。');
      if (!validId(msg.sessionId)) throw new Error('导入会话 ID 无效。');
      const sequence = ticket(msg);
      if (sequence <= highWater) throw new Error('此导入序号已处理或取消；请为重试创建新的会话。');
      if (msg.batchId !== undefined && !validId(msg.batchId)) throw new Error('批次 ID 无效。');
      if (typeof msg.name !== 'string' || msg.name.length > 2048 || typeof msg.width !== 'number' || typeof msg.height !== 'number' || !Number.isFinite(msg.width) || !Number.isFinite(msg.height) || msg.width < 1 || msg.height < 1 || msg.width > 300000 || msg.height > 300000) throw new Error('文件名称或画布尺寸无效。');
      const batchId = msg.batchId || msg.sessionId;
      if (!batch || batch.id !== batchId) batch = { id: batchId, page: figma.currentPage };
      if (!batch.page || batch.page.removed) throw new Error('本批次目标页面不可用，请在有效页面重新开始。');
      clientId = msg.clientId!; highWater = sequence;
      let finish!: (value: Terminal) => void;
      const finished = new Promise<Terminal>(resolve => { finish = resolve; });
      // No await before reserving the session: cancellation fences a delayed begin.
      session = { id: msg.sessionId, sequence, name: msg.name, width: msg.width, height: msg.height, hashes: Object.create(null), cancelled: false, importing: false, bytes: 0, page: batch.page, finished, finish };
      reply(requestId, true, { targetPageId: batch.page.id }); return;
    }
    if (msg.type === 'cancel') {
      if (!validId(msg.sessionId)) throw new Error('取消请求的会话 ID 无效。');
      const sequence = ticket(msg);
      const active = session;
      if (active && active.id === msg.sessionId) {
        if (sequence !== active.sequence) throw new Error('取消请求的导入序号不匹配。');
        if (active.blocked) { reply(requestId, true, active.blocked); return; }
        active.cancelled = true;
        if (!active.importing) settle(active, { terminal: true, status: 'cancelled' });
        // ACK means terminal, not merely "cancellation requested".
        reply(requestId, true, await active.finished);
      } else {
        let terminal = terminals.get(receiptKey(msg.sessionId, sequence));
        if (!terminal) {
          if (sequence <= highWater) {
            // Receipt eviction must never turn a committed job into "cancelled".
            terminal = { terminal: false, status: 'unknown', error: '无法确认此旧会话终态；请检查画布后关闭并重新打开插件。' };
          } else {
            // A constant-size high-water mark fences late begin forever, even
            // after this compact receipt ages out of the bounded receipt cache.
            clientId = msg.clientId!; highWater = sequence;
            terminal = { terminal: true, status: 'cancelled' };
            remember(msg.sessionId, sequence, terminal);
          }
        }
        reply(requestId, true, terminal);
      }
      return;
    }
    if (msg.type === 'asset') {
      const active = current(msg.sessionId);
      if (active.importing) throw new Error('导入阶段不能追加图像。');
      if (typeof msg.assetId !== 'string' || !msg.assetId || msg.assetId.length > 2048) throw new Error('图像 ID 无效。');
      const bytes = msg.bytes instanceof Uint8Array ? msg.bytes : Array.isArray(msg.bytes) ? new Uint8Array(msg.bytes) : undefined;
      if (!bytes || !bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024) throw new Error('单个图像资产须小于 64 MB。');
      if (active.bytes + bytes.byteLength > 2 * 1024 * 1024 * 1024) throw new Error('本次图像资产超过 2 GB；请拆分文件。');
      if (Object.prototype.hasOwnProperty.call(active.hashes, msg.assetId)) throw new Error(`重复图像 ID：${msg.assetId}`);
      active.hashes[msg.assetId] = figma.createImage(bytes).hash; active.bytes += bytes.byteLength;
      reply(requestId, true); return;
    }
    if (msg.type === 'import') {
      const active = current(msg.sessionId); if (active.importing) throw new Error('导入正在运行。');
      const document = msg.document as BridgeDocument;
      if (document?.width !== active.width || document?.height !== active.height || document?.name !== active.name) throw new Error('文档与当前导入会话不一致。');
      active.importing = true;
      const options: ImportOptions = { includeReference: false, keepTextBackup: msg.options?.keepTextBackup !== false, fontMap: msg.options?.fontMap || {} };
      let committed = false;
      try {
        let viewportError = '';
        const result = await importDocument(figma, document, active.hashes, options, {
          targetPage: active.page,
          frameName: safeFrameName(active.page, active.name),
          isCancelled: () => active.cancelled,
          onProgress: (completed, total, name) => figma.ui.postMessage({ type: 'progress', sessionId: active.id, completed, total, name, done: completed, label: name }),
          yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)),
          onCommitted: frame => {
            // Synchronous optional UI work cannot delay terminal release or run
            // later against the next file. Never navigate to a different page.
            try {
              frame.setRelaunchData({ [relaunchCommand]: '继续导入 PSD / PSB' });
              if (figma.currentPage === active.page) { active.page.selection = [frame]; figma.viewport.scrollAndZoomIntoView([frame]); }
            } catch (error) { viewportError = errorText(error); }
          },
        });
        if (viewportError) result.report.push({ severity: 'info', code: 'VIEWPORT_UNCHANGED', message: `图层已导入；定位画布失败：${viewportError}` });
        const terminal: Terminal = { terminal: true, status: 'success', result: { frameId: result.frameId, counts: result.counts, targetPageId: active.page.id } };
        settle(active, terminal);
        committed = true;
        reply(requestId, true, { ...result, terminal: true, status: 'success', targetPageId: active.page.id });
        figma.ui.postMessage({ type: 'complete', sessionId: active.id, result: terminal.result });
      } catch (error) {
        if (committed) { console.warn('PSD Bridge: committed result could not reach UI:', errorText(error)); return; }
        const rollbackFailed = error instanceof ImportRollbackError;
        const terminal: Terminal = { terminal: !rollbackFailed, status: rollbackFailed ? 'failed' : active.cancelled ? 'cancelled' : 'failed', error: errorText(error).slice(0, 2000) };
        settle(active, terminal);
        reply(requestId, false, terminal, terminal.error);
      }
      return;
    }
    throw new Error(`未知操作：${msg.type}`);
  } catch (e) { reply(requestId, false, undefined, errorText(e)); }
};

// Register before showing UI; optional relaunch metadata never blocks startup.
figma.showUI(__html__.replace('/*PSD_BRIDGE_BOOT*/null', JSON.stringify(bootState)), { width: 440, height: 680, themeColors: true });
try { figma.root.setRelaunchData({ [relaunchCommand]: '继续导入 PSD / PSB' }); }
catch (error) { console.warn('PSD Bridge: relaunch metadata unavailable:', errorText(error)); }
