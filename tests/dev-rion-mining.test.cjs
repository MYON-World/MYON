'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const RION_DEFS=JSON.parse(fs.readFileSync(path.join(root,'public/myon-rion-registry.json'),'utf8')).records;
const win={};
vm.runInNewContext(fs.readFileSync(path.join(root,'public/myon-rions.js'),'utf8'),{window:win},{timeout:2000});
vm.runInNewContext(fs.readFileSync(path.join(root,'public/myon-dev-rion-mining.js'),'utf8'),{window:win},{timeout:2000});
const R=win.MYON_RIONS,M=win.MYON_DEV_RION_MINING;
const t=1800000000000;
function unlock(){
 let state=M.prepareDiscovery(R.initialize(null,RION_DEFS,t),t).state;
 for(const id of M.ORDER){
  assert.equal(state.pending.id,id);
  assert.equal(state.nextAt,null);
  const result=R.accept(state,RION_DEFS,t);
  assert.equal(result.id,id);
  assert.equal(result.state.discovered.at(-1).stage,0);
  state=M.prepareDiscovery(result.state,t).state;
 }
 return state;
}
test('discovery has fixed mission -> Myonite -> mining order with no one-hour waiting',()=>{
 const state=unlock();
 assert.deepEqual([...M.ORDER],['rion.role.mission','rion.material.myonite','rion.role.mining']);
 assert.equal(state.discovered.length,3);
 assert.equal(state.nextAt,null);
 assert.equal(state.pending,null);
 assert.equal(M.canMine(state),true);
});
test('mining R.0 takes exactly 60 seconds, yields 1 ton, and starts only when discovered',()=>{
 const initial=M.initialState();
 assert.equal(M.CONFIG.mining.durationMs,60000);
 assert.equal(M.CONFIG.mining.efficiencyBonusPercent,0);
 assert.equal(M.CONFIG.myonite.tonsPerMine,1);
 assert.equal(M.CONFIG.myonite.pricePerTonM,100);
 assert.equal(M.CONFIG.mission.temporaryStorageTons,10);
 assert.equal(M.start(initial,R.initialize(null,RION_DEFS,t),t),null);
 const started=M.start(initial,unlock(),t);
 assert.equal(started.active.endsAt,t+60000);
 assert.equal(M.finish(started,t+59999),null);
 const mined=M.finish(started,t+60000);
 assert.equal(mined.active,null);
 assert.equal(mined.awaitingChoiceTons,1);
 assert.equal(M.start(mined,unlock(),t+60001),null,'pending sale/store decision blocks next mining');
 const sold=M.sellNew(mined);
 assert.equal(sold.earnedM,100);
 assert.equal(sold.state.awaitingChoiceTons,0);
 assert.ok(M.start(sold.state,unlock(),t+60001),'next mining becomes available immediately after decision');
});
test('temporary storage has a strict 10-ton cap, and stored ore can later be sold',()=>{
 let state=M.initialState();
 for(let i=0;i<10;i++){
  state=M.start(state,unlock(),t+i*70000);
  state=M.finish(state,t+i*70000+60000);
  state=M.storeNew(state);
  assert.equal(state.storedTons,i+1);
 }
 state=M.start(state,unlock(),t+11*70000);
 state=M.finish(state,t+11*70000+60000);
 assert.equal(M.storeNew(state),null,'full temporary storage must not overfill');
 const sold=M.sellNew(state);
 assert.equal(sold.earnedM,100);
 assert.equal(sold.state.storedTons,10);
 const released=M.sellStored(sold.state,1);
 assert.equal(released.earnedM,100);
 assert.equal(released.state.storedTons,9);
 const invalid={...released.state,storedTons:11};
 assert.equal(M.valid(invalid),false);
});
test('previously discovered Rions stay intact when scheduling the new ordered chain',()=>{
 const state=R.initialize(null,RION_DEFS,t);
 state.discovered.push({id:'rion.role.ui',stage:0,discoveredAt:t});
 const prepared=M.prepareDiscovery(state,t);
 assert.equal(prepared.state.discovered[0].id,'rion.role.ui');
 assert.equal(prepared.state.pending.id,'rion.role.mission');
 assert.equal(R.valid(prepared.state,RION_DEFS),true);
 assert.equal(M.prepareDiscovery(prepared.state,t+1).changed,false);
});
test('mission board connects discovery, mining progress, selling and inventory without replacing general missions',()=>{
 const c=fs.readFileSync(path.join(root,'public/myon-dev-missions.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/myon-next.html'),'utf8');
 assert.match(c,/function generateMission\(/);
 assert.match(c,/function settleDue\(/);
 assert.match(c,/MINE\.prepareDiscovery/);
 assert.match(c,/MINE\.start\(/);
 assert.match(c,/MINE\.finish\(/);
 assert.match(c,/MINE\.storeNew\(/);
 assert.match(c,/MINE\.sellNew\(/);
 assert.match(c,/MINE\.sellStored\(/);
 assert.match(c,/MINE\.canMine\(/);
 assert.match(html,/src="myon-dev-rion-mining\.js"/);
});
