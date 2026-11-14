'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.resolve(__dirname,'../public/myon-auto-update.js'),'utf8');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40);
const flush=async()=>{for(let i=0;i<300;i++)await Promise.resolve()};
function harness({clock={ms:1760000000000},store=new Map(),target=B,online=true,hidden=false,
 checkpoint=async()=>true,build=A,version='0.13.50'}={}){
 const nodes=new Map(),intervals=[],events={},navs=[],requests=[];
 const get=id=>{
  if(nodes.has(id))return nodes.get(id);
  const e={id,hidden:true,textContent:'',style:{}};
  nodes.set(id,e);return e;
 };
 const document={hidden,getElementById:get,addEventListener:(type,fn)=>events[type]=fn};
 const location={pathname:'/MYON/myon.html',search:'?build='+build};
 const parent={location:{href:'https://example.github.io/MYON/?mode=taxi',
  replace(url){navs.push(url)}}};
 const storage={
  getItem:k=>store.get(k)||null,
  setItem:(k,v)=>{store.set(k,v)},
  removeItem:k=>store.delete(k)};
 const window={parent,localStorage:storage,MYON_SAFE_UPDATE_CHECKPOINT:checkpoint,
  MYON_CANCEL_UPDATE_LOCK:()=>{},addEventListener:(type,fn)=>events[type]=fn};
 class FakeDate extends Date{static now(){return clock.ms}}
 const fetch=async url=>{
  requests.push(String(url));
  if(!online)return {ok:false};
  return {ok:true,json:async()=>({revision:target,version})};
 };
 const setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length};
 vm.runInNewContext(script,{window,document,location,Date:FakeDate,URL,URLSearchParams,fetch,setInterval,
  console:{warn(){},error(){},log(){}}},{timeout:2000});
 return {
  nodes,intervals,events,navs,requests,clock,store,document,
  async ready(){await flush()},
  async advance(ms){
   clock.ms+=ms;
   for(const x of intervals)if(x.ms===1000)x.fn();
   await flush();
  },
  async poll(){for(const x of intervals)if(x.ms===60000)await x.fn();await flush()},
  setOnline(x){online=x},setTarget(x){target=x},
  setCheckpoint(x){window.MYON_SAFE_UPDATE_CHECKPOINT=x}
 };
}
test('deployed commit starts 60-minute timer, not an immediate refresh',async()=>{
 let checks=0;
 const a=harness({checkpoint:async()=>{checks++;return true}});
 await a.ready();
 assert.equal(a.nodes.get('auto-update-banner').hidden,false);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'0%');
 assert.equal(a.nodes.get('auto-update-remaining').textContent,'남은 60:00');
 assert.equal(a.navs.length,0);
 await a.advance(30*60000);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'50%');
 assert.equal(a.navs.length,0);
 await a.advance(30*60000);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'100%');
 assert.equal(checks,1);
 assert.equal(a.navs.length,1);
 assert.ok(a.navs[0].includes('myon_commit='+B.slice(0,12)));
});
test('one-hour timer survives iframe reload or browser restart',async()=>{
 const clock={ms:1760000000000},store=new Map();
 const a=harness({clock,store});await a.ready();await a.advance(36*60000);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'60%');
 const b=harness({clock,store});await b.ready();
 assert.equal(b.nodes.get('auto-update-percent').textContent,'60%');
 assert.equal(b.nodes.get('auto-update-remaining').textContent,'남은 24:00');
 await b.advance(24*60000);
 assert.equal(b.navs.length,1);
});
test('newer commit during rollout updates target but preserves countdown',async()=>{
 const a=harness();await a.ready();await a.advance(25*60000);
 a.setTarget(C);await a.poll();
 assert.equal(a.nodes.get('auto-update-percent').textContent,'41%');
 await a.advance(35*60000);
 assert.equal(a.navs.length,1);
 assert.ok(a.navs[0].includes('myon_commit='+C.slice(0,12)));
});
test('offline deployment verification postpones reload after 100 percent',async()=>{
 const a=harness();await a.ready();a.setOnline(false);
 await a.advance(60*60000);
 assert.equal(a.navs.length,0);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'100%');
 a.setOnline(true);await a.poll();
 await a.advance(31000);
 assert.equal(a.navs.length,1);
});
test('a rejected save checkpoint never forces a refresh and retries later',async()=>{
 let calls=0;
 const a=harness({checkpoint:async()=>{calls++;return false}});
 await a.ready();await a.advance(60*60000);
 assert.equal(a.navs.length,0);
 assert.equal(calls,1);
 assert.match(a.nodes.get('auto-update-detail').textContent,/세이브 보호/);
 a.setCheckpoint(async()=>{calls++;return true});
 await a.advance(31000);
 assert.equal(a.navs.length,1);
 assert.equal(calls,2);
});
test('already-installed revision produces no banner or navigation',async()=>{
 const a=harness({target:A});await a.ready();
 assert.equal(a.nodes.get('auto-update-banner').hidden,true);
 await a.advance(3*3600000);
 assert.equal(a.navs.length,0);
});
test('background tab remains pending until player returns',async()=>{
 const a=harness({hidden:true});await a.ready();
 await a.advance(60*60000);
 assert.equal(a.navs.length,0);
 a.document.hidden=false;
 a.events.visibilitychange();
 await flush();
 await a.advance(1000);
 assert.equal(a.navs.length,1);
});
