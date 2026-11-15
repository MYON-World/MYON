'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'public/myon-bus-engine.js'),'utf8');
function engine(){const ctx={window:{},Math};vm.runInNewContext(script,ctx,{timeout:2000});return ctx.window.MYON_BUS_ENGINE;}
function at(y,m,d,h,min=0){return Math.floor(Date.UTC(y,m-1,d,h-9,min)/1000);}
test('LV.1 city-supported Solati is preserved separately with strict capacity',()=>{
 const e=engine(),s=e.initial(at(2026,11,16,6));s.vehicles[0].seed=123456;
 assert.equal(e.valid(s),true);assert.equal(s.level,1);assert.equal(s.completed,0);
 assert.equal(s.vehicles.length,1);assert.equal(s.vehicles[0].origin,'city');
 assert.equal(e.CAPACITY,15);assert.equal(e.FARE,1650);assert.equal(e.PRICE,60000000);assert.equal(e.TARGET,1000);
 for(let m=1;m<360;m+=3){
  const t=at(2026,11,16,6,m);e.advance(s,t);
  assert.ok(s.vehicles[0].onboard>=0&&s.vehicles[0].onboard<=15);
  assert.equal(s.vehicles[0].gross,s.vehicles[0].boarded*1650);
 }
 assert.ok(s.completed>0);assert.equal(e.valid(s),true);
});
test('12:00 is final stop departure; first 40% settlement only after depot return',()=>{
 const e=engine(),now=at(2026,11,16,6),s=e.initial(now);s.vehicles[0].seed=21;
 e.advance(s,at(2026,11,16,11,58));
 assert.ok(s.vehicles[0].gross>0);
 const before=e.advance(s,at(2026,11,16,12));
 assert.equal(before.settlements.length,0);
 assert.equal(s.vehicles[0].phase,'returning');
 const after=e.advance(s,at(2026,11,16,12,20));
 assert.equal(after.settlements.length,1);
 assert.equal(after.settlements[0].payout,Math.floor(after.settlements[0].gross*.4));
 assert.equal(s.vehicles[0].gross,0);assert.equal(s.vehicles[0].onboard,0);
 assert.equal(e.advance(s,at(2026,11,16,12,20)).settlements.length,0);
});
test('afternoon 13:00-21:00 runs and settles independently',()=>{
 const e=engine(),start=at(2026,11,16,13),s=e.initial(start);s.vehicles[0].seed=421;
 const dep=e.advance(s,at(2026,11,16,21));
 assert.equal(dep.settlements.length,0);
 assert.equal(s.vehicles[0].phase,'returning');
 const paid=e.advance(s,at(2026,11,16,21,20));
 assert.equal(paid.settlements.length,1);assert.ok(paid.settlements[0].gross>0);
 assert.equal(e.advance(s,at(2026,11,16,22)).settlements.length,0);
});
test('permanent revenue +1pp; 100% payout maximum; vehicle capacity 100',()=>{
 const e=engine(),start=at(2026,11,16,6),s=e.initial(start);
 s.upgrades.revenue=1;assert.equal(e.rate(s),41);
 e.advance(s,at(2026,11,16,12));
 const paid=e.advance(s,at(2026,11,16,12,20)).settlements[0];
 assert.equal(paid.payout,Math.floor(paid.gross*41/100)); // Match integer-form production rounding.
 s.upgrades.revenue=60;assert.equal(e.rate(s),100);assert.equal(e.valid(s),true);
 for(let i=1;i<100;i++)assert.ok(e.addVehicle(s,start+i));
 assert.equal(s.vehicles.length,100);assert.equal(e.addVehicle(s,start+101),null);
 const save=JSON.parse(JSON.stringify(s));assert.equal(e.valid(save),true);
 assert.equal(save.upgrades.revenue,60);assert.equal(save.vehicles.length,100);
});
test('browser game wiring keeps existing saves and upgrade locked',()=>{
 const main=fs.readFileSync(path.join(root,'public/myon-v013.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/myon.html'),'utf8');
 assert.ok(main.includes("const DB=SERVER==='live'?'myon-v00804-progress':'myon-v00804-progress-'+SERVER;"));
 assert.ok(main.includes("if(!['live','test','dev'].includes(SERVER))"));
 assert.ok(main.includes("BUS_KEY='v01352-bus-world'"));
 assert.ok(main.includes('store.put(busSnapshot,BUS_KEY)'));
 assert.ok(main.includes('[BUS_KEY,busState]'));
 assert.ok(main.includes("activeWorld()==='bus'"));
 assert.match(html,/id="bus-world-panel"[^>]*hidden/);
 assert.match(html,/id="world-switch-bus"/);
 assert.match(html,/LV\.2 업글 · 준비 중/);
 assert.match(html,/class="slot-button bus-locked" disabled/);
 assert.ok(html.indexOf('myon-bus-engine.js')<html.indexOf('myon-v013.js'));
 assert.ok(html.indexOf('myon-bus-ui.js')<html.indexOf('myon-v013.js'));
 assert.doesNotThrow(()=>new Function('window','document','location',main));
});

test('bus purchases respect shared 50-car buying limit but original engine stays under absolute 100',()=>{
 const e=engine(),now=at(2026,11,16,6),s=e.initial(now);
 for(let i=2;i<=50;i++)assert.ok(e.addVehicle(s,now+i,50));
 assert.equal(s.vehicles.length,50);
 assert.equal(e.addVehicle(s,now+51,50),null);
 assert.equal(e.valid(s),true);
 assert.ok(e.addVehicle(s,now+52,60));
});
test('v0.13.53 shared fleet and auto upgrade UI is reachable in all worlds while bus LV2 stays locked',()=>{
 const main=fs.readFileSync(path.join(root,'public/myon-v013.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/myon.html'),'utf8');
 for(const id of ['world-fleet-buy','world-fleet-count','world-auto-buy','world-auto-rate'])
  assert.ok(html.includes('id="'+id+'"'));
 assert.ok(main.includes("fleetLimit:sharedFleetLimit()"));
 assert.ok(main.includes("advanceTaxiOffers(now);autoAcceptTaxiOffers(now)"));
 assert.ok(main.includes("truckAutoSeconds()>0&&now<truckOffers.nextAutoAt"));
 assert.match(html,/LV\.2 업글 · 준비 중/);
});
