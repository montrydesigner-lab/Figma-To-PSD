import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test-output');
fs.mkdirSync(out, { recursive: true });
const runtimeModules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(runtimeModules || '', 'playwright')); }
const launch = { headless: true, args: ['--no-sandbox'] };
if (process.env.PSD_UI_CHROMIUM_PATH) launch.executablePath = process.env.PSD_UI_CHROMIUM_PATH;
else if (fs.existsSync('/tmp/psd-chromium')) launch.executablePath = '/tmp/psd-chromium';
else if (fs.existsSync('/tmp/psd-ui-browser/node_modules/@sparticuz/chromium')) {
  const { default: chromium } = await import('/tmp/psd-ui-browser/node_modules/@sparticuz/chromium/build/index.js');
  launch.executablePath = await chromium.executablePath(); launch.args = chromium.args;
}
const sourceText = fs.readFileSync(path.join(root, 'src/ui.ts'), 'utf8');
const version = sourceText.match(/version:\s*['"]([\d.]+)['"]/)?.[1];
assert.equal(version, '0.1.6');
// Read-only test access; this instrumentation is absent from production builds.
const compiled = await build({ stdin: {
  contents: sourceText + `\nwindow.__uiTestState = () => ({ source: Boolean(source), inputFile: Boolean(inputFile), busy: isBusy, parsing: isParsing, cancelled: isCancelled, sessionId, report, jobs: jobs.map(job => ({id:job.id,status:job.status,name:job.name,error:job.error})) });`,
  loader: 'ts', resolveDir: path.join(root, 'src'),
}, bundle: true, target: 'es2020', platform: 'browser', write: false, minify: true });
const htmlFile = path.join(out, 'ui-test.html');
fs.writeFileSync(htmlFile, fs.readFileSync(path.join(root, 'src/ui.html'), 'utf8')
  .replace('<!--DIAGNOSTICS_SCRIPT-->', () => `<script>${fs.readFileSync(path.join(root, 'src/diagnostics.js'), 'utf8')}</script>`)
  .replace('<!--APP_SCRIPT-->', () => `<script>${compiled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`));
const browser = await playwright.chromium.launch(launch);
const tests = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 440, height: 680 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  await page.addInitScript(({ version }) => {
    window.__requests = []; window.__assetDelay = 0; window.__name = ''; window.__terminal = Object.create(null);
    window.__ack = (msg, result, ok = true, error) => window.dispatchEvent(new MessageEvent('message', { source: null, data: { pluginMessage: { type: 'ack', requestId: msg.requestId, ok, result, error } } }));
    window.addEventListener('message', event => {
      const msg = event.data.pluginMessage;
      if (!msg || !['ping', 'fonts', 'begin', 'asset', 'import', 'cancel'].includes(msg.type)) return;
      window.__requests.push({ type: msg.type, sessionId: msg.sessionId, name: msg.name, documentName: msg.document?.name, bytes: msg.bytes?.byteLength, options: msg.options, batchId: msg.batchId });
      if (msg.type === 'begin') window.__name = msg.name;
      if (window.__stallType === msg.type) { window.__stalled = msg; return; }
      let result; let ok = true; let error;
      if (msg.type === 'ping') result = { protocol: 3, version, handlerRegistered: true };
      if (msg.type === 'fonts') result = { fonts: [{ family: 'Arial', style: 'Regular' }, { family: 'Arial', style: 'Bold' }, { family: 'Inter', style: 'Regular' }, { family: 'Source Han Sans SC', style: 'Bold' }] };
      if (msg.type === 'begin') result = { targetPageId: 'mock-page' };
      if (msg.type === 'import') {
        if (msg.document.name !== window.__name) { ok = false; error = 'Document name mismatch'; }
        result = { frameId: 'mock-frame', report: [{ severity: 'info', message: '字体匹配检查完成' }], terminal: true, status: 'success', targetPageId: 'mock-page' };
        window.__terminal[msg.sessionId] = { terminal: true, status: 'success', result };
      }
      if (msg.type === 'cancel') {
        result = window.__terminal[msg.sessionId] || { terminal: true, status: 'cancelled' };
        if (window.__holdCancel) { window.__heldCancel = { msg, result }; return; }
      }
      setTimeout(() => window.__ack(msg, result, ok, error), msg.type === 'asset' ? window.__assetDelay : 0);
    });
  }, { version });
  await page.goto(pathToFileURL(htmlFile).href);
  await page.waitForFunction(() => Boolean(window.__uiTestState));
  const state = () => page.evaluate(() => window.__uiTestState());
  const idle = () => page.waitForFunction(() => !window.__uiTestState().busy);
  const fixture = path.join(out, 'fixtures/layered-fixture.psb');
  const selectFixture = async () => {
    await page.locator('#file-input').setInputFiles(fixture);
    await page.waitForFunction(() => window.__uiTestState().source && !window.__uiTestState().busy);
  };
  const start = async () => {
    await page.locator('#import-btn').click();
    if (await page.locator('#confirm-fonts-btn').isVisible()) await page.locator('#confirm-fonts-btn').click();
  };
  assert.equal(await page.locator('#import-btn').isDisabled(), true);
  assert.equal(await page.locator('#include-reference').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  tests.push({ name: 'Initial empty state, disabled import, no reference switch or horizontal overflow', passed: true });
  await page.screenshot({ path: path.join(out, 'ui-empty.png'), animations: 'disabled' });
  await page.locator('#file-input').setInputFiles({ name: 'broken.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: Buffer.alloc(30) });
  await page.waitForFunction(() => !window.__uiTestState().busy && window.__uiTestState().jobs.some(job => job.status === 'failed'));
  assert.equal((await state()).source, false);
  assert.equal(await page.locator('#import-btn').isDisabled(), true);
  assert.match(await page.locator('#status-detail').textContent(), /PSD|文件|失败/);
  tests.push({ name: 'Invalid PSD produces readable error, records failed item and blocks import', passed: true });
  await selectFixture();
  assert.equal(await page.locator('#stat-layers').textContent(), '7');
  assert.equal(await page.locator('.font-row').count(), 2);
  const search = page.locator('.font-search-input').first();
  await search.fill('Inter');
  assert.match(await page.locator('.font-search-status').first().textContent(), /匹配/);
  await page.locator('.font-search-clear').first().click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(out, 'ui-preview.png'), fullPage: true, animations: 'disabled' });
  tests.push({ name: 'Real small PSB preflight preserves stats, fonts, search and clear with no overflow', passed: true });
  await page.evaluate(() => { window.__stallType = 'asset'; window.__heldCancel = null; window.__holdCancel = true; });
  await start();
  await page.waitForFunction(() => window.__stalled?.type === 'asset');
  await page.locator('#cancel-btn').click();
  await page.waitForFunction(() => Boolean(window.__heldCancel));
  assert.equal((await state()).busy, true, 'Cancellation cannot unlock before host terminal confirmation');
  assert.equal(await page.locator('#import-btn').isDisabled(), true);
  assert.equal(await page.locator('#clear-source-btn').isDisabled(), true);
  await page.evaluate(() => {
    window.__ack(window.__heldCancel.msg, window.__heldCancel.result);
    window.__heldCancel = null; window.__holdCancel = false; window.__stallType = null;
  });
  await idle();
  assert.equal((await state()).source, false);
  tests.push({ name: 'Cancel stays locked until terminal host ACK, then releases parsed source', passed: true });
  await selectFixture();
  await page.evaluate(() => { window.__requests = []; });
  await start();
  await page.waitForFunction(() => !window.__uiTestState().busy && window.__uiTestState().jobs.some(job => job.status === 'success'));
  const calls = await page.evaluate(() => window.__requests);
  assert.equal(calls[0].type, 'ping');
  assert.equal(calls[1].type, 'begin');
  const imported = calls.find(call => call.type === 'import');
  assert.ok(imported);
  assert.equal(calls[1].name, imported.documentName);
  assert.ok(calls.filter(call => call.type === 'asset').length > 0);
  assert.ok(calls.filter(call => call.type === 'asset').every(call => call.bytes > 0));
  assert.equal(imported.options.includeReference, false);
  assert.equal((await state()).source, false);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#report-btn').click()]);
  await download.saveAs(path.join(out, 'ui-report.json'));
  const reportText = fs.readFileSync(path.join(out, 'ui-report.json'), 'utf8');
  const report = JSON.parse(reportText);
  assert.equal(report.version, version);
  assert.equal(report.options.includeComposite, false);
  assert.equal(report.options.includeReference, false);
  assert.equal(report.files[0].figma.frameId, 'mock-frame');
  assert.doesNotMatch(reportText, /sourceStructure|__bridgeSourceBytes/);
  assert.ok(reportText.length < 100_000, 'Report remains compact for the tiny fixture');
  tests.push({ name: 'Fixture click → begin → binary assets → import → compact downloadable report; source released', passed: true, assetCount: calls.filter(call => call.type === 'asset').length, documentName: calls[1].name });
  for (const stalledType of ['ping', 'begin', 'asset', 'import']) {
    await selectFixture();
    await page.evaluate(type => { window.__stallType = type; window.__stalled = null; }, stalledType);
    await start();
    await page.waitForFunction(() => Boolean(window.__stalled));
    const started = Date.now();
    await page.locator('#cancel-btn').click();
    await page.waitForFunction(() => !window.__uiTestState().busy, undefined, { timeout: 2500 });
    assert.ok(Date.now() - started < 2500, 'Immediate terminal confirmation avoids waiting for abandoned request timeouts');
    const settled = await state();
    assert.ok(settled.jobs.some(job => job.status === 'cancelled'));
    await page.evaluate(() => {
      window.__ack(window.__stalled, { frameId: 'late', terminal: true, status: 'success' });
      window.__stallType = null;
    });
    assert.deepEqual(await state(), settled);
    tests.push({ name: `Cancel while ${stalledType} ACK missing waits terminal confirmation and ignores late ACK`, passed: true });
  }
  await selectFixture();
  await start();
  await page.waitForFunction(() => !window.__uiTestState().busy && window.__uiTestState().jobs.some(job => job.status === 'success'));
  tests.push({ name: 'Fresh re-selection succeeds after cancelled ping/begin/asset/import', passed: true });
  const fixtureBytes = fs.readFileSync(fixture);
  await page.locator('#file-input').setInputFiles([
    { name: 'same.psb', mimeType: 'application/octet-stream', buffer: fixtureBytes },
    { name: 'broken.psd', mimeType: 'application/octet-stream', buffer: Buffer.alloc(30) },
    { name: 'same.psb', mimeType: 'application/octet-stream', buffer: fixtureBytes },
  ]);
  await page.waitForFunction(() => window.__uiTestState().source && !window.__uiTestState().busy);
  await page.evaluate(() => { window.__requests = []; });
  await start();
  await page.waitForFunction(() => !window.__uiTestState().busy && window.__uiTestState().jobs.length === 3);
  assert.deepEqual((await state()).jobs.map(job => job.status), ['success', 'failed', 'success']);
  const multiCalls = await page.evaluate(() => window.__requests);
  const multiBegins = multiCalls.filter(call => call.type === 'begin');
  assert.deepEqual(multiBegins.map(call => call.name), ['same', 'same (2)']);
  assert.equal(new Set(multiBegins.map(call => call.sessionId)).size, 2);
  assert.deepEqual(multiCalls.filter(call => ['begin','import'].includes(call.type)).map(call => call.type), ['begin','import','begin','import']);
  assert.equal(await page.locator('#confirm-fonts-btn').isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#queue-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'ui-queue-complete.png'), animations: 'disabled' });
  tests.push({ name: 'Real-parser multi-select imports same-name files serially, skips corrupt middle item and reuses confirmed fonts', passed: true });
  await selectFixture();
  await page.evaluate(() => { window.__stallType = 'ping'; window.__requests = []; });
  await start();
  await page.waitForFunction(() => !window.__uiTestState().busy, undefined, { timeout: 12000 });
  const timeoutCalls = await page.evaluate(() => window.__requests.map(call => call.type));
  assert.ok(!timeoutCalls.includes('begin') && !timeoutCalls.includes('asset') && !timeoutCalls.includes('import'));
  assert.match(JSON.stringify((await state()).jobs), /通信未响应|暂停|超时/);
  tests.push({ name: 'Disconnected preflight pauses in 8 seconds before begin/conversion/assets', passed: true });
  // Only synthetic fixtures: real designs are never auto-discovered or read.
  assert.deepEqual(errors, []);
  tests.push({ name: 'No uncaught browser errors', passed: true });
  const result = { passed: true, runtime: 'Chromium, 440×680, real UI/parser with only synthetic small files and mocked Figma parent', tests };
  fs.writeFileSync(path.join(out, 'ui-tests.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const state = await page?.evaluate(() => ({ app: window.__uiTestState?.(), title: document.querySelector('#status-title')?.textContent, detail: document.querySelector('#status-detail')?.textContent, requests: window.__requests })).catch(() => undefined);
  fs.writeFileSync(path.join(out, 'ui-tests.json'), JSON.stringify({ passed: false, tests, error: error.message, state }, null, 2));
  throw error;
} finally { await browser.close(); }
