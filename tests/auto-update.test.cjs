'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.resolve(__dirname,'../public/myon-auto-update.js'),'utf8');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40);
const flush=async()=>{for(let i=0;i<300;i++)await Promise.resolve()};
function harness({clock={ms:1760000000000},store=new Map(),target=B,online=true,hidden=false,
 checkpoint=async()=>true,build=A,version='0.13.54'}={}){
 const nodes=new Map(),intervals=[],events={},navs=[],requests=[];
 const get=id=>{
  if(nodes.has(id))return nodes.get(id);
  const e={id,hidden:true,textContent:'',style:{},attributes:{},setAttribute(k,v){this.attributes[k]=String(v)}};
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
  setOnline(x){online=x},setTarget(x){target=x},setVersion(x){version=x},
  setCheckpoint(x){window.MYON_SAFE_UPDATE_CHECKPOINT=x}
 };
}
test('two-row banner shows installed and latest version, central percentage, bare big countdown',async()=>{
 const a=harness();await a.ready();
 assert.equal(a.nodes.get('auto-update-title').textContent,'신규 업데이트 적용 중');
 assert.equal(a.nodes.get('auto-update-version-from').textContent,'v0.13.53');
 assert.equal(a.nodes.get('auto-update-version-to').textContent,'v0.13.54');
 assert.equal(a.nodes.get('auto-update-remaining').textContent,'60:00');
 assert.equal(a.nodes.get('auto-update-percent').textContent,'0%');
 assert.equal(a.nodes.get('auto-update-progress').attributes['aria-valuenow'],'0');
 await a.advance(27*60000);
 assert.equal(a.nodes.get('auto-update-remaining').textContent,'33:00');
 assert.equal(a.nodes.get('auto-update-percent').textContent,'45%');
 assert.equal(a.nodes.get('auto-update-progress').attributes['aria-valuenow'],'45');
});
test('latest version label and time reset together on a second deployed commit',async()=>{
 const a=harness();await a.ready();await a.advance(29*60000);
 a.setTarget(C);a.setVersion('0.13.55');await a.poll();
 assert.equal(a.nodes.get('auto-update-version-from').textContent,'v0.13.53');
 assert.equal(a.nodes.get('auto-update-version-to').textContent,'v0.13.55');
 assert.equal(a.nodes.get('auto-update-remaining').textContent,'60:00');
 assert.equal(a.nodes.get('auto-update-percent').textContent,'0%');
 assert.equal(a.navs.length,0);
});
test('deployed commit starts 60-minute timer, not an immediate refresh',async()=>{
 let checks=0;
 const a=harness({checkpoint:async()=>{checks++;return true}});
 await a.ready();
 assert.equal(a.nodes.get('auto-update-banner').hidden,false);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'0%');
 assert.equal(a.nodes.get('auto-update-remaining').textContent,'60:00');
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
 assert.equal(b.nodes.get('auto-update-remaining').textContent,'24:00');
 await b.advance(24*60000);
 assert.equal(b.navs.length,1);
});
test('every newer deployed commit restarts the full 60-minute wait',async()=>{
 const a=harness();await a.ready();await a.advance(25*60000);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'41%');
 a.setTarget(C);await a.poll();
 assert.equal(a.nodes.get('auto-update-percent').textContent,'0%');
 assert.equal(a.nodes.get('auto-update-remaining').textContent,'60:00');
 await a.advance(35*60000); // Original B rollout reaches its former deadline.
 assert.equal(a.nodes.get('auto-update-percent').textContent,'58%');
 assert.equal(a.navs.length,0);
 a.setTarget(D);await a.poll(); // Another commit arrives before C's full hour.
 assert.equal(a.nodes.get('auto-update-percent').textContent,'0%');
 await a.advance(59*60000);
 assert.equal(a.navs.length,0);
 await a.advance(60000);
 assert.equal(a.navs.length,1);
 assert.ok(a.navs[0].includes('myon_commit='+D.slice(0,12)));
});
test('the reset timer for a newer commit persists after restarting the browser',async()=>{
 const store=new Map(),clock={ms:1760000000000};
 const a=harness({store,clock});await a.ready();await a.advance(50*60000);
 a.setTarget(C);await a.poll();
 assert.equal(a.nodes.get('auto-update-percent').textContent,'0%');
 const b=harness({store,clock,target:C});await b.ready();
 assert.equal(b.nodes.get('auto-update-remaining').textContent,'60:00');
 await b.advance(40*60000);
 assert.equal(b.nodes.get('auto-update-percent').textContent,'66%');
 assert.equal(b.navs.length,0);
 await b.advance(20*60000);
 assert.equal(b.navs.length,1);
 assert.ok(b.navs[0].includes('myon_commit='+C.slice(0,12)));
});
test('new commit appearing during final save check prevents outdated refresh',async()=>{
 let a,attempts=0;
 a=harness({checkpoint:async()=>{
  attempts++;
  if(attempts===1)a.setTarget(C);
  return true;
 }});
 await a.ready();
 await a.advance(60*60000);
 assert.equal(a.navs.length,0);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'0%');
 assert.equal(a.nodes.get('auto-update-remaining').textContent,'60:00');
 await a.advance(60*60000);
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

test('multiple open tabs share the restarted timer for the newest deployed commit',async()=>{
 const store=new Map(),clock={ms:1760000000000};
 const a=harness({store,clock,target:B}),b=harness({store,clock,target:B});
 await a.ready();await b.ready();
 await a.advance(20*60000);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'33%');
 b.setTarget(C);await b.poll();
 assert.equal(b.nodes.get('auto-update-percent').textContent,'0%');
 await a.advance(1000);
 assert.equal(a.nodes.get('auto-update-percent').textContent,'0%');
 assert.equal(a.nodes.get('auto-update-remaining').textContent,'59:59');
 assert.equal(a.navs.length,0);
});

test('markup keeps status, percent and timer in first row, versions and bar in second',()=>{
 const page=fs.readFileSync(path.resolve(__dirname,'../public/myon.html'),'utf8');
 const top=page.match(/<div class="auto-update-top">([\s\S]*?)<\/div>/);
 const bottom=page.match(/<div class="auto-update-sub">([\s\S]*?)<\/div>/);
 assert.ok(top&&bottom);
 for(const id of ['auto-update-title','auto-update-percent','auto-update-remaining'])
  assert.ok(top[1].includes('id="'+id+'"'));
 for(const id of ['auto-update-version-from','auto-update-version-to'])
  assert.ok(bottom[1].includes('id="'+id+'"'));
 assert.ok(page.includes('class="auto-update-progress"'));
 assert.ok(page.includes('font-size:21px'));
 assert.ok(page.includes('class="auto-update-detail"'));
});

test('updater has a real progressbar element and defensive renderer for absent DOM nodes',()=>{
 const page=fs.readFileSync(path.resolve(__dirname,'../public/myon.html'),'utf8');
 assert.match(page,/<div id="auto-update-progress" class="auto-update-progress"/);
 assert.match(script,/if\(progressBar\)progressBar\.setAttribute/);
});
