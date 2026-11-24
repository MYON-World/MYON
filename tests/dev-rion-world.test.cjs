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
test('fresh World Rion R0 starts with zero sites and no distance reference',()=>{
 const W=create(),t=1700000000000;
 const a=W.initialState(t,()=>0.25),b=W.initialState(t,()=>0.25);
 assert.equal(a.schema,3);
 assert.ok(W.valid(a));
 assert.equal(a.discoveredCount,0);
 assert.equal(a.baseCount,0);
 assert.equal(W.list(a).length,0);
 assert.equal(a.seed,b.seed);
 assert.throws(()=>W.district(a,0),/발견되지 않은/);
 assert.throws(()=>W.distance(a,0,0),/발견되지 않은/);
});
test('site locations and all distances remain stable only after manual discoveries',()=>{
 const W=create(),a=W.initialState(1700000000000,()=>0.8);
 const first=W.explore(a,'채광단지',()=>0.85);
 assert.equal(first.foundCount,2);
 const b=first.state;
 assert.equal(b.discoveredCount,2);
 assert.equal(W.district(b,0).id,'SITE-000001');
 assert.equal(W.district(b,1).type,'채광단지');
 const before=W.distance(b,0,1);
 const second=W.explore(b,'산업단지',()=>0.98);
 const c=second.state;
 assert.equal(second.foundCount,3);
 assert.equal(W.distance(c,0,1),before);
 assert.equal(W.district(c,0).id,W.district(b,0).id);
 assert.equal(W.distance(c,0,c.discoveredCount-1),W.distance(c,c.discoveredCount-1,0));
 assert.equal(W.distance(JSON.parse(JSON.stringify(c)),0,1),before);
 assert.equal(W.valid({...c,discoveredCount:-1}),false);
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
 assert.match(entry,/if\(server==='live'\)/);
 assert.doesNotMatch(entry,/LIVE_RELEASE=Object\.freeze/);
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
test('old schema 1 and 2 worlds reset all sites exactly once, keeping stable world identity',()=>{
 const W=create(),base=W.initialState(1700000000000,()=>0.31);
 const older={schema:1,generator:1,seed:base.seed,createdAt:base.createdAt,discoveredCount:14};
 const legacy2={schema:2,generator:1,seed:base.seed,createdAt:base.createdAt,
  baseCount:5,discoveredCount:14,batches:[{from:5,count:3,type:'채광단지'},{from:8,count:6,type:'물류단지'}]};
 for(const old of [older,legacy2]){
  assert.ok(W.valid(old));
  const restored=W.migrate(old);
  assert.equal(restored.schema,3);
  assert.equal(restored.discoveredCount,0);
  assert.equal(restored.baseCount,0);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.batches)),[]);
  assert.equal(restored.seed,old.seed);
  assert.equal(restored.createdAt,old.createdAt);
  assert.equal(old.discoveredCount,14,'previous saves are not mutated in place');
  assert.strictEqual(W.migrate(restored),restored,'schema 3 prevents repeated resets');
  assert.throws(()=>W.district(restored,0),/발견되지 않은/);
  const discovered=W.explore(restored,'채광단지',()=>0.995);
  assert.equal(discovered.foundCount,3);
  assert.equal(discovered.state.discoveredCount,3);
  for(let i=0;i<3;i++)assert.equal(W.district(discovered.state,i).type,'채광단지');
  assert.equal(W.district(discovered.state,0).id,'SITE-000001');
  assert.equal(W.migrate(discovered.state).discoveredCount,3,'newly found sites survive relaunch');
  assert.equal(W.distance(discovered.state,0,1),W.distance(JSON.parse(JSON.stringify(discovered.state)),0,1));
 }
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
 assert.equal(state.worldR0.discoveredCount,0);
 assert.equal(JSON.parse(store.get('MYON_DEV_MISSIONS_V1_0.14.7.1')).worldR0.seed,state.worldR0.seed);
});
test('DEV version change from v0.14.6.1 resets old missions and discoveries',async()=>{
 const {prepareDevVersion,DEV_ACTIVE_VERSION_KEY}=await import('../src/core/myon-dev-version.mjs');
 const oldKey='MYON_DEV_MISSIONS_V1_0.14.6.1',store=new Map();
 store.set(DEV_ACTIVE_VERSION_KEY,'0.14.6.1');
 store.set(oldKey,JSON.stringify({schema:1,offers:[],active:[],cash:122,
  rions:{schema:2,discovered:[],pending:null,nextAt:Date.now()+10000,latest:null},
  worldR0:{schema:1,generator:1,seed:20,createdAt:1700000000000,discoveredCount:14}}));
 store.set('MYON_LIVE_MISSIONS_V1','official save');
 const storage={get length(){return store.size},key:i=>[...store.keys()][i]??null,
  getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const calls=[];
 const result=await prepareDevVersion({version:'0.14.7.1',storage,
  deleteDatabase:async()=>calls.push('dev db'),purgeBackups:async()=>calls.push('dev backups')});
 assert.equal(result.reset,true);
 assert.deepEqual(calls,['dev db','dev backups']);
 assert.equal(store.has(oldKey),false);
 assert.equal(store.get('MYON_LIVE_MISSIONS_V1'),'official save');
 assert.equal(store.get(DEV_ACTIVE_VERSION_KEY),'0.14.7.1');
});
test('DEV v0.14.7.1 to v0.14.8 resets all DEV records, not official saves',async()=>{
 const {prepareDevVersion,DEV_ACTIVE_VERSION_KEY}=await import('../src/core/myon-dev-version.mjs');
 const oldKey='MYON_DEV_MISSIONS_V1_0.14.7.1';
 const game={schema:1,offers:[{id:'offer1'}],active:[{id:'active1'}],cash:123456,
  rions:{schema:2,discovered:[{id:'rion.role.world',stage:0,discoveredAt:1700000000000}],
   pending:null,nextAt:1700000000010,latest:null},
  myonite:{schema:1,storedTons:6,awaitingChoiceTons:0,active:null}};
 const data=new Map([[DEV_ACTIVE_VERSION_KEY,'0.14.7.1'],[oldKey,JSON.stringify(game)],
  ['MYON_LIVE_MISSIONS_V1','permanent LIVE save']]);
 const storage={get length(){return data.size},key:i=>[...data.keys()][i]??null,
  getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const calls=[];
 const result=await prepareDevVersion({version:'0.14.8',storage,
  deleteDatabase:async()=>calls.push('DEV database'),purgeBackups:async()=>calls.push('DEV backups')});
 assert.equal(result.reset,true);
 assert.deepEqual(calls,['DEV database','DEV backups']);
 assert.equal(data.has(oldKey),false);
 assert.equal(data.get('MYON_LIVE_MISSIONS_V1'),'permanent LIVE save');
 assert.equal(data.get(DEV_ACTIVE_VERSION_KEY),'0.14.8');
});
test('zero-site UI does not calculate a missing reference-site distance',()=>{
 const s=fs.readFileSync(path.join(root,'public/myon-dev-world-ui.js'),'utf8');
 assert.match(s,/if\(state\.discoveredCount\)\{/);
 assert.match(s,/발견된 단지 0곳/);
 assert.match(s,/아직 발견된 단지가 없습니다/);
});
