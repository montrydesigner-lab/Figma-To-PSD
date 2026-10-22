import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  launch.executablePath = await chromium.executablePath();
  launch.args = chromium.args;
}
const compiled = await build({ entryPoints: [path.join(root, 'src/ui.ts')], bundle: true, target: 'es2020', platform: 'browser', write: false, minify: true });
const htmlFile = path.join(out, 'ui-test.html');
fs.writeFileSync(htmlFile, fs.readFileSync(path.join(root, 'src/ui.html'), 'utf8').replace('<!--APP_SCRIPT-->', () => `<script>${compiled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`));
const browser = await playwright.chromium.launch(launch);
const tests = [];
try {
  const page = await browser.newPage({ viewport: { width: 440, height: 680 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  await page.addInitScript(() => {
    window.__requests = [];
    window.__assetDelay = 0;
    window.__name = '';
    window.addEventListener('message', event => {
      const msg = event.data.pluginMessage;
      if (!msg || !['ping', 'fonts', 'begin', 'asset', 'import', 'cancel'].includes(msg.type)) return;
      window.__requests.push({ type: msg.type, name: msg.name, documentName: msg.document?.name, bytes: msg.bytes?.byteLength });
      if (window.__stallType === msg.type) { window.__stalled = msg; return; }
      let result; let ok = true; let error;
      if (msg.type === 'ping') result = {protocol:2,version:'0.1.4',handlerRegistered:true};
      if (msg.type === 'fonts') result = { fonts: [{ family: 'Arial', style: 'Regular' }, { family: 'Arial', style: 'Bold' }, { family: 'Inter', style: 'Regular' }, {family:'Source Han Sans SC',style:'Bold'}] };
      if (msg.type === 'begin') window.__name = msg.name;
      if (msg.type === 'import') {
        if (msg.document.name !== window.__name) { ok = false; error = 'Document name mismatch'; }
        result = { frameId: 'mock-frame', issues: [{ message: '字体匹配检查完成' }] };
      }
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source: null, data: { pluginMessage: { type: 'ack', requestId: msg.requestId, ok, result, error } } })), msg.type === 'asset' ? window.__assetDelay : 0);
    });
  });
  await page.goto(`file://${htmlFile}`);
  const cjkFontCss = '/tmp/psd-ui-browser/node_modules/@fontsource/noto-sans-sc/400.css';
  if (fs.existsSync(cjkFontCss)) {
    await page.addStyleTag({content: fs.readFileSync(cjkFontCss, 'utf8').replace(/url\(\.\/files\/([^)]+)\)/g, (_, filename) => `url(file:///tmp/psd-ui-browser/node_modules/@fontsource/noto-sans-sc/files/${filename})`) + '\nbody{font-family:"Noto Sans SC",Inter, sans-serif;}'});
    await page.evaluate(() => document.fonts.ready);
  }
  assert.equal(await page.locator('#import-btn').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  tests.push({ name: 'Initial empty state, disabled import, no horizontal overflow', passed: true });
  await page.screenshot({ path: path.join(out, 'ui-empty.png') });
  await page.locator('#file-input').setInputFiles({ name: 'broken.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: Buffer.alloc(30) });
  await page.waitForFunction(() => document.querySelector('#status-title').textContent === '无法读取文件');
  assert.equal(await page.locator('#import-btn').isDisabled(), true);
  tests.push({ name: 'Invalid PSD produces readable error and blocks import', passed: true });
  const fixture = path.join(out, 'fixtures/layered-fixture.psb');
  await page.locator('#file-input').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('#status-title').textContent === '已准备好导入');
  assert.equal(await page.locator('#stat-layers').textContent(), '7');
  assert.equal(await page.locator('.font-row').count(), 2);
  await page.evaluate(() => { window.__assetDelay = 250; });
  await page.locator('#import-btn').click();
  await page.locator('#cancel-btn').click();
  await page.waitForFunction(() => document.querySelector('#status-title').textContent === '已取消导入');
  assert.equal(await page.evaluate(() => window.__requests.some(x => x.type === 'cancel')), true);
  assert.equal(await page.locator('#import-btn').isDisabled(), false);
  tests.push({ name: 'Cancel clears busy state and supports retry', passed: true });
  await page.evaluate(() => { window.__assetDelay = 0; window.__requests = []; });
  await page.locator('#import-btn').click();
  await page.waitForFunction(() => document.querySelector('#status-title').textContent === '导入完成');
  const calls = await page.evaluate(() => window.__requests);
  assert.equal(calls[0].type, 'ping');
  assert.equal(calls[1].type, 'begin');
  assert.equal(calls.at(-1).type, 'import');
  assert.equal(calls[1].name, calls.at(-1).documentName);
  assert.ok(calls.filter(x => x.type === 'asset').length > 0);
  assert.ok(calls.filter(x => x.type === 'asset').every(x => x.bytes > 0));
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#report-btn').click()]);
  await download.saveAs(path.join(out, 'ui-report.json'));
  const report = JSON.parse(fs.readFileSync(path.join(out, 'ui-report.json'), 'utf8'));
  assert.equal(report.version, '0.1.4');
  assert.equal(report.figma.frameId, 'mock-frame');
  tests.push({ name: 'Fixture UI click → begin → binary assets → import → downloadable JSON report', passed: true, assetCount: calls.filter(x => x.type === 'asset').length, documentName: calls[1].name });
  // No acknowledgements from the host: cancellation must not wait 3/30 minutes.
  for (const stalledType of ['ping', 'begin', 'asset', 'import']) {
    await page.evaluate(type => { window.__stallType = type; window.__stalled = null; }, stalledType);
    await page.locator('#import-btn').click();
    await page.waitForFunction(() => Boolean(window.__stalled));
    const started = Date.now();
    await page.locator('#cancel-btn').click();
    await page.waitForFunction(() => document.querySelector('#status-title').textContent === '已取消导入', undefined, {timeout: 2000});
    assert.ok(Date.now() - started < 2000);
    assert.equal(await page.locator('#import-btn').isDisabled(), false);
    await page.evaluate(() => {
      // A stale success must not turn a cancelled import into success.
      window.dispatchEvent(new MessageEvent('message', {source: null, data: {pluginMessage: {type: 'ack', requestId: window.__stalled.requestId, ok: true, result: {frameId: 'late'}}}}));
      window.__stallType = null;
    });
    assert.equal(await page.locator('#status-title').textContent(), '已取消导入');
    tests.push({name: `Cancel while ${stalledType} ACK is missing clears UI promptly; late ACK ignored`, passed: true});
  }
  await page.locator('#import-btn').click();
  await page.waitForFunction(() => document.querySelector('#status-title').textContent === '导入完成');
  tests.push({name: 'Successful retry after cancelled ping/begin/asset/import', passed: true});
  await page.evaluate(() => { window.__stallType = 'ping'; window.__requests = []; });
  await page.locator('#import-btn').click();
  await page.waitForFunction(() => document.querySelector('#status-title').textContent === '导入未完成', undefined, {timeout: 12000});
  const timeoutCalls = await page.evaluate(() => window.__requests.map(x => x.type));
  assert.ok(!timeoutCalls.includes('begin') && !timeoutCalls.includes('asset') && !timeoutCalls.includes('import'));
  assert.match(await page.locator('#status-detail').textContent(), /通信未响应/);
  assert.equal(await page.locator('#import-btn').isDisabled(), false);
  tests.push({name: 'Disconnected preflight fails in 8 seconds before begin/conversion/assets', passed: true});
  await page.evaluate(() => { window.__stallType = null; });
  const sourceFile = process.env.PSD_UI_SOURCE || path.resolve(root, '../source/S3-Steam.psb');
  if (fs.existsSync(sourceFile)) {
    await page.locator('#file-input').setInputFiles(sourceFile);
    await page.waitForFunction(() => document.querySelector('#status-title').textContent === '已准备好导入', undefined, { timeout: 180_000 });
    const preflight = await page.evaluate(() => ({
      canvas: document.querySelector('#canvas-size').textContent,
      layers: document.querySelector('#stat-layers').textContent,
      text: document.querySelector('#stat-text').textContent,
      images: document.querySelector('#stat-images').textContent,
      groups: document.querySelector('#stat-groups').textContent,
      fonts: document.querySelectorAll('.font-row').length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.ok(Number(preflight.layers) > 7);
    assert.equal(preflight.horizontalOverflow, false);
    tests.push({ name: 'Actual 221 MB S3 Steam PSB UI preflight', passed: true, ...preflight });
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, 'ui-preview.png') });
  }
  assert.deepEqual(errors, []);
  tests.push({ name: 'No uncaught browser errors', passed: true });
  const result = { passed: true, runtime: 'Chromium, 440×680, local isolated UI with mocked Figma parent only', tests };
  fs.writeFileSync(path.join(out, 'ui-tests.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  fs.writeFileSync(path.join(out, 'ui-tests.json'), JSON.stringify({ passed: false, tests, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
