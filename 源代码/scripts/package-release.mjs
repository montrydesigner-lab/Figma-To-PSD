import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.1.6';
const name = `Montry-PSD-PSB-Bridge-${version}`;
const releaseDirectory = path.resolve(root, '../release');
const baseline = process.env.PSD_BRIDGE_BASELINE || path.resolve(root, '../../task/Figma-To-PSD/源代码');
const hash = data => createHash('sha256').update(data).digest('hex');
const read = file => fs.readFileSync(path.join(root, file));
const text = file => read(file).toString('utf8');
const baselineZip = fs.readFileSync(path.resolve(baseline, '../安装包/Montry-PSD-PSB-Bridge-0.1.5.zip'));
assert.equal(hash(baselineZip), 'fd7333ec630b87febb953e7c8746bef636afef9cdb9e3a27f21a10e1d371468c', 'Original 0.1.5 ZIP unchanged');
const baselineArchive = unzipSync(baselineZip);
for (const [file, data] of Object.entries(baselineArchive)) {
  const relative = file.replace(/^Montry-PSD-PSB-Bridge-0\.1\.5\//, '');
  if (relative.startsWith('src/') || relative.startsWith('dist/')) assert.deepEqual(fs.readFileSync(path.join(baseline, relative)), Buffer.from(data), `Original 0.1.5 source unchanged: ${relative}`);
}
const stable = ['src/font-search.ts', 'src/pipeline.ts', 'src/normalize.ts', 'src/png.ts', 'src/raster.ts', 'src/raster-effects.ts', 'src/styles.ts', 'src/text-paths.ts', 'src/types.ts', 'manifest.json'];
const preservation = stable.map(file => {
  assert.deepEqual(read(file), fs.readFileSync(path.join(baseline, file)), `Unchanged fidelity module ${file}`);
  return { path: file, sha256: hash(read(file)), identicalTo015: true };
});
const lock = JSON.parse(text('package-lock.json'));
const oldLock = JSON.parse(fs.readFileSync(path.join(baseline, 'package-lock.json'), 'utf8'));
const normalizedLock = structuredClone(lock);
normalizedLock.version = oldLock.version;
normalizedLock.packages[''].version = oldLock.packages[''].version;
assert.deepEqual(normalizedLock, oldLock, 'Dependency graph unchanged');
fs.writeFileSync(path.join(root, 'test-output/core-preservation-016.json'), JSON.stringify({ version, baseline: 'Local delivered 0.1.5', passed: true, unchangedFiles: preservation, dependenciesUnchanged: true }, null, 2));

const files = ['README.md','CHANGELOG.md','TEST_REPORT.md','HANDOFF-0.1.6.md','THIRD_PARTY_LICENSES.txt','manifest.json','package.json','package-lock.json','tsconfig.json'];
function addDirectory(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) addDirectory(child); else files.push(child);
  }
}
for (const dir of ['src','scripts','samples']) addDirectory(dir);
for (const file of ['code.js','ui.html','importer-test.js','pipeline.cjs']) files.push(`dist/${file}`);
for (const file of fs.readdirSync(path.join(root, 'test-output'))) {
  if (/-tests\.json$/.test(file) || file === 'core-preservation-016.json' || file === 'final-validation-016.json' || /^final-.*-016\.log$/.test(file)) files.push(`test-output/${file}`);
}
for (const file of files.filter(file => file.endsWith('-tests.json'))) {
  const result = JSON.parse(text(file));
  assert.notEqual(result.passed, false, file);
  assert.ok(!result.failures?.length, file);
  for (const test of result.tests || []) if (typeof test === 'object') assert.notEqual(test.passed, false, file);
}
const validation = JSON.parse(text('test-output/final-validation-016.json'));
assert.equal(validation.version, version);
for (const check of ['typecheck','build','offlineTests','browserTests','queueBrowserTests']) assert.equal(validation[check], true, `Final ${check}`);
for (const [file, sha256] of Object.entries(validation.sourceHashes)) assert.equal(hash(read(file)), sha256, `Product source unchanged since final tests: ${file}`);
assert.equal(JSON.parse(text('package.json')).version, version);
assert.equal(lock.version, version);
assert.match(text('src/ui.html'), /LOCAL \/ 0\.1\.6/);
assert.doesNotMatch(text('src/ui.html'), /id="include-reference"/);
assert.match(text('src/code.ts'), /version: '0\.1\.6'/);
assert.match(text('src/diagnostics.js'), /VERSION = '0\.1\.6'/);
const manifest = JSON.parse(text('manifest.json'));
assert.equal(manifest.main, 'dist/code.js');
assert.equal(manifest.ui, 'dist/ui.html');
assert.deepEqual(manifest.networkAccess.allowedDomains, ['none']);
const records = files.sort().map(file => ({ path: file, bytes: read(file).length, sha256: hash(read(file)) }));
const packageManifest = { version, builtAt: new Date().toISOString(), baseline: '0.1.5 local delivery', published: false, validation: 'Synthetic offline and isolated browser mocks only; no live Figma or large-file stress test', files: records };
fs.writeFileSync(path.join(root, 'PACKAGE_MANIFEST.json'), JSON.stringify(packageManifest, null, 2));
files.push('PACKAGE_MANIFEST.json');
const entries = {};
for (const file of files) entries[`${name}/${file}`] = read(file);
const zipped = zipSync(entries, { level: 9 });
const unpacked = unzipSync(zipped);
assert.equal(Object.keys(unpacked).length, files.length);
for (const file of files) assert.deepEqual(Buffer.from(unpacked[`${name}/${file}`]), read(file), `ZIP byte integrity ${file}`);
fs.mkdirSync(releaseDirectory, { recursive: true });
const zipPath = path.join(releaseDirectory, `${name}.zip`);
fs.writeFileSync(zipPath, zipped);
const releaseValidation = { ...validation, zip: zipPath, zipBytes: zipped.length, zipSha256: hash(zipped), files: files.length, manifestEntrypointsVerified: true, allPackedBytesVerified: true, fidelityModulesIdenticalTo015: true, original015ZipAndSourcesUnchanged: true, realFigmaVerified: false, largeFileStressTest: false };
fs.writeFileSync(path.join(releaseDirectory, 'RELEASE_VALIDATION-0.1.6.json'), JSON.stringify(releaseValidation, null, 2));
fs.writeFileSync(path.join(releaseDirectory, 'SHA256SUMS-0.1.6.txt'), `${releaseValidation.zipSha256}  ${name}.zip\n`);
console.log(JSON.stringify(releaseValidation, null, 2));
