import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
const source = fs.readFileSync('src/ui.ts', 'utf8');
const compiled = await build({stdin: {contents: source + '\nglobalThis.testUI = { startImport, setSource(value) { source=value; } };',loader:'ts',resolveDir:process.cwd()+'/src'},bundle:true,write:false,platform:'browser',plugins:[{name:'small-pipeline-fixture',setup(b){b.onResolve({filter:/^\.\/pipeline$/},()=>({path:'pipeline',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export async function inspectFile(){throw new Error('not exercised')}; export async function convertPsd(psd,name,options,callbacks){await callbacks.onAsset('tiny',new Uint8Array([1,2,3])); return {name,width:8,height:8,layers:[],report:[]};}`,loader:'js'}));}}]});
class Element {
  constructor(){this.hidden=false;this.disabled=false;this.checked=true;this.textContent='';this.children=[];this.style={};this.handlers={};this.classList={toggle(){},add(){},remove(){}};}
  addEventListener(type,fn){this.handlers[type]=fn;} append(...nodes){this.children.push(...nodes);} replaceChildren(){this.children=[];}
  setAttribute(){} remove(){} click(){this.handlers.click?.({});} get childElementCount(){return this.children.length;}
}
const elements = new Map(); const el = id => {if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const handlers={};const requests=[];let stalledType;let stalled;let responseSource=null;let activePending=[];
let context;
const parent={postMessage(data){const msg=data.pluginMessage;requests.push(msg);if(msg.type===stalledType){stalled=msg;return;}
 queueMicrotask(()=>ack(msg.requestId,msg.type==='fonts'?{fonts:[]}:msg.type==='import'?{frameId:'mock'}:{protocol:2,version:'0.1.4',handlerRegistered:true}));}};
function ack(id,result={},source=responseSource){handlers.message({source,data:{pluginMessage:{type:'ack',requestId:id,ok:true,result}}});}
context=vm.createContext({console,crypto:webcrypto,Uint32Array,Uint8Array,Map,Set,Date,Math,Error,Blob,URL,parent,
 setTimeout(fn,ms){return setTimeout(fn,ms>=8000?150:ms);},clearTimeout,
 requestAnimationFrame:fn=>setTimeout(fn,0),document:{getElementById:el,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener(){},body:new Element()},
 window:{addEventListener(type,fn){handlers[type]=fn;}}});
vm.runInContext(compiled.outputFiles[0].text,context);
const flush=()=>new Promise(r=>setTimeout(r,5)); await flush();
assert.equal(requests[0].type,'ping');assert.equal(requests[1].type,'fonts');
const fixture={name:'tiny.psd',psd:{},summary:{width:8,height:8,layers:1,textLayers:0,imageLayers:1,groups:0,hiddenLayers:0,fonts:[],visibleFonts:[],warnings:[]}};
context.testUI.setSource(fixture);
const tests=['Startup ping and fonts accept null-source correlated ACKs'];
for(const mode of [null,parent,context.window,{}]){
 responseSource=mode;requests.length=0;await context.testUI.startImport();
 assert.equal(el('status-title').textContent,'导入完成');assert.deepEqual(requests.map(x=>x.type),['ping','begin','asset','import']);
 tests.push(`Tiny transport flow succeeds with ${mode===null?'null':mode===parent?'parent':mode===context.window?'self':'relay'} ACK source`);
}
for(const type of ['ping','begin','asset','import']){
 stalledType=type;stalled=undefined;const run=context.testUI.startImport();
 for(let i=0;i<20&&!stalled;i++)await flush();assert.ok(stalled,`reached ${type}`);
 // Guessed and unknown request IDs cannot settle a pending operation.
 ack('guessed-request-id',{},{});ack('unknown');
 handlers.message({source:null,data:{pluginMessage:{type:'ack',requestId:stalled.requestId,ok:'true',result:{}}}});await flush();assert.equal(el('import-btn').disabled,true);
 el('cancel-btn').click();await run;assert.equal(el('status-title').textContent,'已取消导入');assert.equal(el('import-btn').disabled,false);
 ack(stalled.requestId,{frameId:'late'});await flush();assert.equal(el('status-title').textContent,'已取消导入');
 tests.push(`Cancel stalled ${type} immediately, reject guessed/unknown ACKs, ignore late success`);
 stalledType=undefined;await context.testUI.startImport();assert.equal(el('status-title').textContent,'导入完成');
}
stalledType='ping';requests.length=0;await context.testUI.startImport();assert.equal(el('status-title').textContent,'导入未完成');assert.match(el('status-detail').textContent,/通信未响应/);assert.ok(!requests.some(x=>['begin','asset','import'].includes(x.type)));
tests.push('Unresponsive handshake fails before conversion (production 8s timer accelerated to 150ms)');
stalledType='begin';requests.length=0;await context.testUI.startImport();assert.equal(el('status-title').textContent,'导入未完成');assert.ok(!requests.some(x=>['asset','import'].includes(x.type)));
tests.push('Unresponsive begin fails before assets/import');
const result={passed:true,runtime:'Node VM executing bundled real UI source; minimal DOM, stub pipeline and host; no Figma or browser rendering validation',tests};
fs.writeFileSync('test-output/ui-transport-tests.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
