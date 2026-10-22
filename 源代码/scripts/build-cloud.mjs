/**
 * Build the account-plugin payload without making network calls or publishing.
 * Run the ordinary build first. Optional: --out-dir /tmp/cloud-build --tail-out /tmp/tail.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function arg(name, fallback) { const at = args.indexOf(name); if (at === -1) return fallback; if (!args[at + 1]) throw new Error(`${name} needs a path`); return path.resolve(args[at + 1]); }
const out = arg('--out-dir', path.join(root, 'dist'));
const tailOut = arg('--tail-out', path.join(root, 'test-output/cloud-bootstrap-tail.json'));
const ui = await fs.readFile(path.join(root, 'dist/ui.html'), 'utf8');
const base64 = zlib.gzipSync(Buffer.from(ui), { level: 9 }).toString('base64');
const head = base64.slice(0, 95_000), tail = base64.slice(95_000);
const cloudHtml = `<!doctype html><html><meta charset="utf-8"><body style="background:#151515;color:#e5e5e5;font:13px system-ui;padding:24px"><p id="status">正在载入 PSD / PSB Bridge…</p><script>
const head=${JSON.stringify(head)};
async function boot(event){if((event.source!==parent&&event.source!==null)||event.data?.pluginMessage?.type!=="bridge-bootstrap-data")return;window.removeEventListener('message',boot);try{const raw=atob(head+event.data.pluginMessage.part);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));const html=await new Response(stream).text();document.open();document.write(html);document.close();}catch(e){document.getElementById('status').textContent='加载失败，请使用本地安装包：'+e.message;}}
window.addEventListener('message',boot);parent.postMessage({pluginMessage:{type:'bridge-bootstrap'}},'*');
</script></body></html>`;
const stripImports = text => text.replace(/^import[^\n]*\n/gm, '');
const typesSource = stripImports(await fs.readFile(path.join(root, 'src/types.ts'), 'utf8'));
const cut = typesSource.indexOf('export interface NormalizeOptions');
if (cut < 0) throw new Error('Cannot locate the transport type boundary in src/types.ts');
const types = typesSource.slice(0, cut);
const importer = stripImports(await fs.readFile(path.join(root, 'src/importer.ts'), 'utf8'));
let code = stripImports(await fs.readFile(path.join(root, 'src/code.ts'), 'utf8'));
const anchor = '  const { requestId } = msg;';
if (code.split(anchor).length !== 2) throw new Error('Expected exactly one UI request dispatch anchor');
code = code.replace(anchor, () => `${anchor}\n  if (msg.type === "bridge-bootstrap") { figma.ui.postMessage({type:"bridge-bootstrap-data",part:${JSON.stringify(tail)}}); return; }`);
const cloudCode = `${types}\n${importer}\n${code}`;
await fs.mkdir(out, { recursive: true });
await fs.mkdir(path.dirname(tailOut), { recursive: true });
await fs.writeFile(path.join(out, 'cloud-ui.html'), cloudHtml);
await fs.writeFile(path.join(out, 'cloud-code.ts'), cloudCode);
await fs.writeFile(tailOut, JSON.stringify(tail));
await build({ stdin: { contents: cloudCode, loader: 'ts', sourcefile: 'cloud-code.ts' }, outfile: path.join(out, 'cloud-main.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2017', minify: true, logLevel: 'silent' });
if (zlib.gunzipSync(Buffer.from(head + tail, 'base64')).toString('utf8') !== ui) throw new Error('Cloud UI round-trip mismatch');
console.log(JSON.stringify({ cloudUiBytes: Buffer.byteLength(cloudHtml), cloudCodeBytes: Buffer.byteLength(cloudCode), originalUiBytes: Buffer.byteLength(ui), headCharacters: head.length, tailCharacters: tail.length, output: out, published: false }, null, 2));
