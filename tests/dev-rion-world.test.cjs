'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'public/myon-dev-rion-world.js'),'utf8');
function create(){
 const window={};
 vm.runInNewContext(source,{window},{timeout:1500});
 return window.MYON_DEV_RION_WORLD;
}
test('World Rion R0 has stable sites and symmetric distances without a map',()=>{
 const W=create(),t=1700000000000;
 const a=W.initialState(t,()=>0.25),b=W.initialState(t,()=>0.25);
 assert.ok(W.valid(a));
 assert.equal(a.seed,b.seed);
 assert.equal(a.discoveredCount,b.discoveredCount);
 for(let i=0;i<a.discoveredCount;i++){
  assert.equal(W.district(a,i).id,W.district(b,i).id);
  for(let j=0;j<a.discoveredCount;j++){
   assert.equal(W.distance(a,i,j),W.distance(a,j,i));
   assert.equal(W.distance(a,i,j),W.distance(b,i,j));
  }
 }
 assert.equal(W.distance(a,0,0),0);
 assert.throws(()=>W.distance(a,0,a.discoveredCount),/발견되지 않은/);
});
test('new discoveries never change previous locations or distances',()=>{
 const W=create(),a=W.initialState(1700000000000,()=>0.8);
 const before=W.distance(a,0,1);
 const found=W.explore(a,'채광단지',()=>0.85);
 assert.equal(found.foundCount,2);
 const b=found.state;
 assert.ok(b.discoveredCount>a.discoveredCount);
 assert.equal(b.seed,a.seed);
 assert.equal(b.createdAt,a.createdAt);
 assert.equal(W.distance(b,0,1),before);
 assert.equal(W.district(b,0).id,W.district(a,0).id);
 assert.equal(W.distance(b,0,b.discoveredCount-1),W.distance(b,b.discoveredCount-1,0));
 assert.equal(W.distance(JSON.parse(JSON.stringify(b)),0,1),before);
 assert.equal(W.valid({...b,discoveredCount:-1}),false);
});
test('DEV integrates discovered world only, never modifies pre-existing LIVE/TEST routing',()=>{
 const html=fs.readFileSync(path.join(root,'public/myon-next.html'),'utf8');
 const mission=fs.readFileSync(path.join(root,'public/myon-dev-missions.js'),'utf8');
 const mining=fs.readFileSync(path.join(root,'public/myon-dev-rion-mining.js'),'utf8');
 const entry=fs.readFileSync(path.join(root,'src/core/myon-server-entry.mjs'),'utf8');
 assert.match(html,/src="myon-dev-rion-world\.js"/);
 assert.match(html,/src="myon-dev-world-ui\.js"/);
 assert.ok(html.indexOf('src="myon-dev-rion-world.js"')<html.indexOf('src="myon-dev-missions.js"'));
 assert.match(mining,/rion\.role\.world/);
 assert.match(mission,/MISSION_SERVER==='dev'&&WORLD/);
 assert.match(mission,/worldR0/);
 assert.match(entry,/version:'0\.14\.5\.2'/);
 assert.match(entry,/version:'0\.13\.94'/);
});

test('targeted exploration yields 0, 1, 2 or 3 sites of exactly the selected type',()=>{
 const W=create(),a=W.initialState(1700000000000,()=>0.41);
 const failed=W.explore(a,'채광단지',()=>0.1);
 assert.equal(failed.foundCount,0);
 assert.deepEqual(JSON.parse(JSON.stringify(failed.state)),JSON.parse(JSON.stringify(a)));
 assert.equal(W.explore(a,'없는단지',()=>0.5),null);
 let s=a;
 for(const [type,roll,expected] of [['채광단지',0.3,1],['정제단지',0.8,2],['채광단지',0.99,3]]){
  const found=W.explore(s,type,()=>roll);
  assert.equal(found.foundCount,expected);
  for(let i=found.from;i<found.from+expected;i++)assert.equal(W.district(found.state,i).type,type);
  assert.equal(found.state.discoveredCount,s.discoveredCount+expected);
  assert.ok(W.valid(found.state));
  s=JSON.parse(JSON.stringify(found.state));
 }
 assert.equal(W.explore(s,'산업단지',()=>0.05).foundCount,0);
 assert.equal(W.valid({...s,batches:[...s.batches,{from:999,count:1,type:'채광단지'}]}),false);
});
test('legacy R0 worlds retain old site IDs, kinds and all distances after targeted discovery',()=>{
 const W=create(),base=W.initialState(1700000000000,()=>0.31);
 const legacy={schema:1,generator:1,seed:base.seed,createdAt:base.createdAt,discoveredCount:14};
 assert.ok(W.valid(legacy));
 const baseline=Array.from({length:14},(_,i)=>W.district(legacy,i));
 const before=Array.from({length:14},(_,i)=>Array.from({length:14},(_,j)=>W.distance(legacy,i,j)));
 const migrated=W.migrate(legacy);
 assert.equal(migrated.baseCount,14);
 assert.equal(migrated.discoveredCount,14);
 const target=W.explore(migrated,'채광단지',()=>0.995);
 assert.equal(target.foundCount,3);
 const restored=JSON.parse(JSON.stringify(target.state));
 for(let i=0;i<14;i++){
  assert.deepEqual(JSON.parse(JSON.stringify(W.district(restored,i))),JSON.parse(JSON.stringify(baseline[i])));
  for(let j=0;j<14;j++)assert.equal(W.distance(restored,i,j),before[i][j]);
 }
 for(let i=14;i<17;i++)assert.equal(W.district(restored,i).type,'채광단지');
 assert.equal(W.distance(restored,0,14),W.distance(restored,14,0));
});
test('DEV first offers World Rion, creates it only when accepted, then offers Mission',()=>{
 const win={},t=1800000000000;
 vm.runInNewContext(fs.readFileSync(path.join(root,'public/myon-rions.js'),'utf8'),{window:win},{timeout:2000});
 vm.runInNewContext(fs.readFileSync(path.join(root,'public/myon-dev-rion-mining.js'),'utf8'),{window:win},{timeout:2000});
 vm.runInNewContext(source,{window:win},{timeout:2000});
 const mission=fs.readFileSync(path.join(root,'public/myon-dev-missions.js'),'utf8');
 const instrumented=mission.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/,
  "window.__probe={newWorld,acceptRion,setData:(fields,cityList,ids)=>{catalog=fields;cities=cityList;rionDefinitions=ids;},setWorld:w=>world=w,getWorld:()=>world};\n})();");
 assert.notEqual(instrumented,mission);
 const store=new Map();
 const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 const defs=JSON.parse(fs.readFileSync(path.join(root,'public/myon-rion-registry.json'),'utf8')).records;
 vm.runInNewContext(instrumented,{window:win,localStorage,MYON_MISSION_SERVER:'dev',DEV_SAVE_VERSION:'0.14.7.1',
  Date:{now:()=>t},Math,console,document:{getElementById:()=>null}},{timeout:2000});
 const api=win.__probe;
 const fields=defs.filter(r=>r.kind==='field').map((r,i)=>({id:i,name:r.fieldName,category:'분야',categoryIndex:Math.floor(i/10)}));
 api.setData(fields,[{id:'lien',name:'리엔시'}],defs);
 const first=api.newWorld();
 assert.equal(first.rions.pending.id,'rion.role.world');
 assert.equal(first.worldR0,undefined);
 api.setWorld(first);
 api.acceptRion();
 const state=api.getWorld();
 assert.equal(state.rions.discovered[0].id,'rion.role.world');
 assert.equal(state.rions.pending.id,'rion.role.mission');
 assert.ok(win.MYON_DEV_RION_WORLD.valid(state.worldR0));
 assert.equal(JSON.parse(store.get('MYON_DEV_MISSIONS_V1_0.14.7.1')).worldR0.seed,state.worldR0.seed);
});
test('DEV upgrade from v0.14.6.1 keeps existing save untouched and skips reset',async()=>{
 const {prepareDevVersion,DEV_ACTIVE_VERSION_KEY}=await import('../src/core/myon-dev-version.mjs');
 const oldKey='MYON_DEV_MISSIONS_V1_0.14.6.1',store=new Map();
 store.set(DEV_ACTIVE_VERSION_KEY,'0.14.6.1');
 store.set(oldKey,JSON.stringify({schema:1,offers:[],active:[],cash:122,
  rions:{schema:2,discovered:[],pending:null,nextAt:Date.now()+10000,latest:null},
  worldR0:{schema:1,generator:1,seed:20,createdAt:1700000000000,discoveredCount:14}}));
 let resetCalled=false;
 const localStorage={
  getItem:k=>store.get(k)??null,
  setItem:(k,v)=>store.set(k,v),
  length:0
 };
 const result=await prepareDevVersion({version:'0.14.7.1',storage:localStorage,
  deleteDatabase:async()=>{resetCalled=true;},purgeBackups:async()=>{resetCalled=true;}});
 assert.equal(result.migrated,true);
 assert.equal(resetCalled,false);
 assert.equal(JSON.parse(store.get(oldKey)).worldR0.discoveredCount,14);
 assert.equal(store.get(DEV_ACTIVE_VERSION_KEY),'0.14.7.1');
});
