import { build } from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

fs.mkdirSync('test-output', { recursive: true });
await build({ entryPoints: ['src/text-paths.ts', 'src/normalize.ts'], bundle: true, platform: 'node', format: 'cjs', outdir: 'test-output/text-path-tests', external: ['ag-psd'] });
const require = createRequire(import.meta.url);
const { recoverTextPaths, normalizeTextPath } = require('../test-output/text-path-tests/text-paths.js');
const { normalizeText } = require('../test-output/text-path-tests/normalize.js');
const text = {
  text: 'Visible\nOverflow', transform: [2, 0, 0, 3, 100, 200],
  textPath: { bezierCurve: { controlPoints: [10, 20, 11, 20, 11, 21, 12, 21] }, data: { frameMatrix: [1, 0, 0, 1, -10, -20], textRange: [2, 6], pathData: { reversed: true } } },
};
assert.deepEqual(normalizeTextPath(text), { segments: [[100, 200, 102, 200, 102, 203, 104, 203]], reversed: true, textRange: [2, 6] });
assert.equal(normalizeText(text).characters, 'Visible\nOverflow', 'Path ranges must never slice the editable characters');
const invalid = { text: 'x', textPath: { bezierCurve: { controlPoints: [NaN, 0, 1, 0, 1, 1, 2, 1] }, data: {} } };
assert.equal(normalizeTextPath(invalid), undefined, 'Non-finite coordinates cannot reach Figma');
const asciiEngine = '<< /0 << /8 [ << /0 << /0 << /1 << /0 [ 0 0 1 0 1 1 2 1 ] >> /2 << /2 [ 1 0 0 1 0 0 ] /6 [ 0 1 ] >> >> >> >> ] >> /98 (101001) >>';
const fixture = { width: 10, height: 10, engineData: Buffer.from(asciiEngine).toString('base64'), children: [{ text: { text: 'x', index: 0 } }] };
assert.deepEqual(recoverTextPaths(fixture), { recovered: 1, asciiStrings: 1 }, 'Valid ASCII literal recovery must work independently of the private test source');
assert.equal(fixture.children[0].text.textPath.bezierCurve.controlPoints.length, 8);
const unknownEncoding = { ...fixture, children: [{ text: { text: 'x', index: 0 } }], engineData: Buffer.from(asciiEngine.replace('101001', '\u00ff'), 'latin1').toString('base64') };
assert.match(recoverTextPaths(unknownEncoding).error, /Unknown engine-data string encoding/, 'Unknown encodings must be reported rather than guessed');
const source = '../source/S3-Steam.psb';
if (fs.existsSync(source)) {
  const { readPsd } = require('ag-psd');
  const psd = readPsd(fs.readFileSync(source), { skipLayerImageData: true, skipCompositeImageData: true, skipLinkedFilesData: true, skipThumbnail: true, useImageData: true });
  const report = recoverTextPaths(psd);
  assert.deepEqual(report, { recovered: 4, asciiStrings: 2 }, 'Actual PSB has exactly four circle text paths lost to two ASCII literals');
  const paths = [];
  function walk(nodes) { for (const layer of nodes || []) { if (layer.text?.textPath) paths.push({ sourceLayerId: layer.id, text: normalizeText(layer.text), x: layer.left, y: layer.top, width: layer.right-layer.left, height: layer.bottom-layer.top }); walk(layer.children); } }
  walk(psd.children);
  assert.deepEqual(paths.map(layer => layer.sourceLayerId), [10864, 10865, 10880, 10881]);
  assert(paths.every(layer => layer.text.path.segments.length === 4));
  assert.equal(paths[0].text.characters, '专属权益\n权益');
  assert.deepEqual(recoverTextPaths(psd), { recovered: 0, asciiStrings: 2 }, 'Recovery must be idempotent');
  fs.writeFileSync('test-output/source-text-paths.json', JSON.stringify(paths, null, 2));
}
console.log('Text path tests passed: affine coordinates, full editable text, invalid data, actual PSB ASCII recovery and idempotence.');
