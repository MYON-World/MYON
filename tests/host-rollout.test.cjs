'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const imported=()=>import('../src/core/myon-rollout-host.mjs');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40);
const V=[{revision:A,version:'0.13.51'},{revision:B,version:'0.13.52'},
 {revision:C,version:'0.13.53'},{revision:D,version:'0.13.54'}];
const KEY='myon-release-state-v2',T=1760000000000,H=3600000;
const flush=async()=>{for(let i=0;i<300;i++)await Promise.resolve()};
async function harness({releases=V,store=new Map(),clock={ms:T},allowCheckpoint=true,allowFile=true,
 online=true,hidden=false,initial=A}={}){
 const {createRolloutHost}=await imported();
 if(!store.has(KEY))store.set(KEY,JSON.stringify({schema:2,installed:initial,phase:'idle',target:'',startedAt:0}));
 const elem=new Map(),calls=[],events={},intervals=[],versions=[];
 const node=id=>{if(!elem.has(id))elem.set(id,{hidden:false,textContent:'',style:{},
  attributes:{},setAttribute(k,v){this.attributes[k]=v}});return elem.get(id)};
 const page={getElementById:node};
 let savedUrl='https://example.github.io/MYON/releases/'+initial+'/myon.html?build='+initial;
 const frame={src:savedUrl,contentDocument:page,contentWindow:{
  location:{href:savedUrl},MYON_SAFE_UPDATE_CHECKPOINT:async()=>allowCheckpoint,
  MYON_CANCEL_UPDATE_LOCK:()=>{}}};
 const win={location:{href:'https://example.github.io/MYON/'},
  addEventListener:(name,fn)=>events[name]=fn,console:{warn(){}},MYON_ROLLOUT_HOST_ACTIVE:false};
 const doc={hidden,addEventListener:(name,fn)=>events[name]=fn};
 const storage={getItem:key=>store.get(key)||null,setItem:(key,v)=>store.set(key,v)};
 const request=async(url,opts={})=>{
  calls.push({url:String(url),method:opts.method||'GET'});
  if(!online)return {ok:false};
  if(opts.method==='HEAD')return {ok:allowFile};
  return {ok:true,json:async()=>({schema:1,releases})};
 };
 let controller;
 controller=createRolloutHost({base:'/MYON/',win,doc,storage,initialReleases:releases,
  getFrame:()=>frame,
  setFrame:url=>{
   savedUrl='https://example.github.io'+url;
   frame.src=savedUrl;frame.contentWindow.location.href=savedUrl;
   controller.onLoad();
  },
  onVersion:v=>versions.push(v),
  now:()=>clock.ms,request,
  schedule:(fn,ms)=>{intervals.push({fn,ms});return intervals.length}});
 controller.start();await flush();
 return {
  frame,elem,calls,events,versions,doc,win,controller,clock,store,intervals,
  state:()=>JSON.parse(store.get(KEY)),
  getBuild:()=>new URL(frame.src).searchParams.get('build'),
  setReleases:r=>{releases=r},
  setOnline:v=>{online=v},
  setAllowFile:v=>{allowFile=v},
  setCheckpoint:v=>{allowCheckpoint=v},
  async advance(ms){clock.ms+=ms;for(const entry of intervals)if(entry.ms===1000)entry.fn();await flush();},
  async poll(){await controller.poll();await flush();}
 };
}
test('parent launcher alone owns rollout even when new commits land mid-countdown',async()=>{
 const s=await harness({releases:V.slice(0,2)});
 assert.equal(s.win.MYON_ROLLOUT_HOST_ACTIVE,true);
 assert.equal(s.state().installed,A);
 assert.equal(s.state().target,B);
 assert.equal(s.elem.get('auto-update-version-to').textContent,'v0.13.52');
 await s.advance(25*60000);
 s.setReleases(V);
 await s.poll();
 assert.equal(s.state().target,B);
 assert.equal(s.state().startedAt,T);
 assert.equal(s.elem.get('auto-update-percent').textContent,'41%');
 await s.advance(35*60000);
 assert.equal(s.state().installed,B);
 assert.equal(s.getBuild(),B);
 assert.equal(s.state().phase,'cooldown');
 assert.equal(s.state().target,'');
 assert.equal(s.versions.at(-1),'0.13.52');
});
test('next commit waits 60 minutes with no countdown then gets its OWN 60 minutes',async()=>{
 const s=await harness();
 await s.advance(H);
 assert.equal(s.getBuild(),B);
 assert.equal(s.state().phase,'cooldown');
 await s.advance(H-1000);
 assert.equal(s.state().phase,'cooldown');
 assert.equal(s.elem.get('auto-update-title').textContent,'다음 커밋 대기 중');
 await s.advance(1000);
 assert.equal(s.state().phase,'rollout');
 assert.equal(s.state().target,C);
 assert.equal(s.elem.get('auto-update-percent').textContent,'0%');
 assert.equal(s.elem.get('auto-update-remaining').textContent,'60:00');
 await s.advance(H);
 assert.equal(s.getBuild(),C);
 assert.equal(s.state().phase,'cooldown');
 await s.advance(H);
 assert.equal(s.state().phase,'rollout');
 assert.equal(s.state().target,D);
 await s.advance(H);
 assert.equal(s.getBuild(),D);
 assert.equal(s.state().phase,'cooldown');
});
test('newly deployed HEAD may not replace a pinned intermediate snapshot or timer',async()=>{
 const s=await harness();
 const start=s.state().startedAt;
 s.setReleases([...V,{revision:'e'.repeat(40),version:'0.13.55'}]);
 await s.advance(19*60000);
 await s.poll();
 assert.equal(s.state().target,B);
 assert.equal(s.state().startedAt,start);
 await s.advance(41*60000);
 assert.equal(s.getBuild(),B);
 assert.equal(s.state().phase,'cooldown');
});
test('missing archive, refused save checkpoint and offline metadata cannot jump to latest',async()=>{
 const s=await harness();
 s.setAllowFile(false);await s.advance(H);
 assert.equal(s.state().installed,A);
 assert.equal(s.getBuild(),A);
 s.setAllowFile(true);s.setCheckpoint(false);
 await s.advance(31000);
 assert.equal(s.state().installed,A);
 s.setCheckpoint(true);s.setOnline(false);
 await s.advance(31000);
 assert.equal(s.state().installed,A);
 s.setOnline(true);await s.advance(31000);
 assert.equal(s.state().installed,B);
 assert.equal(s.getBuild(),B);
});
test('parent never changes installed commit when persisted state disappears',async()=>{
 const s=await harness();s.store.delete(KEY);
 await s.advance(H);
 assert.equal(s.getBuild(),A);
 assert.equal(s.calls.some(c=>c.url.includes('/releases/'+D+'/myon.html')),false);
});
test('archived iframe updater delegates and cannot start its own timer',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../public/myon-auto-update.js'),'utf8');
 const win={parent:{MYON_ROLLOUT_HOST_ACTIVE:true},addEventListener(){}};
 const intervals=[];
 vm.runInNewContext(source,{window:win,document:{getElementById:()=>({})},
  location:{pathname:'/MYON/releases/'+A+'/myon.html',search:'?build='+A},
  console:{warn(){}},setInterval:(fn,t)=>intervals.push(t)}, {timeout:2000});
 assert.equal(intervals.length,0,'Iframe updater must never compete with parent host');
});
test('new portal suppresses archived FIFO updater and enters LIVE only by choice',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 const main=fs.readFileSync(path.resolve(__dirname,'../src/main.js'),'utf8');
 assert.match(app,/MYON_ROLLOUT_HOST_ACTIVE=true/);
 assert.match(app,/@load="onGameLoad"/);
 assert.match(app,/function enterLive\(\)/);
 assert.match(app,/function leaveLive\(\)/);
 assert.doesNotMatch(app,/coordinator\.start\(\)/);
 assert.doesNotMatch(app,/createRolloutHost\(/);
 assert.doesNotMatch(main,/initializeMyonIndex\(/);
 assert.match(app,/transaction\(STORE,'readonly'\)/);
 assert.doesNotMatch(app,/localStorage\.setItem\(ROLLOUT_KEY/);
});

test('emergency launcher opens latest game irrespective of pinned rollout or missing metadata',()=>{
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.vue'),'utf8');
 assert.match(app,/const FALLBACK_GAME='[a-f0-9]{40}'/);
 assert.match(app,/openPinned\(latestRevision.value/);
 assert.match(app,/:disabled="entering"/);
 assert.doesNotMatch(app,/localStorage\.setItem\(ROLLOUT_KEY/);
 assert.doesNotMatch(app,/createRolloutHost\(/);
 assert.match(app,/window.MYON_ROLLOUT_HOST_ACTIVE=true/);
});
