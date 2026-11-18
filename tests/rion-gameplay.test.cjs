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
test('159 discovery candidates are unique: four roles, five styles, 150 specific fields',()=>{
 assert.equal(definitions.length,159);
 assert.equal(new Set(definitions.map(r=>r.id)).size,159);
 assert.equal(definitions.filter(r=>r.kind==='system').length,4);
 assert.equal(definitions.filter(r=>r.kind==='style').length,5);
 assert.equal(definitions.filter(r=>r.kind==='field').length,150);
 assert.ok(definitions.some(r=>r.id==='rion.role.ui'));
 assert.ok(definitions.some(r=>r.id==='rion.role.wiki'));
});
test('a random unknown Rion spawns within 24 hours, expires in 60 minutes, and never costs money',()=>{
 const R=engine();
 const initial=R.initialize(null,definitions,T,()=>.1);
 assert.ok(initial.nextAt>T&&initial.nextAt<=T+R.DAY);
 let step=R.advance(initial,definitions,initial.nextAt,()=>0);
 assert.equal(step.changed,true);
 assert.equal(step.state.pending.id,'rion.role.ui');
 assert.equal(step.state.pending.expiresAt-step.state.pending.createdAt,R.HOUR);
 assert.equal(step.state.discovered.length,0);
 const late=R.advance(step.state,definitions,step.state.pending.expiresAt,()=>.5);
 assert.equal(late.state.pending,null);
 assert.equal(late.state.discovered.length,0);
 assert.ok(late.state.nextAt>T);
 assert.equal(R.accept(step.state,definitions,step.state.pending.expiresAt),null);
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
test('the last unknown Rion can still be found, but 159/159 discoveries end scheduling',()=>{
 const R=engine(),s=R.initialize(null,definitions,T,()=>0);
 s.discovered=definitions.slice(0,-1).map(r=>({id:r.id,stage:0,discoveredAt:T}));
 s.nextAt=T+5;
 const step=R.advance(s,definitions,T+5,()=>0);
 assert.equal(step.state.pending.id,definitions.at(-1).id);
 const found=R.accept(step.state,definitions,T+6);
 assert.equal(found.state.discovered.length,159);
 assert.equal(found.state.nextAt,null);
 assert.equal(R.advance(found.state,definitions,T+R.DAY).changed,false);
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
 assert.match(mission,/mw-track mw-expire-track/);
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
test('v0.13.95 to v0.13.96 preserves DEV progress, future DEV resets retain Rion discoveries',async()=>{
 const {prepareDevVersion,DEV_ACTIVE_VERSION_KEY,DEV_RION_CONTINUITY_KEY}=await import('../src/core/myon-dev-version.mjs');
 const rions={schema:1,discovered:[{id:'rion.role.ui',stage:0,discoveredAt:T}],
  pending:null,nextAt:T+5000,latest:null};
 const older={schema:1,offers:[],active:[],rions,cash:200};
 const values=new Map([[DEV_ACTIVE_VERSION_KEY,'0.13.95'],
  ['MYON_DEV_MISSIONS_V1_0.13.95',JSON.stringify(older)]]);
 const storage={get length(){return values.size},key:i=>[...values.keys()][i]??null,
  getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const effects=[];
 const opts={storage,idb:{},deleteDatabase:async()=>effects.push('db'),purgeBackups:async()=>effects.push('backup')};
 const migrated=await prepareDevVersion({...opts,version:'0.13.96'});
 assert.equal(migrated.reset,false);
 assert.equal(migrated.migrated,true);
 assert.equal(values.has('MYON_DEV_MISSIONS_V1_0.13.95'),true);
 assert.deepEqual(JSON.parse(values.get(DEV_RION_CONTINUITY_KEY)),rions);
 assert.equal(effects.length,0);
 values.set('MYON_DEV_MISSIONS_V1_0.13.96',JSON.stringify({...older,cash:250}));
 const after=await prepareDevVersion({...opts,version:'0.13.97'});
 assert.equal(after.reset,true);
 assert.deepEqual(effects,['db','backup']);
 assert.equal(values.has('MYON_DEV_MISSIONS_V1_0.13.96'),false);
 assert.deepEqual(JSON.parse(values.get(DEV_RION_CONTINUITY_KEY)),rions);
 assert.equal(values.get(DEV_ACTIVE_VERSION_KEY),'0.13.97');
});
