import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync('src/diagnostics.js','utf8');
const tests=[];
function boot(host = null) {
 const handlers={}, requests=[],timers=new Map();let next=0;
 const nodes=Object.fromEntries(['connection-status','connection-check','diagnostics-download'].map(id=>[id,{textContent:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}}]));
 const parent={postMessage(data){requests.push(data.pluginMessage);}}, top={};
 const window={top,addEventListener(type,fn){handlers[type]=fn;}};
 const context=vm.createContext({parent,window,document:{getElementById:id=>nodes[id]},Date,Math,JSON,Object,String,setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}});
 vm.runInContext(code.replace('/*PSD_BRIDGE_BOOT*/null',JSON.stringify(host)),context);
 const state=window.__PSD_DIAGNOSTICS__.state;
 const ack=(requestId,result,source=top)=>handlers.message({source,origin:'https://www.figma.com',data:{pluginMessage:{type:'ack',requestId,ok:true,result}}});
 return {state,handlers,nodes,requests,timers,ack,window,parent,top};
}
const host={version:'0.1.6',handlerRegistered:true,mainLoaded:true,protocol:3,bootId:'fixture'};
for(const kind of ['parent','top','self','null','relay','undefined']) {
 const b=boot(host);const source=kind==='parent'?b.parent:kind==='top'?b.top:kind==='self'?b.window:kind==='null'?null:kind==='undefined'?undefined:{};
 // Override ack default to test actual undefined MessageEvent source.
 b.handlers.message({source,data:{pluginMessage:{type:'ack',requestId:b.requests[0].requestId,ok:true,result:host}}});
 assert.equal(b.state.connection,'connected');assert.equal(b.state.lastProbe.source,kind);assert.equal(b.timers.size,0);
}
tests.push('Independent correlated probe accepts and classifies parent/top/self/null/relay/undefined host delivery');
{
 const b=boot();for(const id of ['unknown','__proto__','constructor'])b.ack(id,host);assert.equal(b.state.connection,'checking');
 b.timers.values().next().value.fn();assert.equal(b.state.connection,'unresponsive');assert.match(b.nodes['connection-status'].textContent,/启动标记未收到/);assert.equal(b.state.hostBootstrap,null);
 tests.push('Unknown/prototype request IDs ignored; missing main marked unresponsive after one bounded probe');
}
{
 const b=boot(host);b.timers.values().next().value.fn();assert.match(b.nodes['connection-status'].textContent,/主程序已加载/);
 b.nodes['connection-check'].handlers.click();assert.equal(b.requests.length,2);b.ack(b.requests[1].requestId,host);assert.equal(b.state.connection,'connected');
 tests.push('Main bootstrap plus missing ACK distinguished; manual read-only probe retries once');
}
{
 const b=boot(host);b.ack(b.requests[0].requestId,{version:'0.1.1',handlerRegistered:true});assert.equal(b.state.connection,'version-mismatch');assert.match(b.nodes['connection-status'].textContent,/版本不匹配/);
 tests.push('Mismatched UI/main versions surfaced explicitly');
}
{
 const b=boot(host);b.handlers.error({message:'Application syntax error'});b.ack(b.requests[0].requestId,host);assert.equal(b.state.uiScript,'error');assert.equal(b.state.connection,'connected');assert.match(b.nodes['connection-status'].textContent,/应用脚本异常/);
 assert.equal(b.state.events.find(e=>e.stage==='ui-error').detail,'Application syntax error');
 tests.push('Diagnostics stays functional when application bundle throws');
}
const html=fs.readFileSync('dist/ui.html','utf8');assert.ok(html.includes('/*PSD_BRIDGE_BOOT*/null'));assert.ok(html.indexOf('Standalone ES5 diagnostics')<html.indexOf('Missing UI element'));
tests.push('Built UI includes independent diagnostic script before application and boot marker for main injection');
{
 let rendered; const figma={ui:{postMessage(){}},root:{setRelaunchData(){}},showUI(value){assert.equal(typeof this.ui.onmessage,'function');rendered=value;}};
 vm.runInNewContext(fs.readFileSync('dist/code.js','utf8'),{figma,__html__:'<script>var boot = /*PSD_BRIDGE_BOOT*/null;</script>',console},{timeout:1000});
 assert.ok(!rendered.includes('/*PSD_BRIDGE_BOOT*/null'));
 const injected=JSON.parse(rendered.slice(rendered.indexOf('{'),rendered.lastIndexOf('}')+1));
 assert.equal(injected.version,'0.1.6');assert.equal(injected.handlerRegistered,true);assert.equal(injected.mainLoaded,true);assert.equal(injected.timerAvailable,false);
 tests.push('Real main bundle injects marker after handler registration; startup works even without browser timers');
}
const result={passed:true,scope:'Node VM of standalone diagnostic script with synthetic host/timers; not a live Figma result',tests};fs.writeFileSync('test-output/diagnostics-tests.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
