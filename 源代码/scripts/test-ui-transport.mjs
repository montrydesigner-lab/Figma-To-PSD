import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
const source = fs.readFileSync('src/ui.ts', 'utf8');
const version = source.match(/version:\s*['"]([\d.]+)['"]/)?.[1];
const compiled = await build({ stdin: { contents: source + `
  globalThis.testUI = { chooseFile, startImport, clearSource,
    state() { return { source, isBusy, sessionId, jobs, blocked, queueRunning }; } };`, loader: 'ts', resolveDir: process.cwd() + '/src' },
  bundle: true, write: false, platform: 'browser', plugins: [{ name: 'small-pipeline-fixture', setup(b) {
    b.onResolve({ filter: /^\.\/pipeline$/ }, () => ({ path: 'pipeline', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export async function inspectFile(file) { return {name:file.name,psd:{},summary:{width:8,height:8,layers:1,textLayers:0,imageLayers:1,groups:0,hiddenLayers:0,fonts:[],visibleFonts:[],warnings:[]}}; }
      export async function convertPsd(psd,name,options,callbacks) {
        await callbacks.onAsset('tiny',new Uint8Array([1,2,3]));
        return {name:name.replace(/\\.(psd|psb)$/i,''),width:8,height:8,layers:[],report:[]};
      }`, loader: 'js' }));
  } }] });
class Element {
  constructor() { this.hidden=false; this.disabled=false; this.checked=true; this.textContent=''; this.children=[]; this.style={}; this.handlers={}; this.attributes={}; this.className='';
    this.classList={ toggle(){},add(){},remove(){},contains(){return false;} }; }
  addEventListener(type,fn){this.handlers[type]=fn;} append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this.attributes[name]=value;} getAttribute(name){return this.attributes[name];} remove(){} focus(){} click(){if(!this.disabled)this.handlers.click?.({});}
  get childElementCount(){return this.children.length;} get firstElementChild(){return this.children[0];}
}
const flush=()=>new Promise(r=>setTimeout(r,5));
async function until(predicate, label) { for(let i=0;i<100;i++){if(predicate())return;await flush();}assert.ok(predicate(),label); }
async function harness() {
  const elements=new Map(),handlers={},requests=[],timers=new Set();
  const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  let stalledType,stalled,responseSource=null;
  function ack(id,result={},ok=true,error,delivery=responseSource){handlers.message({source:delivery,data:{pluginMessage:{type:'ack',requestId:id,ok,result,error}}});}
  const parent={postMessage(data){const msg=data.pluginMessage;requests.push(msg);if(msg.type===stalledType){stalled=msg;return;}
    const result=msg.type==='fonts'?{fonts:[]}:msg.type==='import'?{frameId:'mock',terminal:true,status:'success'}:msg.type==='begin'?{targetPageId:'page'}:msg.type==='cancel'?{terminal:true,status:'cancelled'}:{protocol:3,version,handlerRegistered:true};
    queueMicrotask(()=>ack(msg.requestId,result));}};
  const context=vm.createContext({console,crypto:webcrypto,Uint32Array,Uint8Array,Map,Set,Date,Math,Error,Blob,URL,parent,
    setTimeout(fn,ms){const timer=setTimeout(()=>{timers.delete(timer);fn();},ms>=8000?300:ms);timers.add(timer);return timer;},clearTimeout(timer){clearTimeout(timer);timers.delete(timer);},
    requestAnimationFrame:fn=>setTimeout(fn,0),document:{getElementById:el,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener(){},body:new Element()},
    window:{addEventListener(type,fn){handlers[type]=fn;}}});
  vm.runInContext(compiled.outputFiles[0].text,context); await flush();
  return {api:context.testUI,el,requests,handlers,parent,window:context.window,ack,
    stall(type){stalledType=type;stalled=undefined;}, get stalled(){return stalled;}, source(value){responseSource=value;},
    async load(){await context.testUI.chooseFile({name:'tiny.psd',size:64});},
    dispose(){for(const timer of timers)clearTimeout(timer);}};
}
const tests=[];
for(const mode of ['null','parent','self','relay']) {
  const h=await harness();try{
    assert.deepEqual(h.requests.map(x=>x.type),['ping','fonts']);
    h.source(mode==='null'?null:mode==='parent'?h.parent:mode==='self'?h.window:{});
    await h.load();h.requests.length=0;await h.api.startImport();
    assert.match(h.el('status-title').textContent,/完成/);
    assert.deepEqual(h.requests.map(x=>x.type),['ping','begin','asset','import']);
    assert.equal(h.api.state().source,undefined,'Successful session releases parsed source');
    tests.push(`Tiny transport flow accepts correlated ${mode}-source ACKs and releases the completed source`);
  } finally {h.dispose();}
}
for(const type of ['ping','begin','asset','import']) {
  const h=await harness();try{
    await h.load();h.stall(type);const run=h.api.startImport();await until(()=>h.stalled,`reached ${type}`);const old=h.stalled;
    h.ack('guessed-request-id');h.ack('unknown');
    h.handlers.message({source:null,data:{pluginMessage:{type:'ack',requestId:old.requestId,ok:'true',result:{}}}});await flush();
    assert.equal(h.el('import-btn').disabled,true,'Uncorrelated/malformed replies cannot settle a request');
    h.el('cancel-btn').click();await run;
    assert.equal(h.api.state().isBusy,false,'Cancellation releases UI only after safe completion');
    assert.equal(h.api.state().blocked,false,'Confirmed cancellation does not block future work');
    const status=h.el('status-title').textContent;
    h.ack(old.requestId,{frameId:'late'});await flush();assert.equal(h.el('status-title').textContent,status,'Late ACK ignored');
    h.stall(undefined);await h.load();await h.api.startImport();assert.match(h.el('status-title').textContent,/完成/);
    tests.push(`Cancel stalled ${type}, reject guessed/unknown/malformed ACKs, ignore late success, then safely restart`);
  } finally {h.dispose();}
}
for(const type of ['ping','begin']) {
  const h=await harness();try{
    await h.load();h.stall(type);h.requests.length=0;await h.api.startImport();
    assert.match(h.el('status-title').textContent,/停止|暂停|锁定/);
    assert.match(h.api.state().jobs[0].error,/通信|超时|响应/,'The per-file row retains the connection error');
    assert.ok(!h.requests.some(x=>['asset','import'].includes(x.type)),'No conversion/asset write after failed handshake');
    if(type==='ping')assert.ok(!h.requests.some(x=>x.type==='begin'));
    tests.push(`Unresponsive ${type} stops before conversion (production timers accelerated to 300ms)`);
  } finally {h.dispose();}
}
const result={passed:true,runtime:'Node VM executing bundled real UI source; minimal DOM, synthetic tiny pipeline and host; no Figma or browser rendering validation',tests};
fs.mkdirSync('test-output',{recursive:true});fs.writeFileSync('test-output/ui-transport-tests.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
