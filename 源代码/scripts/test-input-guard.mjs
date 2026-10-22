import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
await build({entryPoints:['src/pipeline.ts'],outfile:'test-output/input-guard-pipeline.cjs',bundle:true,platform:'node',format:'cjs',external:['ag-psd']});
const require=createRequire(import.meta.url);const {inspectFile}=require('../test-output/input-guard-pipeline.cjs');
const small=fs.readFileSync('test-output/fixtures/layered-fixture.psd');
const buffer=()=>small.buffer.slice(small.byteOffset,small.byteOffset+small.byteLength);
const tests=[];let reads=0;
await assert.rejects(inspectFile({name:'oversize.psd',size:1_500_000_001,arrayBuffer:async()=>{reads++;return buffer();}}),/1\.5 GB/);
assert.equal(reads,0);tests.push('Above 1,500,000,000-byte input rejected before reading; cap unchanged');
const atCap=await inspectFile({name:'boundary.psd',size:1_500_000_000,arrayBuffer:async()=>{reads++;return buffer();}});
assert.equal(atCap.summary.width,96);tests.push('Exactly-at-cap metadata passes guard using tiny fixture bytes (no large allocation)');
const zip=Buffer.from(zipSync({'one.psd':new Uint8Array([1,2,3])}));
const central=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert.ok(central>=0);
zip.writeUInt32LE(1_500_000_001,central+24);
await assert.rejects(inspectFile(new File([zip],'oversize-entry.zip')),/解压后的 PSB 超过 1\.5 GB/);
tests.push('Tiny ZIP with oversized declared entry rejected by filter before decompression/allocation');
{
 let cancelled=true,called=false;await assert.rejects(inspectFile({name:'cancelled.psd',size:1,arrayBuffer:async()=>{called=true;return buffer();}},undefined,()=>cancelled),/读取已取消/);assert.equal(called,false);
 tests.push('Already-cleared source does not begin reading');
}
{
 let cancelled=false,called=false;
 await assert.rejects(inspectFile({name:'cancelled.psd',size:small.length,arrayBuffer:async()=>{called=true;return buffer();}},()=>{cancelled=true;},()=>cancelled),/读取已取消/);assert.equal(called,false);
 tests.push('Clear during first progress/yield prevents byte read');
}
{
 let cancelled=false,resolveRead,startedResolve;const started=new Promise(r=>startedResolve=r);
 const promise=inspectFile({name:'late.psd',size:26,arrayBuffer:()=>{startedResolve();return new Promise(r=>resolveRead=r);}},undefined,()=>cancelled);
 await started;cancelled=true;resolveRead(new ArrayBuffer(26));await assert.rejects(promise,/读取已取消/);
 tests.push('Late read after clear rejected before header parsing');
}
for(const zipInput of [false,true]){
 let cancelled=false;const file=new File(zipInput?[new Uint8Array(30)]:[small],zipInput?'cancelled.zip':'cancelled.psd');
 await assert.rejects(inspectFile(file,stage=>{if(stage.startsWith(zipInput?'解压':'解析'))cancelled=true;},()=>cancelled),/读取已取消/);
 tests.push(`Clear at ${zipInput?'ZIP decompression':'PSD parsing'} yield prevents synchronous stage`);
}
const result={passed:true,scope:'Small fixtures and metadata-only boundary checks; never reads/allocates a 1.5GB file',tests};fs.writeFileSync('test-output/input-guard-tests.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
