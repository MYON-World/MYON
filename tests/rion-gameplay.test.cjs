'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const definitions=read('public/myon-rion-registry.json').records;
const engineScript=fs.readFileSync(path.join(root,'public/myon-rions.js'),'utf8');
const T=1800000000000;
function engine(){
 const window={};
 vm.runInNewContext(engineScript,{window},{timeout:2000});
 return window.MYON_RIONS;
}
test('163 discovery candidates include mining, mission and Myonite',()=>{
 assert.equal(definitions.length,163);
 assert.equal(new Set(definitions.map(r=>r.id)).size,163);
 assert.equal(definitions.filter(r=>r.kind==='system').length,7);
 assert.equal(definitions.filter(r=>r.kind==='style').length,5);
 assert.equal(definitions.filter(r=>r.kind==='field').length,150);
 assert.equal(definitions.filter(r=>r.kind==='material').length,1);
 assert.ok(definitions.some(r=>r.id==='rion.material.myonite'&&r.name==='마이오나이트 리온'));
 assert.ok(definitions.some(r=>r.id==='rion.role.mission'&&r.name==='임무 리온'));
 assert.ok(definitions.some(r=>r.id==='rion.role.mining'&&r.name==='채광 리온'));
 assert.ok(definitions.some(r=>r.id==='rion.role.world'&&r.name==='월드 리온'));
 assert.ok(definitions.some(r=>r.id==='rion.role.ui'));
 assert.ok(definitions.some(r=>r.id==='rion.role.wiki'));
});
test('first Rion appears exactly one hour after creation and waits indefinitely until accepted',()=>{
 const R=engine();
 const initial=R.initialize(null,definitions,T);
 assert.equal(initial.schema,2);
 assert.equal(initial.nextAt,T+R.HOUR);
 assert.equal(R.advance(initial,definitions,T+R.HOUR-1).changed,false);
 const spawned=R.advance(initial,definitions,T+R.HOUR,()=>0);
 assert.equal(spawned.changed,true);
 assert.equal(spawned.state.pending.id,'rion.role.ui');
 assert.equal(spawned.state.nextAt,null);
 assert.equal(spawned.state.pending.createdAt,T+R.HOUR);
 assert.equal('expiresAt' in spawned.state.pending,false);
 const muchLater=T+30*R.HOUR;
 const late=R.advance(spawned.state,definitions,muchLater,()=>.99999);
 assert.equal(late.changed,false);
 assert.deepEqual(late.state,spawned.state);
 assert.equal(R.accept(spawned.state,definitions,muchLater).id,'rion.role.ui');
});
test('an accepted Rion schedules the next distinct discovery exactly one hour after acceptance',()=>{
 const R=engine();
 const first=R.advance(R.initialize(null,definitions,T),definitions,T+R.HOUR,()=>0).state;
 const acceptedAt=T+21*R.HOUR+12345;
 const accepted=R.accept(first,definitions,acceptedAt);
 assert.equal(accepted.state.nextAt,acceptedAt+R.HOUR);
 assert.equal(R.advance(accepted.state,definitions,acceptedAt+R.HOUR-1).changed,false);
 const next=R.advance(accepted.state,definitions,acceptedAt+R.HOUR,()=>0).state;
 assert.notEqual(next.pending.id,'rion.role.ui');
 assert.equal(next.pending.createdAt,acceptedAt+R.HOUR);
 assert.equal(next.discovered.length,1);
 const offline=R.advance(next,definitions,acceptedAt+R.HOUR*100,()=>.8);
 assert.equal(offline.changed,false);
 assert.deepEqual(offline.state,next);
});
test('old expired unaccepted Rion saves migrate without losing the pending discovery',()=>{
 const R=engine();
 const pending={id:'rion.role.encyclopedia',createdAt:T-R.HOUR*9,expiresAt:T-R.HOUR*8};
 const legacy={schema:1,discovered:[],pending,nextAt:null,latest:null};
 const restored=R.initialize(legacy,definitions,T);
 assert.equal(restored.schema,2);
 assert.equal(restored.pending.id,'rion.role.wiki');
 assert.equal(restored.pending.createdAt,pending.createdAt);
 assert.equal('expiresAt' in restored.pending,false);
 assert.equal(restored.nextAt,null);
 assert.equal(R.advance(restored,definitions,T+5*R.HOUR).changed,false);
 const result=R.accept(restored,definitions,T+5*R.HOUR);
 assert.equal(result.id,'rion.role.wiki');
 assert.equal(result.state.nextAt,T+6*R.HOUR);
 const oldNoPending={schema:1,discovered:[],pending:null,nextAt:T+24*R.HOUR,latest:null};
 assert.equal(R.initialize(oldNoPending,definitions,T).nextAt,T+R.HOUR);
});
test('accept instantly discovers stage0, persists identity, and excludes already discovered Rions',()=>{
 const R=engine();
 let s=R.initialize(null,definitions,T,()=>0);
 const now=s.nextAt;
 s=R.advance(s,definitions,now,()=>0).state;
 const result=R.accept(s,definitions,now+1000,()=>0);
 assert.equal(result.id,'rion.role.ui');
 assert.equal(result.state.discovered.length,1);
 assert.equal(result.state.discovered[0].stage,0);
 assert.equal(result.state.pending,null);
 assert.equal(result.state.latest.id,result.id);
 assert.equal(R.discovered(result.state,'rion.role.ui'),true);
 const again=R.advance(result.state,definitions,result.state.nextAt,()=>0);
 assert.notEqual(again.state.pending.id,result.id);
 assert.equal(result.state.discovered[0].stage,0,'discovery never jumps to stage one');
 const restored=R.initialize(JSON.parse(JSON.stringify(result.state)),definitions,now+2000);
 assert.equal(R.discovered(restored,'rion.role.ui'),true);
 assert.ok(R.valid(restored,definitions));
});
test('only discovered field Rions are candidates for mission contribution labels',()=>{
 const R=engine(),s=R.initialize(null,definitions,T,()=>0);
 assert.equal(R.contributionId(s,definitions),null);
 s.discovered.push({id:'rion.role.ui',stage:0,discoveredAt:T});
 s.discovered.push({id:'rion.style.observation',stage:0,discoveredAt:T});
 assert.equal(R.contributionId(s,definitions),null,'no role or style candidates');
 s.discovered.push({id:definitions[9].id,stage:0,discoveredAt:T});
 assert.equal(R.contributionId(s,definitions),definitions[9].id);
 s.discovered.push({id:definitions[29].id,stage:0,discoveredAt:T});
 assert.equal(R.contributionId(s,definitions,()=>0),definitions[9].id);
 assert.equal(R.contributionId(s,definitions,()=>.9999),definitions[29].id);
 assert.equal(definitions[9].fieldName,'곡물');
});
test('UI and Wiki legacy IDs convert without changing any field ID; malformed saves are rejected',()=>{
 const R=engine(),s=R.initialize(null,definitions,T,()=>0);
 s.discovered.push({id:'rion.role.user',stage:0,discoveredAt:T});
 s.discovered.push({id:'rion.role.encyclopedia',stage:0,discoveredAt:T});
 const migrated=R.initialize(s,definitions,T);
 assert.equal(migrated.discovered[0].id,'rion.role.ui');
 assert.equal(migrated.discovered[1].id,'rion.role.wiki');
 assert.equal(R.valid(migrated,definitions),true);
 const corrupt=JSON.parse(JSON.stringify(migrated));
 corrupt.discovered[0].stage=1;
 assert.equal(R.initialize(corrupt,definitions,T),null);
 const duplicate=JSON.parse(JSON.stringify(migrated));
 duplicate.discovered[1].id='rion.role.ui';
 assert.equal(R.initialize(duplicate,definitions,T),null);
});
test('the last unknown Rion can still be found, but 163/163 discoveries end scheduling',()=>{
 const R=engine(),s=R.initialize(null,definitions,T,()=>0);
 s.discovered=definitions.slice(0,-1).map(r=>({id:r.id,stage:0,discoveredAt:T}));
 s.nextAt=T+5;
 const step=R.advance(s,definitions,T+5,()=>0);
 assert.equal(step.state.pending.id,definitions.at(-1).id);
 const found=R.accept(step.state,definitions,T+6);
 assert.equal(found.state.discovered.length,163);
 assert.equal(found.state.nextAt,null);
 assert.equal(R.advance(found.state,definitions,T+24*R.HOUR).changed,false);
});
test('UI and Wiki menus use current MYON mission styles without showing private serial/stage',()=>{
 const mission=fs.readFileSync(path.join(root,'public/myon-dev-missions.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/myon-next.html'),'utf8');
 assert.ok(html.includes('src="myon-rions.js"'));
 assert.ok(html.indexOf('src="myon-rions.js"')<html.indexOf('src="myon-dev-missions.js"'));
 assert.match(mission,/nav.hidden=!showUi/);
 assert.match(mission,/if\(!hasRion\('rion.role.wiki'\)\)/);
 assert.match(mission,/assigned\.fieldName\+'기여'/);
 assert.match(mission,/RIONS\.contributionId\(state\.rions,rionDefinitions\)/);
 assert.match(mission,/function renderRionEncounter\(\)/);
 assert.match(mission,/function renderRionComplete\(\)/);
 assert.doesNotMatch(mission.slice(mission.indexOf('function renderRionEncounter()'),mission.indexOf('function renderRionComplete()')),/mw-expire-track|expiresAt/);
 assert.match(engineScript,/stage:0/);
 assert.ok(!html.includes('USR-000001'));
 assert.ok(!html.includes('WIK-000001'));
 assert.match(html,/\.mw-rion-nav/);
});
test('official read-only update notice needs a discovered development Rion AND newer approved pin',async()=>{
 const script=fs.readFileSync(path.join(root,'public/myon-dev-update.js'),'utf8');
 const current='a'.repeat(40),newer='b'.repeat(40),dev='c'.repeat(40);
 const href='https://example.github.io/MYON/releases/'+current+'/myon-next.html?build='+current+'&server=live';
 const panel={hidden:true,offsetHeight:0,classList:{add(){}}};
 const calls=[],timeouts=[],intervals=[];
 let found=false,approved={schema:1,live:{revision:current,version:'0.13.95'}};
 const releases=[
  {revision:current,version:'0.13.95'},{revision:newer,version:'0.13.96'},{revision:dev,version:'0.13.97'}
 ];
 const window={MYON_RION_IS_DISCOVERED:()=>found,setTimeout:(fn,ms)=>timeouts.push({fn,ms}),
  setInterval:(fn,ms)=>intervals.push({fn,ms})};
 const fetch=async(url,opts)=>{
  calls.push(String(url));
  return {ok:true,json:async()=>String(url).includes('approved-releases')?approved:{schema:1,releases}};
 };
 vm.runInNewContext(script,{window,location:{href,search:new URL(href).search},
  URL,URLSearchParams,Date,document:{getElementById:()=>panel},fetch,console:{warn(){}}},{timeout:2000});
 assert.equal(intervals[0].ms,60000);
 await timeouts[0].fn();
 assert.equal(panel.hidden,true);
 assert.equal(calls.length,0,'undiscovered development Rion prevents even checking official notices');
 found=true;
 await intervals[0].fn();
 assert.equal(panel.hidden,true,'a newer development commit is NOT approved');
 approved={schema:1,live:{revision:newer,version:'0.13.96'}};
 await window.MYON_RION_CHECK_UPDATE();
 assert.equal(panel.hidden,false,'a newly approved official version reveals the top notice');
 assert.ok(calls.some(c=>c.includes('myon-approved-releases.json')));
 assert.doesNotMatch(script,/location\.(?:replace|reload|assign)\(/);
});
test('approval manifest comes from frozen LIVE and TEST pins, not the newest DEV SHA',()=>{
 const builder=fs.readFileSync(path.join(root,'scripts/build-rollouts.cjs'),'utf8');
 const pins=fs.readFileSync(path.join(root,'src/core/myon-server-entry.mjs'),'utf8');
 assert.match(builder,/myon-approved-releases\.json/);
 assert.match(builder,/approval\('LIVE_RELEASE'\)/);
 assert.match(builder,/approval\('TEST_RELEASE'\)/);
 assert.match(pins,/LIVE_RELEASE=Object\.freeze/);
 assert.match(pins,/TEST_RELEASE=Object\.freeze/);
});
test('DEV version change resets temporary discoveries and missions without altering LIVE',async()=>{
 const {prepareDevVersion,DEV_ACTIVE_VERSION_KEY,DEV_RION_CONTINUITY_KEY}=await import('../src/core/myon-dev-version.mjs');
 const rions={schema:1,discovered:[{id:'rion.role.ui',stage:0,discoveredAt:T}]};
 const old={schema:1,offers:[],active:[],rions,cash:200};
 const values=new Map([[DEV_ACTIVE_VERSION_KEY,'0.14.10'],
  ['MYON_DEV_MISSIONS_V1_0.14.10',JSON.stringify(old)],
  [DEV_RION_CONTINUITY_KEY,JSON.stringify(rions)],
  ['MYON_LIVE_MISSIONS_V1','permanent official save'],
  ['MYON_TEST_MISSIONS_V1','unchanged pinned test']]);
 const storage={get length(){return values.size},key:i=>[...values.keys()][i]??null,
  getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const calls=[];
 const opts={storage,idb:{},deleteDatabase:async()=>calls.push('dev-db'),
  purgeBackups:async()=>calls.push('dev-backup')};
 const result=await prepareDevVersion({...opts,version:'0.14.10.1'});
 assert.equal(result.reset,true);
 assert.deepEqual(calls,['dev-db','dev-backup']);
 assert.equal(values.has('MYON_DEV_MISSIONS_V1_0.14.10'),false);
 assert.equal(values.has(DEV_RION_CONTINUITY_KEY),false);
 assert.equal(values.get('MYON_LIVE_MISSIONS_V1'),'permanent official save');
 assert.equal(values.get('MYON_TEST_MISSIONS_V1'),'unchanged pinned test');
 assert.equal(values.get(DEV_ACTIVE_VERSION_KEY),'0.14.10.1');
 const same=await prepareDevVersion({...opts,version:'0.14.10.1'});
 assert.equal(same.reset,false);
 assert.equal(calls.length,2);
});
test('completed discovery card states the actual name without UI Rion and vanishes after one hour',()=>{
 const game=fs.readFileSync(path.join(root,'public/myon-dev-missions.js'),'utf8');
 const instrumented=game.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/,
  "window.__rionProbe={setWorld:value=>world=value,setDefinitions:value=>rionDefinitions=value,renderRionComplete,acceptRion,getNotice:()=>notice};\n})();");
 assert.notEqual(instrumented,game);
 let now=T;
 const els=[];
 const doc={createElement:tag=>{
  const e={tagName:tag,className:'',textContent:'',children:[],style:{},append(...children){this.children.push(...children)}};
  els.push(e);return e;
 }};
 const localStorage={getItem:()=>null,setItem(){}};
 const win={};
 vm.runInNewContext(engineScript,{window:win},{timeout:2000});
 vm.runInNewContext(instrumented,{window:win,document:doc,localStorage,DEV_SAVE_VERSION:'unit',
  Date:{now:()=>now},Math,console},{timeout:2000});
 const api=win.__rionProbe;
 const id='rion.field.mission-01.01';
 api.setDefinitions(definitions);
 api.setWorld({rions:{latest:{id,at:T},discovered:[{id,stage:0,discoveredAt:T}]}});
 let card=api.renderRionComplete();
 assert.ok(card);
 assert.equal(card.children[0].children[0].children[0].textContent,'리온');
 assert.equal(card.children[0].children[0].children[1].textContent,'곡물 리온을 발견했습니다');
 assert.equal(card.children[0].children[1].textContent,'발견 완료');
 now=T+win.MYON_RIONS.HOUR-1;
 assert.ok(api.renderRionComplete(),'completion remains visible until the full hour');
 now=T+win.MYON_RIONS.HOUR;
 assert.equal(api.renderRionComplete(),null,'completion expires exactly one hour later');
 assert.ok(api.getNotice()==='');
 assert.equal(api.renderRionComplete(),null);
});
test('discovery notification and expiry are wired without changing the hourly Rion schedule',()=>{
 const game=fs.readFileSync(path.join(root,'public/myon-dev-missions.js'),'utf8');
 assert.match(game,/notice=\(rionById\(result\.id\)\?\.name\|\|'새로운 리온'\)\+'을 발견했습니다\.'/);
 assert.match(game,/const completed=\$m\('mw-offers'\)\?\.querySelector\('\.mw-rion-complete'\)/);
 assert.match(game,/Date\.now\(\)-last\.at>=RIONS\.HOUR/);
 assert.match(game,/if\(completed\|\|showingNotice\)render\(\)/);
 assert.doesNotMatch(game,/알 수 없는 리온을 발견했습니다/);
 const R=engine();
 const first=R.advance(R.initialize(null,definitions,T),definitions,T+R.HOUR,()=>0).state;
 const accepted=R.accept(first,definitions,T+5*R.HOUR);
 assert.equal(accepted.state.nextAt,T+6*R.HOUR);
 assert.equal(accepted.state.discovered.length,1);
});


test('fresh world starts with zero discovered Rions even if an older DEV archive contains discoveries',()=>{
 const game=fs.readFileSync(path.join(root,'public/myon-dev-missions.js'),'utf8');
 const instrumented=game.replace(/bootstrap\(\);\s*\}\)\(\);\s*$/,
  "window.__freshProbe={setData:(fields,cityList,ids)=>{catalog=fields;cities=cityList;rionDefinitions=ids;},newWorld,load};\n})();");
 assert.notEqual(instrumented,game);
 const R=engine(),now=T,storage=new Map();
 storage.set('MYON_RION_DISCOVERY_DEV_V1',JSON.stringify({
  schema:2,discovered:[{id:'rion.role.ui',stage:0,discoveredAt:now-2*R.HOUR}],
  pending:null,nextAt:now+R.HOUR,latest:null
 }));
 const window={MYON_RIONS:R};
 vm.runInNewContext(fs.readFileSync(path.join(root,'public/myon-dev-rion-mining.js'),'utf8'),{window},{timeout:2000});
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 vm.runInNewContext(instrumented,{window,localStorage,DEV_SAVE_VERSION:'testfresh',
  MYON_MISSION_SERVER:'dev',Date:{now:()=>now},Math,console},{timeout:2000});
 const fields=definitions.filter(r=>r.kind==='field').map((r,index)=>({id:index,name:r.fieldName,categoryIndex:Math.floor(index/10)}));
 const api=window.__freshProbe;
 api.setData(fields,[{id:'lien',name:'리엔시'}],definitions);
 assert.equal(api.load(),null);
 const world=api.newWorld();
 assert.equal(world.rions.schema,2);
 assert.equal(world.rions.discovered.length,0);
 assert.equal(world.rions.pending.id,'rion.role.world');
 assert.equal(world.rions.latest,null);
 assert.equal(world.rions.nextAt,null);
 assert.equal(world.myonite.storedTons,0);
 assert.equal(world.myonite.awaitingChoiceTons,0);
 assert.equal(R.discovered(world.rions,'rion.role.ui'),false);
 assert.equal(world.offers.length,4,'normal starter missions remain unchanged');
 assert.ok(world.offers.every(m=>m.contributionRion===null));
 // A saved player who really accepted a Rion can still continue with that discovery.
 const accepted=R.accept(world.rions,definitions,now);
 assert.equal(accepted.id,'rion.role.world');
 const continuing={...world,rions:accepted.state};
 storage.set('MYON_DEV_MISSIONS_V1_testfresh',JSON.stringify(continuing));
 const loaded=api.load();
 assert.ok(loaded,'existing valid save loads');
 assert.equal(loaded.rions.discovered.length,1);
 assert.equal(loaded.rions.discovered[0].id,'rion.role.world');
 assert.equal(loaded.cash,0);
});
