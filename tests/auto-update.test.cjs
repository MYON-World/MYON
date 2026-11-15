'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.resolve(__dirname,'../public/myon-auto-update.js'),'utf8');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40);
const flush=async()=>{for(let n=0;n<300;n++)await Promise.resolve()};
function harness({clock={ms:1760000000000},store=new Map(),build=A,online=true,hidden=false,
 releases=[{revision:A,version:'0.13.53'},{revision:B,version:'0.13.54'}],checkpoint=async()=>true}={}){
 const elements=new Map(),intervals=[],events={},navs=[],requests=[];
 const node=id=>{
  if(elements.has(id))return elements.get(id);
  const x={hidden:true,textContent:'',style:{},attributes:{},setAttribute(k,v){this.attributes[k]=String(v)}};
  elements.set(id,x);return x;
 };
 const document={hidden,getElementById:node,addEventListener:(type,fn)=>events[type]=fn};
 const location={pathname:'/MYON/releases/'+build+'/myon.html',search:'?build='+build};
 const parent={location:{href:'https://example.github.io/MYON/',
  replace(url){navs.push(url)}}};
 const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 if(!store.has('myon-release-state-v2'))store.set('myon-release-state-v2',JSON.stringify(
  {schema:2,installed:build,phase:'idle',target:'',startedAt:0}));
 const window={parent,localStorage,MYON_SAFE_UPDATE_CHECKPOINT:checkpoint,
  MYON_CANCEL_UPDATE_LOCK:()=>{},addEventListener:(type,fn)=>events[type]=fn};
 class FakeDate extends Date{static now(){return clock.ms}}
 const fetch=async url=>{
  requests.push(String(url));return online?{ok:true,json:async()=>({schema:1,releases})}:{ok:false};
 };
 const setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length};
 vm.runInNewContext(script,{window,document,location,localStorage,URL,URLSearchParams,Date:FakeDate,fetch,setInterval,
  console:{warn(){},error(){},log(){}}},{timeout:2000});
 return {elements,intervals,events,navs,requests,store,clock,document,
  state:()=>JSON.parse(store.get('myon-release-state-v2')),
  async ready(){await flush()},
  async advance(ms){clock.ms+=ms;for(const x of intervals)if(x.ms===1000)x.fn();await flush()},
  async poll(){for(const x of intervals)if(x.ms===60000)await x.fn();await flush()},
  setReleases(v){releases=v},setOnline(v){online=v},setCheckpoint(v){window.MYON_SAFE_UPDATE_CHECKPOINT=v}};
}
test('FIFO rollout pins first commit and leaves its full hour unchanged by new commits',async()=>{
 const a=harness();await a.ready();
 assert.equal(a.state().target,B);
 assert.equal(a.elements.get('auto-update-version-to').textContent,'v0.13.54');
 await a.advance(30*60000);
 assert.equal(a.elements.get('auto-update-percent').textContent,'50%');
 a.setReleases([{revision:A,version:'0.13.53'},{revision:B,version:'0.13.54'},
  {revision:C,version:'0.13.55'},{revision:D,version:'0.13.55'}]);
 await a.poll();
 assert.equal(a.state().target,B);
 assert.equal(a.elements.get('auto-update-percent').textContent,'50%');
 assert.equal(a.elements.get('auto-update-remaining').textContent,'30:00');
 await a.advance(30*60000);
 assert.equal(a.navs.length,1);
 assert.equal(a.state().installed,B);
 assert.equal(a.state().phase,'cooldown');
});
test('after installation wait another hour BEFORE starting next rollout hour',async()=>{
 const store=new Map(),clock={ms:1760000000000};
 const entries=[{revision:A,version:'0.13.53'},{revision:B,version:'0.13.54'},{revision:C,version:'0.13.55'}];
 const a=harness({store,clock,releases:entries});await a.ready();
 await a.advance(60*60000);
 assert.equal(a.navs.length,1);
 const b=harness({store,clock,build:B,releases:entries});await b.ready();
 assert.equal(b.state().phase,'cooldown');
 assert.equal(b.elements.get('auto-update-title').textContent,'다음 커밋 대기 중');
 await b.advance(59*60000);
 assert.equal(b.state().phase,'cooldown');
 await b.advance(60000);
 assert.equal(b.state().phase,'rollout');
 assert.equal(b.state().target,C);
 assert.equal(b.elements.get('auto-update-remaining').textContent,'60:00');
 assert.equal(b.navs.length,0);
 await b.advance(60*60000);
 assert.equal(b.navs.length,1);
 assert.equal(b.state().installed,C);
});
test('rollout timer survives reload, offline verification cannot force an update',async()=>{
 const store=new Map(),clock={ms:1760000000000};
 const a=harness({store,clock});await a.ready();await a.advance(20*60000);
 const b=harness({store,clock});await b.ready();
 assert.equal(b.elements.get('auto-update-remaining').textContent,'40:00');
 b.setOnline(false);await b.advance(40*60000);
 assert.equal(b.navs.length,0);
 assert.equal(b.state().installed,A);
 b.setOnline(true);await b.poll();await b.advance(31000);
 assert.equal(b.navs.length,1);
});
test('failed safe save checkpoint never updates installed revision',async()=>{
 let allow=false;const a=harness({checkpoint:async()=>allow});await a.ready();
 await a.advance(60*60000);
 assert.equal(a.navs.length,0);
 assert.equal(a.state().installed,A);
 allow=true;await a.advance(31000);
 assert.equal(a.navs.length,1);
 assert.equal(a.state().installed,B);
});
test('when no newer revisions exist, old game remains pinned without a banner',async()=>{
 const a=harness({releases:[{revision:A,version:'0.13.53'}]});await a.ready();
 assert.equal(a.elements.get('auto-update-banner').hidden,true);
 await a.advance(3*3600000);
 assert.equal(a.navs.length,0);
});
test('manifest lookup uses root release manifest, never local archived build metadata',async()=>{
 const a=harness();await a.ready();
 assert.ok(a.requests.every(url=>url.startsWith('../../myon-rollouts.json?')));
});
test('game keeps version pair, percent, timer and accessible bar',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../public/myon.html'),'utf8');
 for(const id of ['auto-update-title','auto-update-percent','auto-update-remaining',
  'auto-update-version-from','auto-update-version-to','auto-update-progress'])
  assert.ok(html.includes('id="'+id+'"'));
 assert.ok(script.includes('phase===\'cooldown\''));
});
