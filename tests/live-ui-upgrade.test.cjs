'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const pinned='ea0a7b3e4589a4116ccbf903528b1d3b05af2937';
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pinnedRead=name=>execFileSync('git',['show',pinned+':public/'+name],{cwd:root,encoding:'utf8'});
const frozen=[
 ['myon-rions.js','myon-live-ui-rions.js'],
 ['myon-dev-mining-ui.js','myon-live-ui-mining-ui.js'],
 ['myon-rion-registry.json','myon-live-ui-registry.json'],
 ['myon-world-baseline.json','myon-live-ui-baseline.json'],
 ['myon-city-names.json','myon-live-ui-city-names.json']
];
test('LIVE remains the exact official v0.14.5.2 economy, Rion discovery, mining and registry',()=>{
 for(const [original,copy] of frozen)
  assert.equal(read('public/'+copy),pinnedRead(original),'modified official code: '+original);
 const original=pinnedRead('myon-dev-missions.js');
 const expected=original
  .replace("fetch('./myon-world-baseline.json'","fetch('./myon-live-ui-baseline.json'")
  .replace("fetch('./myon-city-names.json'","fetch('./myon-live-ui-city-names.json'")
  .replace("fetch('./myon-rion-registry.json'","fetch('./myon-live-ui-registry.json'");
 const live=read('public/myon-live-ui-missions.js');
 assert.match(live,/function acceptUiRion\(/);
 assert.match(live,/function settleUiRion\(/);
 assert.match(live,/function renderUiRionActive\(/);
 assert.match(live,/world\.uiRion=uiRionState\(world\)/);
 assert.match(live,/next\.rions\.discovered\.push\(\{id:'rion.role.ui',stage:0,discoveredAt:now\}\)/);
 for(const name of ['generateMission','settleMining','renderMiningCard','settleDue','write','load']) {
  const regex=new RegExp('function '+name+'\\([\\s\\S]*?(?=\\nfunction |$)');
  const before=expected.match(regex)?.[0],after=live.match(regex)?.[0];
  assert.ok(before&&after, 'Missing original '+name);
  assert.equal(after,before, 'Existing gameplay function changed: '+name);
 }

 // The LIVE UI discovery extension is the only allowed departure from frozen
 // mining logic; the original ORDER and canMine gate must remain untouched.
 assert.equal(read('public/myon-live-ui-mining.js'),pinnedRead('myon-dev-rion-mining.js'),'Mining progression must remain official');
  assert.match(expected,/MYON_LIVE_MISSIONS_V1/);
 assert.equal(JSON.parse(read('public/myon-live-ui-registry.json')).records.length,162);
});
test('LIVE enhanced page retains official markup while loading isolated official resources',()=>{
 const html=read('public/myon-live-ui.html');
 assert.match(html,/src="myon-live-ui-missions.js"/);
 assert.match(html,/src="myon-live-ui-rions.js"/);
 assert.match(html,/src="myon-live-ui-mining.js"/);
 assert.match(html,/src="myon-live-ui-overlay.js"/);
 assert.match(html,/id="mw-money-strip"/);
 assert.match(html,/class="top-identity"/);
 assert.match(html,/\.mw-live-ui-open > #mw-root/);
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 const app=read('src/App.vue');
 assert.match(app,/const gamePage=server==='live'\?'myon-live-ui.html':'myon-next.html'/);
 assert.match(app,/myon-live-ui\.html/);
 assert.match(app,/myon-next\.html/);
});

test('original mining progression remains independent of the UI scene',()=>{
 const win={};vm.runInNewContext(read('public/myon-live-ui-mining.js'),{window:win});
 const E=win.MYON_DEV_RION_MINING,now=Date.parse('2026-11-24T00:00:00Z');
 const a={schema:2,discovered:[],pending:null,nextAt:now+3600000,latest:null};
 const started=E.prepareDiscovery(a,now).state;
 assert.equal(started.pending.id,'rion.role.mission');
 assert.deepEqual([...E.ORDER],['rion.role.mission','rion.material.myonite','rion.role.mining']);
 const mined={...a,discovered:E.ORDER.map(id=>({id,stage:0,discoveredAt:now})),nextAt:null};
 assert.equal(E.canMine(mined),true);
});
function liveHarness(){
 let now=Date.parse('2026-11-24T00:00:00Z'),data=null;
 const window={};
 const sandbox={window,console,Math,JSON,MYON_MISSION_SERVER:'live',DEV_SAVE_VERSION:'test',
  localStorage:{setItem(k,v){data=v},getItem(){return data}},
  document:{getElementById(){return null}},
  Date:class extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}},
 };
 vm.runInNewContext(read('public/myon-live-ui-rions.js'),sandbox);
 vm.runInNewContext(read('public/myon-live-ui-mining.js'),sandbox);
 const script=read('public/myon-live-ui-missions.js');
 const patched=script.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/,
  "globalThis.__test={setWorld:v=>{world=v},getWorld:()=>world,acceptUiRion,settleUiRion,validWorld,uiRionState,uiRionStage,uiRionProgress};})();");
 assert.notEqual(script,patched);
 const base=JSON.parse(read('public/myon-live-ui-baseline.json'));
 const defs=JSON.parse(read('public/myon-live-ui-registry.json')).records;
 sandbox.__defs=defs;
 // rionDefinitions is internal to the IIFE; initialize it before probes use validWorld.
 const initialized=patched.replace("globalThis.__test={","rionDefinitions=globalThis.__defs;globalThis.__test={");
 vm.runInNewContext(initialized,sandbox,{timeout:2000});
 const R=window.MYON_RIONS,E=window.MYON_DEV_RION_MINING;
 const world={schema:1,city:'lien',cityName:'리온',createdAt:now,cash:0,
 stats:Array(150).fill(50),offers:[],active:[],history:[],nextOfferAt:now+600000,
 rions:E.prepareDiscovery(R.initialize(null,defs,now),now).state,
 myonite:E.initialState(),uiRion:{phase:'pending',acceptedAt:0,completedAt:0}};
 const probe=sandbox.__test;
 assert.equal(probe.validWorld(world),true);
 probe.setWorld(world);
 return {probe,getSaved:()=>data,advance:ms=>{now+=ms},R};
}
test('LIVE UI appears at once, but accepting only begins analysis and never discovers instantly',()=>{
 const h=liveHarness();
 const {probe,R}=h;
 let w=probe.getWorld();
 assert.equal(w.uiRion.phase,'pending');
 assert.equal(R.discovered(w.rions,'rion.role.ui'),false);
 probe.acceptUiRion();
 w=probe.getWorld();
 assert.equal(w.uiRion.phase,'active');
 assert.equal(R.discovered(w.rions,'rion.role.ui'),false);
 assert.deepEqual(Array.from(probe.uiRionStage()),['??','분석중']);
 assert.ok(h.getSaved());
 h.advance(20*60000);
 assert.deepEqual(Array.from(probe.uiRionStage()),['리온','UI 리온']);
 h.advance(20*60000);
 assert.deepEqual(Array.from(probe.uiRionStage()),['UI 리온','세팅중']);
 h.advance(20*60000-1000);
 assert.equal(probe.settleUiRion(),false);
 assert.equal(R.discovered(probe.getWorld().rions,'rion.role.ui'),false);
 h.advance(1000);
 assert.equal(probe.settleUiRion(),true);
 assert.equal(R.discovered(probe.getWorld().rions,'rion.role.ui'),true);
 assert.equal(probe.getWorld().uiRion.phase,'done');
 assert.equal(probe.validWorld(probe.getWorld()),true);
});
test('old LIVE UI discoverers remain complete on migration without resetting saved progress',()=>{
 const h=liveHarness(),{probe,R}=h;
 const world=probe.getWorld();
 world.cash=73000;
 world.rions.discovered.push({id:'rion.role.ui',stage:0,discoveredAt:world.createdAt-10000});
 delete world.uiRion;
 assert.equal(probe.uiRionState(world).phase,'done');
 assert.equal(world.cash,73000);
 assert.equal(R.discovered(world.rions,'rion.role.ui'),true);
});
function probe(){
 const source=read('public/myon-live-ui-overlay.js');
 assert.doesNotMatch(source,/localStorage\.setItem|localStorage\.removeItem|indexedDB\.deleteDatabase/);
 const patched=source.replace(/\}\)\(\);\s*$/,"globalThis.__probe={status,nodeTree,setRegistry:(a,b)=>{definitions=a;categories=b}};})();");
 assert.notEqual(source,patched);
 const context=vm.createContext({
  URLSearchParams,location:{search:'?server=live'},window:{setInterval(){return 1}}
 });
 vm.runInContext(patched,context,{timeout:2000});
 return context.__probe;
}
const world=(id,date)=>({rions:{discovered:[{id,stage:0,discoveredAt:date}]}});
test('preexisting LIVE UI discoverers get unlocked menu on first visit',()=>{
 const p=probe(),d=Date.parse('2026-11-21T00:00:00Z');
 const s=p.status(world('rion.role.ui',d),Date.parse('2026-11-24T00:00:00Z'));
 assert.equal(s.visible,true);assert.equal(s.ready,true);assert.equal(s.ratio,1);
 assert.equal(p.status(world('rion.role.user',d),Date.parse('2026-11-24T00:00:00Z')).ready,true);
});
test('new UI discoverers finish menu only after 60 minutes; 40-50 fills continuously',()=>{
 const p=probe(),d=Date.parse('2026-11-23T15:00:00Z');
 const st=m=>p.status({uiRion:{phase:'active',acceptedAt:d,completedAt:0},rions:{discovered:[]}},d+m*60000);
 assert.equal(st(0).visible,false);
 assert.equal(st(39).visible,false);
 assert.equal(st(40).visible,true);
 assert.equal(st(40).ratio,0);
 assert.equal(st(45).ratio,.5);
 assert.equal(st(50).ratio,1);
 assert.equal(st(50).ready,false);
 assert.equal(st(59).ready,false);
 assert.equal(st(60).ready,false,'only mission completion may unlock');
 assert.equal(st(60).ratio,1);
 assert.equal(p.status({uiRion:{phase:'done',acceptedAt:d,completedAt:d+3600000},rions:{discovered:[]}},d+3600000).ready,true);
 assert.equal(p.status(world('rion.role.development',d),d+99999999).visible,false);
});
test('folder tree includes only discovered Rion names and necessary parent categories',()=>{
 const p=probe();
 const registry=JSON.parse(read('public/myon-live-ui-registry.json')).records;
 const categories=JSON.parse(read('public/myon-live-ui-baseline.json')).domains.map(x=>x.name);
 p.setRegistry(registry,categories);
 const found={rions:{discovered:[
  {id:'rion.role.ui',stage:0,discoveredAt:1763000000000},
  {id:'rion.field.mission-07.02',stage:0,discoveredAt:1763000001000}
 ]}};
 const tree=p.nodeTree(found);
 assert.equal(tree.children.length,2);
 assert.equal(tree.children[0].name,'시스템 리온');
 assert.deepEqual([...tree.children[0].children].map(x=>x.name),['UI 리온']);
 assert.equal(tree.children[1].name,'분야 리온');
 assert.equal(tree.children[1].children.length,1);
 assert.equal(tree.children[1].children[0].name,'교통');
 assert.deepEqual([...tree.children[1].children[0].children].map(x=>x.name),['광역버스 리온']);
 const unknown=p.nodeTree({rions:{discovered:[]}});
 assert.equal(unknown.children.length,0);
});


test('main LIVE update notice waits for a newer deployed game file and never reloads the game',async()=>{
 const source=read('public/myon-live-ui-update.js');
 new vm.Script(source);
 const old='a'.repeat(40),next='b'.repeat(40);
 const href='https://example.github.io/MYON/releases/'+old+'/myon-live-ui.html?build='+old+'&server=live';
 const panel={hidden:true,offsetHeight:0,classList:{add(){}}};
 const timers=[],timeouts=[],requests=[];
 let available=false,releases=[{revision:old,version:'0.14.17'}];
 const win={setInterval:(fn,ms)=>timers.push({fn,ms}),setTimeout:(fn,ms)=>timeouts.push({fn,ms})};
 const fetch=async(url,opts={})=>{
  requests.push({url:String(url),opts});
  if(opts.method==='HEAD')return {ok:available};
  return {ok:true,json:async()=>({schema:1,releases})};
 };
 vm.runInNewContext(source,{
  window:win,location:{href,search:new URL(href).search},URL,URLSearchParams,Date,
  console:{warn(){}},document:{getElementById:()=>panel},fetch
 },{timeout:2000});
 assert.equal(timeouts.length,1);
 assert.equal(timers.length,1);
 assert.equal(timers[0].ms,60000);
 await timeouts[0].fn();
 assert.equal(panel.hidden,true,'same deployed main revision must not trigger a notice');
 releases=[...releases,{revision:next,version:'0.14.18'}];
 await timers[0].fn();
 assert.equal(panel.hidden,true,'unavailable live page must block the restart notice');
 assert.ok(requests.some(r=>r.url.includes('/releases/'+next+'/myon-live-ui.html')&&r.opts.method==='HEAD'));
 available=true;
 await timers[0].fn();
 assert.equal(panel.hidden,false,'available newer LIVE version should show the notice even without Development Rion');
 const previous=requests.length;
 await timers[0].fn();
 assert.equal(requests.length,previous,'do not keep checking after notice is shown');
 assert.doesNotMatch(source,/location\.(?:replace|reload|assign)\(/);
 assert.doesNotMatch(source,/localStorage\.setItem|indexedDB\.deleteDatabase/);
 const html=read('public/myon-live-ui.html');
 assert.match(html,/신규 업데이트 적용 예정/);
 assert.match(html,/저장 후 재시작 요망/);
});
test('LIVE entry still checks game file, backups and original save namespace before playing',()=>{
 const app=read('src/App.vue');
 const entry=read('src/core/myon-server-entry.mjs');
 assert.ok(app.includes("const available=server==='live'||server==='dev'?await refreshReleases():releases"));
 assert.ok(app.indexOf("await verifyArchive({base:BASE,server,revision:target.revision})")<app.indexOf("await createEntryCheckpoint({server,revision:target.revision})"));
 assert.ok(app.indexOf("await createEntryCheckpoint({server,revision:target.revision})")<app.indexOf("playing.value=true"));
 assert.match(entry,/live:'myon-v00804-progress'/);
 assert.match(entry,/live:'MYON_LIVE_MISSIONS_V1'/);
 assert.match(app,/MYON_SAFE_UPDATE_CHECKPOINT/);
 const builder=read('scripts/build-rollouts.cjs');
 assert.match(builder,/latestLiveNotice/);
 assert.match(builder,/myon-live-ui-update\.js/);
 assert.match(builder,/LIVE must equal the deployed main commit/);
});
