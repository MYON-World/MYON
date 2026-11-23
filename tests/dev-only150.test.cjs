'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'public/myon-150.html'),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1],KEY='MYON_DEV_MISSIONS_V1_0.14.13';
function harness(legacy={}){
 const data=new Map(Object.entries(legacy)),elements=new Map(),window={setInterval(){}};
 let now=Date.UTC(2026,10,23,0,0,0);
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 function el(id){
  if(!elements.has(id))elements.set(id,{
   textContent:'',innerHTML:'',hidden:true,disabled:true,dataset:{},
   classList:{toggle(){}},style:{width:'',setProperty(){}},
   setAttribute(){},addEventListener(){},getBoundingClientRect(){return {width:320}}
  });
  return elements.get(id);
 }
 const document={getElementById:el,querySelectorAll(){return []}};
 const localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const ctx=vm.createContext({document,localStorage,window,console,Math,Intl,JSON,Object,
  Date:FakeDate,URLSearchParams,location:{search:'?server=dev&dev_version=0.14.13&build='+'1'.repeat(40)}});
 vm.runInContext('const DEV_SAVE_VERSION="0.14.13";',ctx);
 vm.runInContext(script,ctx,{timeout:3000});
 return {data,elements,ctx,window,run:q=>vm.runInContext(q,ctx),tick:ms=>{now+=ms;vm.runInContext('update()',ctx)}};
}
const saved=s=>JSON.parse(s.data.get(KEY));
test('original MYON layout is retained and 150 normal fields remain',()=>{
 assert.match(html,/class="top-identity"/);
 assert.match(html,/class="mw-root"/);
 assert.match(html,/class="mw-money-strip"/);
 assert.doesNotMatch(html,/MYON · 임무 150/);
 assert.doesNotMatch(html,/150개 분야 임무/);
 const s=harness(),g=saved(s);
 assert.equal(g.stats.length,150);
 assert.equal(g.offers.length,4);
 assert.ok(g.offers.every(m=>m.acceptCost===0));
 assert.equal(g.cash,0);
 assert.equal(g.uiRion.phase,'waiting');
 assert.equal(typeof s.window.MYON_SAFE_UPDATE_CHECKPOINT,'function');
 for(const key of ['rions','myonite','worldR0'])assert.equal(key in g,false);
});
test('UI Rion appears after one hour and does not expire before acceptance',()=>{
 const s=harness();
 s.tick(3600000);
 assert.equal(saved(s).uiRion.phase,'pending');
 assert.match(s.elements.get('offers').innerHTML,/알 수 없는 임무/);
 s.tick(5*3600000);
 assert.equal(saved(s).uiRion.phase,'pending');
 assert.match(s.elements.get('offers').innerHTML,/알 수 없는 임무/);
 assert.equal(s.run('rionAccept()'),true);
 assert.equal(saved(s).uiRion.phase,'active');
});
test('UI Rion completes 60-minute stages; 40-50min fills menu and locks at 100%',()=>{
 const s=harness();
 s.tick(3600000);s.run('rionAccept()');
 assert.equal(s.run('rionStage(Date.now())[1]'),'분석중');
 s.tick(20*60000);
 assert.equal(s.run('rionStage(Date.now())[1]'),'UI 리온');
 s.tick(20*60000);
 assert.equal(s.run('rionStage(Date.now())[1]'),'세팅중');
 assert.equal(s.elements.get('ui-rion-nav').hidden,false);
 assert.equal(s.elements.get('ui-rion-title').textContent,'메뉴 세팅중');
 assert.equal(s.elements.get('ui-rion-lock').hidden,true);
 s.tick(5*60000);
 assert.equal(s.elements.get('ui-rion-fill').style.width,'50%');
 s.tick(5*60000);
 assert.equal(s.elements.get('ui-rion-title').textContent,'리온');
 assert.equal(s.elements.get('ui-rion-lock').hidden,false);
 assert.equal(s.elements.get('ui-rion-fill').disabled,true);
 s.tick(10*60000);
 assert.equal(saved(s).uiRion.phase,'done');
 assert.equal(s.elements.get('ui-rion-nav').hidden,false);
 assert.ok(saved(s).history.some(x=>x.type==='ui-rion'));
});
test('ongoing tasks are sorted by earliest completion, including Rion',()=>{
 const s=harness();
 s.tick(3600000);s.run('rionAccept()');
 s.run('game.active.push({id:"late",field:0,minutes:120,endsAt:Date.now()+7200000,expiresAt:Date.now()+7200000,acceptCost:0,money:100, direct:.10})');
 s.run('render()');
 const content=s.elements.get('active').innerHTML;
 assert.ok(content.indexOf('분석중')>=0&&content.indexOf('분석중')<content.indexOf('곡물'));
});
test('DEV starts fresh and never imports previous-version mission, cash or Rion progress',()=>{
 const initial=saved(harness());
 const legacy={...initial,cash:456,uiRion:{phase:'done',acceptedAt:Date.UTC(2026,10,22),completedAt:Date.UTC(2026,10,22)+3600000},
  rions:{discovered:[{id:'rion.role.ui'}]},offers:initial.offers.slice(0,1)};
 const raw=JSON.stringify(legacy);
 const oldKey='MYON_DEV_MISSIONS_V1_0.14.10';
 const s=harness({[oldKey]:raw,'MYON_DEV_MISSIONS_V1_0.14.9.1':raw});
 const current=saved(s);
 assert.equal(current.cash,0);
 assert.equal(current.offers.length,4);
 assert.equal(current.uiRion.phase,'waiting');
 assert.equal(current.history.length,0);
 assert.equal(s.data.get(oldKey),raw);
 for(const k of ['rions','myonite','worldR0'])assert.equal(k in current,false);
});
test('DEV route and LIVE/TEST pins remain unchanged',()=>{
 const next=fs.readFileSync(path.join(root,'public/myon-next.html'),'utf8');
 const entry=fs.readFileSync(path.join(root,'src/core/myon-server-entry.mjs'),'utf8');
 assert.match(next,/myon-150\.html/);
 assert.match(entry,/version:'0\.14\.11'/);
 assert.match(entry,/version:'0\.13\.94'/);
});
