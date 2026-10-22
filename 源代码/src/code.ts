import { importDocument, type ImportOptions } from './importer';
import type { BridgeDocument } from './types';

declare const __html__: string;
interface Session { id: string; name: string; width: number; height: number; hashes: Record<string, string>; cancelled: boolean; importing: boolean; bytes: number }
interface UiMessage { type?: string; requestId?: unknown; sessionId?: string; name?: string; width?: number; height?: number; assetId?: string; bytes?: Uint8Array | number[]; document?: BridgeDocument; options?: Partial<ImportOptions> }
let session: Session | undefined;
const bootState = { version: '0.1.4', protocol: 2, mainLoaded: true, handlerRegistered: true, bootId: `host-${Date.now()}-${Math.random().toString(36).slice(2)}`, timerAvailable: typeof setTimeout === 'function' };
const relaunchCommand = 'a80214a9-5a59-4a0c-9428-2ff65637b34f';

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const reply = (requestId: unknown, ok: boolean, result?: unknown, error?: string) => figma.ui.postMessage({ type: 'ack', requestId, ok, ...(result !== undefined ? { result } : {}), ...(error ? { error } : {}) });
function current(id: unknown): Session { if (!session || session.id !== id) throw new Error('导入会话已过期，请重新选择文件。'); if (session.cancelled) throw new Error('此导入会话已取消。'); return session; }

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
      if (session?.importing) throw new Error('已有导入正在运行，请先取消或等待完成。');
      if (typeof msg.sessionId !== 'string' || !msg.sessionId || msg.sessionId.length > 200) throw new Error('导入会话 ID 无效。');
      if (typeof msg.name !== 'string' || typeof msg.width !== 'number' || typeof msg.height !== 'number' || !Number.isFinite(msg.width) || !Number.isFinite(msg.height) || msg.width < 1 || msg.height < 1 || msg.width > 300000 || msg.height > 300000) throw new Error('文件名称或画布尺寸无效。');
      session = { id: msg.sessionId, name: msg.name, width: msg.width, height: msg.height, hashes: Object.create(null), cancelled: false, importing: false, bytes: 0 };
      reply(requestId, true); return;
    }
    if (msg.type === 'cancel') {
      if (session && session.id === msg.sessionId) { session.cancelled = true; if (!session.importing) session = undefined; }
      reply(requestId, true); return;
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
      const options: ImportOptions = { includeReference: msg.options?.includeReference !== false, keepTextBackup: msg.options?.keepTextBackup !== false, fontMap: msg.options?.fontMap || {} };
      try {
        const result = await importDocument(figma, document, active.hashes, options, {
          isCancelled: () => active.cancelled,
          onProgress: (completed, total, name) => figma.ui.postMessage({ type: 'progress', sessionId: active.id, completed, total, name, done: completed, label: name }),
          yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)),
        });
        // Canvas creation has committed. A viewport/relaunch failure must not report the import as failed.
        try {
          const frame = await figma.getNodeByIdAsync(result.frameId);
          if (frame && 'x' in frame) { frame.setRelaunchData({ [relaunchCommand]: '继续导入 PSD / PSB' }); figma.currentPage.selection = [frame as SceneNode]; figma.viewport.scrollAndZoomIntoView([frame as SceneNode]); }
        } catch (e) { result.report.push({ severity: 'info', code: 'VIEWPORT_UNCHANGED', message: `图层已导入；定位画布失败：${errorText(e)}` }); }
        reply(requestId, true, result); figma.ui.postMessage({ type: 'complete', sessionId: active.id, result });
      } finally { active.importing = false; if (session === active) session = undefined; }
      return;
    }
    throw new Error(`未知操作：${msg.type}`);
  } catch (e) { reply(requestId, false, undefined, errorText(e)); }
};

// Install the request handler before showing the UI. Optional relaunch metadata
// must never prevent the bridge from receiving ping/fonts/begin.
figma.showUI(__html__.replace('/*PSD_BRIDGE_BOOT*/null', JSON.stringify(bootState)), { width: 440, height: 680, themeColors: true });
try { figma.root.setRelaunchData({ [relaunchCommand]: '继续导入 PSD / PSB' }); }
catch (error) { console.warn('PSD Bridge: relaunch metadata unavailable:', errorText(error)); }
