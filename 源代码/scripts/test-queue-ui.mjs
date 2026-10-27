import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// Exercises the actual UI in Chromium against tiny generated inputs and a
// controllable host. It never opens Figma or searches for user design files.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test-output');
fs.mkdirSync(out, { recursive: true });
const sourceText = fs.readFileSync(path.join(root, 'src/ui.ts'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/ui.html'), 'utf8');
const version = sourceText.match(/version:\s*['"]([\d.]+)['"]/)?.[1];
assert.equal(version, '0.1.6');
const compiled = await build({
  stdin: { contents: sourceText + `\nglobalThis.__queueTest = {
    chooseFiles, chooseFile, clearSource, startImport, retryFailed, cancelCurrent,
    state() { return { jobs: jobs.map(job => ({...job, file: undefined, hasFile: !!job.file})),
      activeId: activeJob?.id, source: source ? {name: source.name, marker: source.psd.__testMarker} : null,
      hasInputFile: !!inputFile, report, queueRunning, blocked, awaitingFonts, stopRequested,
      isBusy, isParsing, sessionId, fontMap: {...fontMap}, fontsLoaded,
      pendingCount: pending.size }; }
  };`, loader: 'ts', resolveDir: path.join(root, 'src') },
  bundle: true, write: false, platform: 'browser', target: 'es2020',
  plugins: [{ name: 'queue-synthetic-pipeline', setup(builder) {
    builder.onResolve({ filter: /^\.\/pipeline$/ }, () => ({ path: 'pipeline', namespace: 'queue-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'queue-fixture' }, () => ({ contents: `
      export function inspectFile(file, progress, isCancelled) { return globalThis.__pipeline.inspectFile(file, progress, isCancelled); }
      export function convertPsd(psd, name, options, hooks) { return globalThis.__pipeline.convertPsd(psd, name, options, hooks); }
    `, loader: 'js' }));
  } }],
});
const htmlFile = path.join(out, 'queue-ui-fixture.html');
fs.writeFileSync(htmlFile, html.replace('<!--APP_SCRIPT-->', () => `<script>${compiled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`));
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright')); }
const launch = { headless: true };
if (process.env.PSD_UI_CHROMIUM_PATH) launch.executablePath = process.env.PSD_UI_CHROMIUM_PATH;
const browser = await playwright.chromium.launch(launch);
const tests = [], failures = [];
const payload = (name, specification = {}) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify({ id: name, ...specification })) });

async function createPage(initialConfig = {}) {
  const page = await browser.newPage({ viewport: { width: 440, height: 680 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ version, initialConfig }) => {
    const actualTimeout = window.setTimeout.bind(window);
    window.__config = { failOnce: {}, holdRead: [], holdImport: false, holdCancel: false, cancelTerminal: true, accelerateTimeouts: false, ...initialConfig };
    window.setTimeout = (fn, ms, ...args) => actualTimeout(fn, window.__config.accelerateTimeouts && ms >= 8000 ? 100 : ms, ...args);
    const state = window.__fixture = { reads: [], conversions: [], requests: [], commits: [], activeReads: 0, maxReads: 0, activeConversions: 0, maxConversions: 0, activeSessions: 0, maxSessions: 0, readReleases: {}, cancelRequests: [], importRequests: {}, terminals: {}, active: null, identities: {}, sequences: {}, protocolErrors: [], fontRequests: [] };
    const send = (message, result, error) => {
      window.dispatchEvent(new MessageEvent('message', { source: null, data: { pluginMessage: { type: 'ack', requestId: message.requestId, ok: !error, result, error } } }));
    };
    window.__sendHost = message => window.dispatchEvent(new MessageEvent('message', { source: null, data: { pluginMessage: message } }));
    window.__releaseFonts = () => { for (const message of state.fontRequests.splice(0)) send(message, { fonts: [{ family: 'Arial', style: 'Regular' }, { family: 'Inter', style: 'Bold' }, { family: 'Inter', style: 'Regular' }] }); };
    window.__releaseRead = id => { state.readReleases[id]?.(); delete state.readReleases[id]; };
    window.__releaseCancel = (terminal = true) => {
      const requests = state.cancelRequests.splice(0);
      for (const message of requests) {
        const result = state.terminals[message.sessionId] || { terminal, status: terminal ? 'cancelled' : 'unknown', sessionId: message.sessionId };
        const pendingImport = state.importRequests[message.sessionId];
        if (pendingImport) { send(pendingImport, undefined, '导入已取消'); delete state.importRequests[message.sessionId]; }
        if (terminal) {
          state.terminals[message.sessionId] = result;
          if (state.active?.id === message.sessionId) { state.active = null; state.activeSessions--; }
        }
        send(message, result);
      }
    };
    window.__pipeline = {
      async inspectFile(file, progress, isCancelled = () => false) {
        state.activeReads++; state.maxReads = Math.max(state.maxReads, state.activeReads);
        state.reads.push(file.name);
        try {
          progress?.('合成样例读取中');
          const spec = JSON.parse(new TextDecoder().decode(await file.arrayBuffer()));
          if (window.__config.holdRead.includes(spec.id)) await new Promise(resolve => { state.readReleases[spec.id] = resolve; });
          if (isCancelled()) throw new Error('源文件读取已取消');
          if (spec.corrupt || window.__config.failOnce[spec.id]) {
            if (window.__config.failOnce[spec.id]) window.__config.failOnce[spec.id]--;
            throw new Error('文件不是有效的 PSD / PSB（合成损坏样例）');
          }
          return { name: file.name, psd: { __testMarker: spec.id, spec, rawBytes: new Uint8Array(128) },
            summary: { width: 8, height: 8, layers: 2, textLayers: spec.fonts?.length || 0, imageLayers: 1, groups: 0, hiddenLayers: 0, fonts: spec.fonts || [], visibleFonts: spec.fonts || [], warnings: [] } };
        } finally { state.activeReads--; }
      },
      async convertPsd(psd, name, options, hooks) {
        state.activeConversions++; state.maxConversions = Math.max(state.maxConversions, state.activeConversions);
        state.conversions.push({ id: psd.__testMarker, name, options });
        try {
          if (hooks.isCancelled()) throw new Error('导入已取消');
          hooks.onProgress?.(1, 2, '转换合成图层');
          await hooks.onAsset('fixture-asset', new Uint8Array([1, 2, 3]));
          if (hooks.isCancelled()) throw new Error('导入已取消');
          hooks.onProgress?.(2, 2, '合成转换完成');
          return { name: name.replace(/\.(psd|psb)$/i, ''), width: 8, height: 8, layers: [{ id: 'fixture-layer', name: 'synthetic', kind: 'image', pixels: new Uint8Array(32) }], report: [] };
        } finally { state.activeConversions--; }
      },
    };
    window.addEventListener('message', event => {
      const message = event.data?.pluginMessage;
      if (!message || !['ping', 'fonts', 'begin', 'asset', 'import', 'cancel'].includes(message.type)) return;
      state.requests.push({ type: message.type, requestId: message.requestId, sessionId: message.sessionId, clientId: message.clientId, sessionSequence: message.sessionSequence, batchId: message.batchId, name: message.name, documentName: message.document?.name, options: message.options });
      if (message.type === 'begin' || message.type === 'cancel') {
        const valid = typeof message.clientId === 'string' && message.clientId.length > 0 && Number.isSafeInteger(message.sessionSequence) && message.sessionSequence > 0;
        if (!valid) { state.protocolErrors.push(`${message.type}: invalid clientId or sessionSequence`); send(message, undefined, '测试宿主：缺少协议身份'); return; }
        const identity = state.identities[message.sessionId];
        if (identity && (identity.clientId !== message.clientId || identity.sessionSequence !== message.sessionSequence)) { state.protocolErrors.push(`${message.type}: changed session identity`); send(message, undefined, '测试宿主：会话身份不一致'); return; }
        if (message.type === 'begin') {
          if (message.sessionSequence <= (state.sequences[message.clientId] || 0)) { state.protocolErrors.push('begin: non-monotonic sequence'); send(message, undefined, '测试宿主：迟到会话'); return; }
          state.sequences[message.clientId] = message.sessionSequence;
          state.identities[message.sessionId] = { clientId: message.clientId, sessionSequence: message.sessionSequence };
        }
      }
      if (message.type === 'ping') { actualTimeout(() => send(message, { version, protocol: 3, handlerRegistered: true }), 0); return; }
      if (message.type === 'fonts') { state.fontRequests.push(message); if (!window.__config.holdFonts) actualTimeout(window.__releaseFonts, 0); return; }
      if (message.type === 'begin') {
        if (state.active) { send(message, undefined, '已有导入会话正在运行'); return; }
        state.active = { id: message.sessionId, name: message.name };
        state.activeSessions++; state.maxSessions = Math.max(state.maxSessions, state.activeSessions);
        send(message, { targetPageId: 'synthetic-page' }); return;
      }
      if (message.type === 'asset') { actualTimeout(() => send(message, {}), 0); return; }
      if (message.type === 'import') {
        state.importRequests[message.sessionId] = message;
        if (window.__config.holdImport) return;
        const result = { terminal: true, status: 'success', frameId: `synthetic-${state.commits.length + 1}`, report: [], missingFonts: window.__config.autoFonts ? [{ source: 'MissingAuto', replacement: { family: 'Inter', style: 'Regular' } }] : [] };
        state.commits.push({ name: message.document.name, sessionId: message.sessionId, options: message.options });
        state.terminals[message.sessionId] = { terminal: true, status: 'success', result: { frameId: result.frameId, counts: { frames: 1, images: 1, text: 0 } } };
        state.active = null; state.activeSessions--; delete state.importRequests[message.sessionId];
        if (window.__config.malformedImportAck) {
          window.__config.malformedImportAck = false;
          send(message, { frameId: result.frameId });
        } else send(message, result);
        return;
      }
      if (message.type === 'cancel') {
        if (state.terminals[message.sessionId] && !window.__config.holdCancel) { send(message, state.terminals[message.sessionId]); return; }
        state.cancelRequests.push(message);
        if (!window.__config.holdCancel) actualTimeout(() => window.__releaseCancel(window.__config.cancelTerminal), 0);
      }
    });
  }, { version, initialConfig });
  await page.goto(`file://${htmlFile}`);
  if (initialConfig.holdFonts) await page.waitForFunction(() => Boolean(window.__queueTest) && window.__fixture.fontRequests.length > 0);
  else await page.waitForFunction(() => window.__queueTest?.state().fontsLoaded);
  return { page, errors };
}
const state = page => page.evaluate(() => window.__queueTest.state());
const fixtureState = page => page.evaluate(() => ({ ...window.__fixture, readReleases: undefined, importRequests: undefined, cancelRequests: window.__fixture.cancelRequests.map(x => ({ sessionId: x.sessionId })) }));
const waitReady = page => page.waitForFunction(() => window.__queueTest.state().jobs.some(job => job.status === 'ready'));
const waitFinished = page => page.waitForFunction(() => { const s = window.__queueTest.state(); return !s.queueRunning && !s.isBusy && !s.isParsing; });
const choose = (page, files) => page.locator('#file-input').setInputFiles(files);
const start = page => page.locator('#import-btn').click();
async function test(name, run, initialConfig) {
  const { page, errors } = await createPage(initialConfig);
  try { await run(page); assert.deepEqual(errors, [], 'No uncaught UI errors'); assert.deepEqual((await fixtureState(page)).protocolErrors, [], 'Protocol 3 identity fields match and increase'); tests.push(name); console.log(`PASS ${name}`); }
  catch (error) {
    const detail = await page.evaluate(() => ({ ui: window.__queueTest?.state(), status: document.querySelector('#status-title')?.textContent, detail: document.querySelector('#status-detail')?.textContent, reads: window.__fixture?.reads, requests: window.__fixture?.requests })).catch(() => ({}));
    failures.push({ name, error: error.stack || String(error), detail }); console.error(`FAIL ${name}: ${error.message}\n${JSON.stringify(detail)}`);
  }
  finally { await page.close(); }
}

try {
  await test('One selected file preserves preflight, import and report while releasing decoded references', async page => {
    assert.equal(await page.locator('#file-input').getAttribute('multiple') !== null, true);
    assert.equal(await page.locator('#include-reference').count(), 0);
    await choose(page, payload('single.psd')); await waitReady(page);
    assert.deepEqual((await fixtureState(page)).reads, ['single.psd']);
    await start(page); await waitFinished(page);
    const s = await state(page), f = await fixtureState(page);
    assert.equal(s.jobs[0].status, 'success'); assert.equal(f.commits.length, 1);
    assert.equal(s.source, null); assert.equal(s.hasInputFile, false);
    assert.equal(s.jobs[0].hasFile, false, 'Successful File reference released');
    assert.equal(f.conversions[0].options.includeComposite, false);
    assert.equal(f.commits[0].options.includeReference, false);
    const retained = JSON.stringify({ jobs: s.jobs, report: s.report });
    for (const key of ['sourceStructure', 'rawBytes', '__testMarker', '"pixels"']) assert.equal(retained.includes(key), false, `No retained large structure: ${key}`);
    assert.equal(await page.locator('#report-btn').isVisible(), true);
  });

  await test('Multiple selection reads only first preflight; duplicate starts keep read/convert/host concurrency one', async page => {
    await choose(page, ['a.psd', 'b.psb', 'c.psd'].map(name => payload(name))); await waitReady(page);
    assert.deepEqual((await fixtureState(page)).reads, ['a.psd']);
    await page.evaluate(() => { void window.__queueTest.startImport(); void window.__queueTest.startImport(); document.querySelector('#import-btn').click(); });
    await waitFinished(page);
    const s = await state(page), f = await fixtureState(page);
    assert.deepEqual(s.jobs.map(job => job.status), ['success', 'success', 'success']);
    assert.deepEqual(f.reads, ['a.psd', 'b.psb', 'c.psd']);
    assert.deepEqual(f.commits.map(job => job.name), ['a', 'b', 'c']);
    assert.deepEqual([f.maxReads, f.maxConversions, f.maxSessions], [1, 1, 1]);
    assert.equal(new Set(f.requests.filter(x => x.type === 'begin').map(x => x.sessionId)).size, 3);
    assert.equal(new Set(f.requests.filter(x => x.type === 'begin').map(x => x.batchId)).size, 1);
    assert.equal(new Set(f.requests.filter(x => x.type === 'begin').map(x => x.clientId)).size, 1);
    assert.match(await page.locator('#queue-summary').textContent(), /3/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, 'queue-complete.png'), fullPage: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, 'queue-complete-viewport.png') });
  });

  await test('Multi-file drag/drop preserves every item including same-name files', async page => {
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify({ id: 'same-1' })], 'same.psd'));
      transfer.items.add(new File([JSON.stringify({ id: 'same-2' })], 'same.psd'));
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await waitReady(page); await start(page); await waitFinished(page);
    const s = await state(page), f = await fixtureState(page);
    assert.equal(s.jobs.length, 2); assert.equal(new Set(s.jobs.map(x => x.id)).size, 2);
    assert.equal(new Set(s.jobs.map(x => x.displayName)).size, 2, 'Duplicate names visibly disambiguated');
    assert.equal(f.commits.length, 2); assert.deepEqual(f.conversions.map(x => x.id), ['same-1', 'same-2']);
  });

  await test('Metadata preflight rejects unsupported, empty and over-limit files without reading them', async page => {
    await page.evaluate(() => {
      const oversized = new File(['not read'], 'oversized.psb'); Object.defineProperty(oversized, 'size', { value: 1_500_000_001 });
      void window.__queueTest.chooseFiles([new File(['not read'], 'bad.txt'), new File([], 'empty.psd'), oversized, new File([JSON.stringify({ id: 'valid' })], 'valid.psd')]);
    });
    await waitReady(page); await start(page); await waitFinished(page);
    const s = await state(page), f = await fixtureState(page);
    assert.equal(s.jobs.filter(x => x.status === 'failed').length, 3); assert.equal(s.jobs.at(-1).status, 'success');
    assert.deepEqual(f.reads, ['valid.psd']);
  });

  await test('A corrupted middle file fails independently and is retryable without reimporting successes', async page => {
    await page.evaluate(() => { window.__config.failOnce['b.psd'] = 1; });
    await choose(page, ['a.psd', 'b.psd', 'c.psd'].map(name => payload(name))); await waitReady(page); await start(page); await waitFinished(page);
    assert.deepEqual((await state(page)).jobs.map(job => job.status), ['success', 'failed', 'success']);
    assert.deepEqual((await fixtureState(page)).commits.map(job => job.name), ['a', 'c']);
    await page.locator('#retry-btn').click(); await waitFinished(page);
    assert.deepEqual((await state(page)).jobs.map(job => job.status), ['success', 'success', 'success']);
    assert.deepEqual((await fixtureState(page)).commits.map(job => job.name), ['a', 'c', 'b']);
    assert.deepEqual((await fixtureState(page)).reads, ['a.psd', 'b.psd', 'c.psd', 'b.psd']);
  });

  await test('Confirmed missing-font choices and search survive next file; new missing font pauses only that item', async page => {
    await choose(page, [payload('a.psd', { fonts: ['MissingA'] }), payload('b.psd', { fonts: ['MissingA'] }), payload('c.psd', { fonts: ['MissingB'] }), payload('d.psd')]); await waitReady(page);
    const search = page.locator('.font-search-input').first(); await search.fill('Inter Bold');
    const select = page.locator('.font-row select').first();
    const option = await select.locator('option').evaluateAll(options => options.find(x => x.textContent.includes('Inter') && x.textContent.includes('Bold'))?.value);
    assert.ok(option); await select.selectOption(option);
    await start(page);
    await page.waitForFunction(() => window.__queueTest.state().awaitingFonts);
    const f = await fixtureState(page);
    assert.deepEqual(f.commits.map(x => x.name), ['a', 'b']);
    assert.deepEqual(f.reads, ['a.psd', 'b.psd', 'c.psd']);
    assert.deepEqual(f.commits[0].options.fontMap.MissingA, { family: 'Inter', style: 'Bold' });
    assert.deepEqual(f.commits[1].options.fontMap.MissingA, { family: 'Inter', style: 'Bold' });
    assert.equal(await page.locator('.font-search-input').first().isEnabled(), true);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, 'queue-font-wait.png'), fullPage: true });
    await page.locator('.font-search-input').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'queue-font-wait-viewport.png') });
    await page.locator('#confirm-fonts-btn').click(); await waitFinished(page);
    assert.equal((await fixtureState(page)).commits.length, 4);
  });

  await test('Confirmed Auto keeps the existing host fallback and reuses the actual returned font next time', async page => {
    await page.evaluate(() => { window.__config.autoFonts = true; });
    await choose(page, [payload('auto-first.psd', { fonts: ['MissingAuto'] }), payload('auto-next.psd', { fonts: ['MissingAuto'] })]); await waitReady(page);
    assert.equal(await page.locator('.font-row select').first().inputValue(), '', 'Auto is the original choice');
    await start(page); await waitFinished(page);
    const f = await fixtureState(page);
    assert.equal(f.commits.length, 2);
    assert.equal(f.commits[0].options.fontMap.MissingAuto, undefined, 'Do not replace host Auto with a new UI fallback algorithm');
    assert.deepEqual(f.commits[1].options.fontMap.MissingAuto, { family: 'Inter', style: 'Regular' });
    assert.equal((await state(page)).awaitingFonts, false);
  });

  await test('Cancel current waits for final rollback ACK before reading next file and rejects stale progress/ACK', async page => {
    await page.evaluate(() => { window.__config.holdImport = true; window.__config.holdCancel = true; });
    await choose(page, [payload('cancel.psd'), payload('next.psd')]); await waitReady(page); await start(page);
    await page.waitForFunction(() => window.__fixture.requests.some(x => x.type === 'import'));
    const old = (await fixtureState(page)).requests.find(x => x.type === 'import');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, 'queue-running.png'), fullPage: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, 'queue-running-viewport.png') });
    await page.locator('#cancel-btn').click();
    await page.waitForFunction(() => window.__fixture.cancelRequests.length > 0);
    await page.waitForTimeout(50);
    assert.deepEqual((await fixtureState(page)).reads, ['cancel.psd']);
    assert.equal(await page.locator('#clear-source-btn').isDisabled(), true);
    await page.evaluate(() => { window.__config.holdImport = false; window.__releaseCancel(true); });
    await waitFinished(page);
    assert.deepEqual((await state(page)).jobs.map(x => x.status), ['cancelled', 'success']);
    const title = await page.locator('#status-title').textContent();
    await page.evaluate(old => {
      window.__sendHost({ type: 'progress', sessionId: old.sessionId, done: 1, total: 1, label: 'STALE PROGRESS' });
      window.__sendHost({ type: 'ack', requestId: old.requestId, ok: true, result: { frameId: 'STALE RESULT' } });
    }, old);
    assert.equal(await page.locator('#status-title').textContent(), title);
    assert.equal((await fixtureState(page)).commits.length, 1);
  });

  await test('An import ACK without terminal status reconciles and pauses; committed success survives explicit continuation', async page => {
    await page.evaluate(() => { window.__config.malformedImportAck = true; window.__config.holdCancel = true; });
    await choose(page, [payload('committed.psd'), payload('next.psd')]); await waitReady(page); await start(page);
    await page.waitForFunction(() => window.__fixture.cancelRequests.length > 0);
    assert.deepEqual((await fixtureState(page)).reads, ['committed.psd']);
    assert.equal((await fixtureState(page)).commits.length, 1);
    await page.evaluate(() => { window.__config.holdCancel = false; window.__releaseCancel(true); });
    await waitFinished(page);
    assert.deepEqual((await state(page)).jobs.map(x => x.status), ['success', 'cancelled']);
    assert.deepEqual((await fixtureState(page)).commits.map(x => x.name), ['committed']);
    assert.match((await state(page)).jobs[0].report.note, /已提交|保留/);
    assert.equal((await state(page)).jobs[0].report.figma.frameId, 'synthetic-1');
    await start(page); await waitFinished(page);
    assert.deepEqual((await fixtureState(page)).commits.map(x => x.name), ['committed', 'next']);
  });

  await test('Stop all preserves committed files, cancels remaining jobs, and permits clean restart', async page => {
    await choose(page, [payload('saved.psd'), payload('cancel.psd'), payload('unread.psd')]); await waitReady(page);
    await page.evaluate(() => { window.__config.holdRead = ['cancel.psd']; });
    await start(page); await page.waitForFunction(() => Boolean(window.__fixture.readReleases['cancel.psd']));
    await page.locator('#stop-all-btn').click();
    await page.evaluate(() => window.__releaseRead('cancel.psd')); await waitFinished(page);
    const s = await state(page), f = await fixtureState(page);
    assert.deepEqual(s.jobs.map(x => x.status), ['success', 'cancelled', 'cancelled']);
    assert.deepEqual(f.reads, ['saved.psd', 'cancel.psd']); assert.equal(f.commits.length, 1);
    await page.locator('#clear-source-btn').click();
    assert.equal((await state(page)).jobs.length, 0);
    await choose(page, payload('restart.psd')); await waitReady(page); await start(page); await waitFinished(page);
    assert.equal((await state(page)).jobs[0].status, 'success'); assert.equal((await fixtureState(page)).commits.length, 2);
    assert.equal(new Set((await fixtureState(page)).requests.filter(x => x.type === 'begin').map(x => x.clientId)).size, 1, 'Client identity survives clear/new batch');
  });

  await test('Unconfirmed rollback locks restart, retry, clearing and next-file reads', async page => {
    await page.evaluate(() => { window.__config.holdImport = true; window.__config.cancelTerminal = false; });
    await choose(page, [payload('unknown.psd'), payload('must-not-read.psd')]); await waitReady(page); await start(page);
    await page.waitForFunction(() => window.__fixture.requests.some(x => x.type === 'import'));
    await page.locator('#cancel-btn').click();
    await page.waitForFunction(() => window.__queueTest.state().blocked);
    const prior = await state(page);
    await page.evaluate(() => { window.__queueTest.clearSource(); void window.__queueTest.startImport(); void window.__queueTest.retryFailed(); void window.__queueTest.chooseFiles([new File(['{}'], 'new.psd')]); });
    assert.equal((await state(page)).jobs.length, prior.jobs.length);
    assert.deepEqual((await fixtureState(page)).reads, ['unknown.psd']);
    assert.equal(await page.locator('#clear-source-btn').isDisabled(), true);
    assert.equal(await page.locator('#import-btn').isDisabled(), true);
  });

  await test('Missing cancellation terminal ACK times out into a locked state and never pre-reads the next file', async page => {
    await page.evaluate(() => { window.__config.holdImport = true; window.__config.holdCancel = true; });
    await choose(page, [payload('timeout.psd'), payload('must-not-read.psd')]); await waitReady(page); await start(page);
    await page.waitForFunction(() => window.__fixture.requests.some(x => x.type === 'import'));
    await page.evaluate(() => { window.__config.accelerateTimeouts = true; });
    await page.locator('#cancel-btn').click();
    await page.waitForFunction(() => window.__queueTest.state().blocked);
    assert.deepEqual((await fixtureState(page)).reads, ['timeout.psd']);
    assert.equal(await page.locator('#import-btn').isDisabled(), true);
    // A terminal response after its random request ID expired cannot silently
    // unlock an uncertain host state or start a new task.
    await page.evaluate(() => window.__releaseCancel(true));
    await page.waitForTimeout(30);
    assert.equal((await state(page)).blocked, true);
    assert.deepEqual((await fixtureState(page)).reads, ['timeout.psd']);
  });

  await test('Clearing during a held preflight cannot start overlapping reads and discards late source', async page => {
    await page.evaluate(() => { window.__config.holdRead = ['old.psd']; });
    await choose(page, payload('old.psd'));
    await page.waitForFunction(() => Boolean(window.__fixture.readReleases['old.psd']));
    await page.evaluate(() => window.__queueTest.clearSource());
    await page.evaluate(() => { void window.__queueTest.chooseFiles([new File([JSON.stringify({ id: 'new' })], 'new.psd')]); });
    assert.equal((await fixtureState(page)).maxReads, 1);
    await page.evaluate(() => window.__releaseRead('old.psd'));
    await page.waitForFunction(() => !window.__queueTest.state().isParsing);
    assert.equal((await fixtureState(page)).maxReads, 1);
    assert.notEqual((await state(page)).source?.name, 'old.psd');
  });

  await test('Page hide stops an active queue from starting another file', async page => {
    await choose(page, [payload('saved.psd'), payload('closing.psd'), payload('not-after-close.psd')]); await waitReady(page);
    await page.evaluate(() => { window.__config.holdRead = ['closing.psd']; });
    await start(page);
    await page.waitForFunction(() => Boolean(window.__fixture.readReleases['closing.psd']));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.evaluate(() => window.__releaseRead('closing.psd'));
    await page.waitForTimeout(30);
    assert.deepEqual((await fixtureState(page)).reads, ['saved.psd', 'closing.psd']);
    assert.equal((await fixtureState(page)).commits.length, 1);
    assert.equal((await state(page)).source, null);
  });

  await test('A pending font catalog blocks start until available mappings can be confirmed', async page => {
    await choose(page, payload('fonts.psd', { fonts: ['MissingA'] })); await waitReady(page);
    assert.equal(await page.locator('#import-btn').isDisabled(), true);
    await page.evaluate(() => { void window.__queueTest.startImport(); });
    assert.equal((await fixtureState(page)).requests.some(x => x.type === 'begin'), false);
    await page.evaluate(() => window.__releaseFonts());
    await page.waitForFunction(() => window.__queueTest.state().fontsLoaded);
    assert.equal(await page.locator('#import-btn').isEnabled(), true);
    await start(page); await waitFinished(page);
    assert.equal((await state(page)).jobs[0].status, 'success');
  }, { holdFonts: true });
} finally {
  await browser.close();
  const result = { passed: failures.length === 0, passedCount: tests.length, failedCount: failures.length,
    runtime: 'Chromium 440x680 using actual UI source/DOM, tiny synthetic File inputs, instrumented parser/converter and mocked Figma host. Does not verify real PSD parsing, real Figma rendering, OS process close, garbage collection timing or large-file memory pressure.', tests, failures };
  fs.writeFileSync(path.join(out, 'queue-ui-tests.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
}
