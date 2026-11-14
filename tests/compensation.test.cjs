'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../public/myon-v013.js'),'utf8');
const F={world:'v01302-world',funds:'v01322-common-funds',taxi:'v01325-owned-vehicles',
 level:'v01337-taxi-level',ledger:'v01324-finance-ledger',
 comp:'v01348-emergency-compensation',restore:'v01348-before-compensation'};
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const DAY=86400,AMOUNT=1000000000;
function oldTaxi(id,origin='event'){
 return {id,fleetNo:id,model:'myon',origin,newPrice:20000000,price:0,
  remaining:0,durability:100000,serviceRuns:0,trips:0,location:'차고지',activeMissionId:0};
}
function fixture(time=Date.now()){
 const now=Math.floor(time/1000);
 return new Map(Object.entries({
  [F.world]:{schema:2,nextId:40,nextSupplyAt:Math.floor(now/3600)*3600+3600,pending:false,rng:123456,units:[]},
  [F.funds]:{schema:1,balance:12345678},
  [F.level]:{schema:1,completed:625,upgrades:{distance:0,revenue:0,fleet:0},masterRewardPaid:false},
  [F.taxi]:{schema:1,nextId:3,eventGranted:2,vehicles:[oldTaxi(1),oldTaxi(2)]},
  'v01341-world-switch':{schema:1,active:'taxi',visited:{taxi:true,truck:false},cycles:{taxi:1,truck:0},seen:{taxi:0,truck:0}},
  'v01341-truck-garage':{schema:1,completed:0,nextId:1,eventGranted:0,cityGranted:{medium:false,large:false},vehicles:[]},
  'v01341-truck-offers':{schema:1,seed:777,nextId:1,offers:[]},
  'v01323-taxi-offers':{schema:1,seed:444,nextOfferAt:Math.floor(now/300)*300+300,nextAutoAt:Math.floor(now/1800)*1800+1800,autoInterval:1800,offers:[]},
  [F.ledger]:{schema:1,openedAt:now-2000,openingBalance:12345678,totalIncome:0,totalExpenses:0,entries:[]},
  'v01313-assistant':{schema:1,startedAt:now-1200,baselineNextId:40,baselineActive:0,discardedCount:0}
 }));
}
async function microtasks(){for(let n=0;n<500;n++)await Promise.resolve()}
async function boot(data,clock={ms:Date.now()}){
 const elements=new Map(),errors=[],events={};
 const el=id=>{
  if(elements.has(id))return elements.get(id);
  const o={id,hidden:false,checked:false,disabled:false,open:false,scrollTop:0,
   value:'0',textContent:'',innerHTML:'',dataset:{},options:[],children:[],handlers:{},
   style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},
   addEventListener(kind,fn){this.handlers[kind]=fn},
   append(...x){this.children.push(...x)},appendChild(x){this.children.push(x);return x},
   replaceChildren(...x){this.children=x},remove(){},focus(){},setAttribute(){},
   getAttribute(){return ''},removeAttribute(){},
   querySelector:q=>el(id+'::'+q),querySelectorAll:()=>[]};
  elements.set(id,o);return o;
 };
 const document={hidden:false,body:el('body'),getElementById:el,
  querySelector:q=>el('global::'+q),querySelectorAll:()=>[],
  createElement:t=>el('element::'+t+'::'+elements.size),
  createDocumentFragment:()=>el('fragment::'+elements.size),
  addEventListener:(type,fn)=>{events[type]=fn}};
 const database={objectStoreNames:{contains:()=>true},createObjectStore(){},transaction(){
  let pending=0,done=false,aborted=false;const writes=new Map();
  const tx={oncomplete:null,onerror:null,onabort:null,error:null,
   abort(){aborted=true;Promise.resolve().then(()=>tx.onabort?.())}};
  const finish=()=>{
   if(pending===0&&!done&&!aborted){
    done=true;
    Promise.resolve().then(()=>{
     if(aborted)return;
     for(const [key,value] of writes)data.set(key,clone(value));
     tx.oncomplete?.();
    });
   }
  };
  const store={
   get(key){
    pending++;const req={result:undefined,onsuccess:null,onerror:null};
    Promise.resolve().then(()=>{req.result=clone(data.get(key));req.onsuccess?.();pending--;finish()});
    return req;
   },
   put(value,key){
    pending++;writes.set(key,clone(value));
    Promise.resolve().then(()=>{pending--;finish()});
   }
  };
  tx.objectStore=()=>store;return tx;
 }};
 const window={indexedDB:{open:()=>{
  const req={result:null,onsuccess:null,onerror:null,onupgradeneeded:null};
  Promise.resolve().then(()=>{req.result=database;req.onsuccess?.()});
  return req;
 }},addEventListener(){},MYON_RPG_TAXI:undefined};
 class FakeDate extends Date{
  constructor(...args){super(...(args.length?args:[clock.ms]))}
  static now(){return clock.ms}
 }
 const logs={log(){},warn(){},error(...args){errors.push(args.map(x=>String(x?.message||x)).join(' '))}};
 vm.runInNewContext(source,{window,document,location:{pathname:'/MYON/myon.html'},
  Date:FakeDate,setInterval:()=>0,fetch:async()=>({ok:false}),console:logs},{timeout:2000});
 await microtasks();
 return {data,clock,errors,e:id=>elements.get(id),checkpoint:()=>window.MYON_SAFE_UPDATE_CHECKPOINT(),cancelUpdate:()=>window.MYON_CANCEL_UPDATE_LOCK(),async click(id){
  const button=elements.get(id);assert.ok(button,'Expected UI element '+id);
  assert.equal(typeof button.handlers.click,'function','Expected click handler '+id);
  await button.handlers.click();await microtasks();
 },async tick(){events.visibilitychange?.();await microtasks()}};
}
test('original taxi save survives first visit and atomic one-time award survives reload',async()=>{
 const data=fixture();const a=await boot(data);
 assert.deepEqual(a.errors,[]);
 assert.equal(a.e('compensation-overlay').hidden,false);
 assert.equal(data.get(F.restore).records[F.funds].balance,12345678);
 const beforeCash=data.get(F.funds).balance,beforeCars=data.get(F.taxi).vehicles.length;
 await a.click('compensation-claim');
 assert.deepEqual(a.errors,[]);
 assert.equal(data.get(F.funds).balance,beforeCash+AMOUNT);
 assert.equal(data.get(F.taxi).vehicles.length,beforeCars+2);
 assert.equal(data.get(F.level).completed,625);
 assert.equal(data.get(F.comp).giftIssued,2);
 assert.equal(data.get(F.comp).expiresAt-data.get(F.comp).claimedAt,7*DAY);
 assert.equal(data.get(F.ledger).entries.filter(v=>v.category==='compensation-grant').length,1);
 const b=await boot(data);
 assert.deepEqual(b.errors,[]);
 assert.equal(b.e('compensation-overlay').hidden,true);
 assert.equal(data.get(F.funds).balance,beforeCash+AMOUNT);
 assert.equal(data.get(F.taxi).vehicles.length,beforeCars+2);
 assert.equal(data.get(F.ledger).entries.filter(v=>v.category==='compensation-grant').length,1);
});
test('owned taxi already running when claimed settles once with separate +200 percent bonus',async()=>{
 const clock={ms:Date.now()},data=fixture(clock.ms),now=Math.floor(clock.ms/1000);
 const vehicle=data.get(F.taxi).vehicles[0];vehicle.activeMissionId=41;
 data.get(F.world).nextId=42;data.get('v01313-assistant').baselineNextId=42;
 data.get('v01313-assistant').baselineActive=1;
 data.get(F.world).units.push({id:41,kind:'taxi',seed:1234,dispatch:'owned',contractType:'owned',
  taxiContractVersion:3,vehicleId:1,vehicleNo:1,worldCycle:1,shareUnits:100000,
  fareUnits:250000,passengerMeters:5000,start:now-30,end:now+120,
  destination:'완료 장소',stages:[{phase:'outbound',start:now-30,end:now+120,distance:5000}]});
 const a=await boot(data,clock);assert.deepEqual(a.errors,[]);
 await a.click('compensation-claim');
 const before=data.get(F.funds).balance;
 clock.ms+=(150*1000);await a.tick();
 assert.equal(data.get(F.funds).balance,before+300000);
 assert.equal(data.get(F.world).units.length,0);
 assert.equal(data.get(F.ledger).entries.filter(v=>v.category==='compensation-income').length,1);
 assert.equal(data.get(F.ledger).entries.find(v=>v.category==='compensation-income').amount,200000);
 await a.tick();assert.equal(data.get(F.funds).balance,before+300000);
});
test('discount halves fresh taxi purchase price without changing existing vehicle price',async()=>{
 const data=fixture();const a=await boot(data);await a.click('compensation-claim');
 const cash=data.get(F.funds).balance,cars=data.get(F.taxi).vehicles.length;
 await a.click('taxi-purchase-action');
 assert.equal(data.get(F.taxi).vehicles.length,cars+1);
 const v=data.get(F.taxi).vehicles.at(-1);
 assert.equal(v.price,10000000);
 assert.equal(v.newPrice,20000000);
 assert.equal(data.get(F.funds).balance,cash-v.playerPaidUnits);
 assert.equal(v.playerPaidUnits,4200000);
});
test('expired period does not discount new cars or modify future settlements',async()=>{
 const clock={ms:Date.now()},data=fixture(clock.ms),now=Math.floor(clock.ms/1000);
 data.set(F.comp,{schema:1,claimedAt:now-8*DAY,expiresAt:now-DAY,giftIssued:2});
 const a=await boot(data,clock);
 assert.deepEqual(a.errors,[]);
 assert.equal(a.e('compensation-benefit').hidden,true);
 assert.equal(a.e('compensation-notice').hidden,true);
 const before=data.get(F.funds).balance;
 await a.click('taxi-purchase-action');
 const v=data.get(F.taxi).vehicles.at(-1);
 assert.equal(v.price,20000000);
 assert.equal(data.get(F.funds).balance,before-v.playerPaidUnits);
});
test('corrupt saved garage aborts loading without replacing player money or cars',async()=>{
 const data=fixture(),money=data.get(F.funds).balance;
 data.get(F.taxi).vehicles[0].model='invalid';
 const cars=clone(data.get(F.taxi));
 const a=await boot(data);
 assert.ok(a.errors.some(x=>x.includes('safe startup blocked')));
 assert.deepEqual(data.get(F.taxi),cars);
 assert.equal(data.get(F.funds).balance,money);
 assert.equal(data.has(F.comp),false);
 assert.equal(data.get(F.restore).records[F.funds].balance,money);
});
test('missing mission key with saved taxi data prevents fresh-game overwrite',async()=>{
 const data=fixture(),cash=data.get(F.funds).balance,cars=clone(data.get(F.taxi));
 data.delete(F.world);
 const a=await boot(data);
 assert.ok(a.errors.some(x=>x.includes('safe startup blocked')));
 assert.equal(data.has(F.world),false);
 assert.deepEqual(data.get(F.taxi),cars);
 assert.equal(data.get(F.funds).balance,cash);
});
test('at capacity pending gift cars remain owed and auto-issue when a slot opens',async()=>{
 const data=fixture();
 const vehicles=Array.from({length:49},(_,i)=>oldTaxi(i+1,i<2?'city':'event'));
 data.set(F.taxi,{schema:1,nextId:50,eventGranted:2,vehicles});
 const a=await boot(data);assert.deepEqual(a.errors,[]);
 await a.click('compensation-claim');
 assert.equal(data.get(F.comp).giftIssued,1);
 assert.equal(data.get(F.taxi).vehicles.length,50);
 const garage=clone(data.get(F.taxi));
 const index=garage.vehicles.findIndex(v=>v.origin==='event'&&!v.compensationGift);
 assert.ok(index>=0);garage.vehicles.splice(index,1);data.set(F.taxi,garage);
 const b=await boot(data);
 assert.deepEqual(b.errors,[]);
 assert.equal(data.get(F.comp).giftIssued,2);
 assert.equal(data.get(F.taxi).vehicles.length,50);
});
test('claim on stale second tab never duplicates funds or taxis',async()=>{
 const data=fixture();
 const a=await boot(data),b=await boot(data);
 const before=data.get(F.funds).balance,cars=data.get(F.taxi).vehicles.length;
 await a.click('compensation-claim');
 await b.click('compensation-claim');
 assert.equal(data.get(F.funds).balance,before+AMOUNT);
 assert.equal(data.get(F.taxi).vehicles.length,cars+2);
 assert.equal(data.get(F.ledger).entries.filter(v=>v.category==='compensation-grant').length,1);
});


test('in-progress truck delivery is preserved across reload and pays +200 percent bonus',async()=>{
 const clock={ms:Date.now()},data=fixture(clock.ms),now=Math.floor(clock.ms/1000);
 const world=data.get('v01341-world-switch');
 world.active='truck';world.visited.truck=true;world.cycles.truck=1;
 data.get(F.world).nextId=42;data.get('v01313-assistant').baselineNextId=42;
 data.get('v01313-assistant').baselineActive=1;
 data.get(F.world).units.push({id:41,kind:'truck',seed:321,dispatch:'accepted',
  contractType:'outsource',truckContractVersion:1,vehicleId:0,worldCycle:1,
  shareUnits:100000,fareUnits:250000,from:'하린',to:'세온',distanceKm:60,
  start:now-120,end:now+120,
  stages:[{phase:'load',start:now-120,end:now-60},
   {phase:'outbound',start:now-60,end:now+90,distance:60000},
   {phase:'unload',start:now+90,end:now+120}]});
 const a=await boot(data,clock);
 assert.deepEqual(a.errors,[]);
 assert.equal(data.get(F.world).units.length,1,'Truck task must survive startup');
 await a.click('compensation-claim');
 const cash=data.get(F.funds).balance;
 clock.ms+=150000;await a.tick();
 assert.equal(data.get(F.funds).balance,cash+300000);
 assert.equal(data.get(F.world).units.length,0);
 assert.equal(data.get(F.ledger).entries.find(e=>e.category==='compensation-income').amount,200000);
});
test('truck purchases use a 50 percent discounted cost only during the claimed week',async()=>{
 const clock={ms:Date.now()},data=fixture(clock.ms);
 const world=data.get('v01341-world-switch');
 world.active='truck';world.visited.truck=true;world.cycles.truck=1;
 const a=await boot(data,clock);assert.deepEqual(a.errors,[]);
 await a.click('compensation-claim');
 const select=a.e('truck-purchase-model');
 assert.ok(select);select.value='cargo1';
 const firstCash=data.get(F.funds).balance,firstCars=data.get('v01341-truck-garage').vehicles.length;
 await a.click('truck-purchase-action');
 assert.equal(data.get(F.funds).balance,firstCash-10000000);
 assert.equal(data.get('v01341-truck-garage').vehicles.length,firstCars+1);
 clock.ms+=8*DAY*1000;await a.tick();
 const secondCash=data.get(F.funds).balance;
 await a.click('truck-purchase-action');
 assert.equal(data.get(F.funds).balance,secondCash-20000000);
});


test('update checkpoint reads back every save and preserves legacy progression',async()=>{
 const data=fixture(),originalFunds=data.get(F.funds).balance,originalLevel=data.get(F.level).completed;
 const a=await boot(data);
 assert.deepEqual(a.errors,[]);
 await a.click('compensation-close');
 assert.equal(await a.checkpoint(),true);
 a.cancelUpdate();
 assert.equal(data.get(F.funds).balance,originalFunds);
 assert.equal(data.get(F.level).completed,originalLevel);
 assert.equal(data.get(F.taxi).vehicles.length,4);
});
test('update checkpoint refuses stale tab with conflicting claimed compensation',async()=>{
 const data=fixture();
 const a=await boot(data),b=await boot(data);
 await a.click('compensation-claim');
 await b.click('compensation-close');
 assert.equal(await b.checkpoint(),false);
 assert.equal(data.get(F.comp).giftIssued,2);
 assert.equal(data.get(F.ledger).entries.filter(x=>x.category==='compensation-grant').length,1);
});
test('update checkpoint refuses while emergency award is being reviewed',async()=>{
 const a=await boot(fixture());
 assert.equal(a.e('compensation-overlay').hidden,false);
 assert.equal(await a.checkpoint(),false);
 await a.click('compensation-close');
 assert.equal(await a.checkpoint(),true);
 a.cancelUpdate();
});

test('v0.13.49 restore point preserves claimed 7-day bonus record',async()=>{
 const data=fixture(),now=Math.floor(Date.now()/1000);
 const claim={schema:1,claimedAt:now-60,expiresAt:now-60+7*DAY,giftIssued:2};
 data.set(F.comp,claim);
 const a=await boot(data);
 assert.deepEqual(a.errors,[]);
 const point=data.get('v01349-before-auto-update');
 assert.ok(point&&point.records,'Missing one-time pre-update backup');
 assert.deepEqual(point.records[F.comp],claim);
 assert.equal(point.records[F.funds].balance,12345678);
 assert.equal(point.records[F.level].completed,625);
});
