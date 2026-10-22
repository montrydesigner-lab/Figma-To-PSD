// Regression against a supplied prior UI source. Does not emulate a live Figma host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
const args=process.argv.slice(2);const original=args[0];
if(!original)throw new Error('Pass prior src/ui.ts to compare relay behavior');
async function exercise(path,mode){
 const source=fs.readFileSync(path,'utf8');const start=source.indexOf("window.addEventListener('message'");const end=source.indexOf('const waitForPaint',start);
 assert.ok(start>=0&&end>start);const js=await transform(source.slice(start,end),{loader:'ts',target:'es2017'});
 const parent={},relay={};let handler,settled=0;const pending=new Map([['random-correlated-request',{timer:0,resolve(){settled++;},reject(){settled++;}}]]);
 const context=vm.createContext({window:{addEventListener(type,fn){handler=fn;}},parent,pending,diagnostics:undefined,isBusy:false,sessionId:'s',clearTimeout(){}});
 vm.runInContext(js.code,context);handler({source:mode==='parent'?parent:mode==='null'?null:relay,data:{pluginMessage:{type:'ack',requestId:'random-correlated-request',ok:true,result:{}}}});
 return settled;
}
const checks=[];
for(const mode of ['parent','null','relay']){
 const before=await exercise(original,mode),after=await exercise('src/ui.ts',mode);
 assert.equal(before,mode==='relay'?0:1);assert.equal(after,1);checks.push({source:mode,beforeAcknowledged:before===1,afterAcknowledged:after===1});
}
const report={passed:true,scope:'Isolated actual UI message listeners with synthetic MessageEvents; proves source-gate incompatibility under a relay event, not that the user host emitted that event',checks};
fs.writeFileSync('test-output/source-relay-regression.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
