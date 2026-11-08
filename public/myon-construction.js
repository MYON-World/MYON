// MYON v0.13.00 — single automatic construction assignment.
// Runs independently of the v0.12.04 vehicle engine and never consumes vehicle slots.
(function () {
'use strict';
const DB='myon-v00804-progress',STORE='game',KEY='v01300-construction',DAY=86400;
const equipment=[
 {key:'newRail',name:'신규 철도건설',dailyMeters:1000},
 {key:'railRepair',name:'철도보수',dailyMeters:1500},
 {key:'roadRepair',name:'도로보수',dailyMeters:2000}
];
// Official MYON v0.13.01 game-balance rules; these figures are not certified
// real-world equipment specifications.
// 100m units: common short contracts, exceptionally rare extreme distances.
const tiers=[
 {weight:6500,min:5,max:50},        // 0.5–5km: 65%
 {weight:2500,min:51,max:200},      // 5.1–20km: 25%
 {weight:900,min:201,max:1000},     // 20.1–100km: 9%
 {weight:90,min:1001,max:5000},     // 100.1–500km: 0.9%
 {weight:10,min:5001,max:10000}     // 500.1–1000km: 0.1%
];
const $=id=>document.getElementById(id);
const ui={name:$('construction-name'),total:$('construction-total'),progress:$('construction-progress'),bar:$('construction-bar')};
const km=meters=>(Math.max(0,meters)/1000).toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})+'km';
const seedNow=()=>((Math.random()*4294967296)>>>0)||1;
function mix(n){n=(n^(n>>>16))>>>0;n=Math.imul(n,0x7feb352d)>>>0;n=(n^(n>>>15))>>>0;n=Math.imul(n,0x846ca68b)>>>0;return (n^(n>>>16))>>>0;}
let state=null,dbPromise=null,ready=false,dirty=false,lastSave=0,saveChain=Promise.resolve();
function nextRandom(){state.rng=(state.rng+0x6d2b79f5)>>>0;return mix(state.rng);}
function newMission(at){
 const spec=equipment[nextRandom()%equipment.length];
 const roll=nextRandom()%10000;
 let left=roll,selected=tiers[tiers.length-1];
 for(const tier of tiers){if(left<tier.weight){selected=tier;break;}left-=tier.weight;}
 const distanceUnits=selected.min+(nextRandom()%(selected.max-selected.min+1));
 return {id:state.nextMissionId++,kind:spec.key,targetMeters:distanceUnits*100,dailyMeters:spec.dailyMeters,startedAt:at};
}
function completionAt(m){
 return m.startedAt+Math.ceil(m.targetMeters*DAY/m.dailyMeters);
}
function workDone(m,now){
 return Math.min(m.targetMeters,Math.max(0,(now-m.startedAt)*m.dailyMeters/DAY));
}
function initial(now){
 state={schema:1,rng:seedNow(),nextMissionId:1,mission:null};
 state.mission=newMission(now);
 return state;
}
function valid(s){
 return s&&s.schema===1&&Number.isInteger(s.rng)&&s.rng>=0&&s.rng<=0xffffffff&&
 Number.isSafeInteger(s.nextMissionId)&&s.nextMissionId>0&&s.mission&&
 Number.isSafeInteger(s.mission.id)&&s.mission.id>0&&s.nextMissionId>s.mission.id&&
 equipment.some(e=>e.key===s.mission.kind)&&
 Number.isSafeInteger(s.mission.targetMeters)&&s.mission.targetMeters>=100&&s.mission.targetMeters<=1000000&&
 Number.isSafeInteger(s.mission.dailyMeters)&&s.mission.dailyMeters>0&&s.mission.dailyMeters<=100000&&
 Number.isSafeInteger(s.mission.startedAt)&&s.mission.startedAt>0;
}
function advance(now){
 if(!ready)return;
 // End only the current assignment before drawing another; never overlap jobs.
 // Advancing at the exact completion timestamp preserves offline elapsed time.
 let cycles=0;
 while(now>=completionAt(state.mission)&&cycles<100000){
  const finishedAt=completionAt(state.mission);
  state.mission=newMission(finishedAt);
  dirty=true;cycles++;
 }
}
function draw(now){
 if(!ready||!ui.name||!ui.total||!ui.progress||!ui.bar)return;
 const m=state.mission,spec=equipment.find(e=>e.key===m.kind);
 const done=workDone(m,now),percent=100*done/m.targetMeters;
 ui.name.textContent=spec.name;
 ui.total.textContent='총 '+km(m.targetMeters);
 ui.progress.textContent=km(done)+' / '+km(m.targetMeters)+' · '+percent.toFixed(2)+'%';
 ui.bar.style.width=percent.toFixed(2)+'%';
}
function openDb(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
  const req=window.indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||new Error('Construction DB open failed'));
 }).catch(e=>{dbPromise=null;throw e;});
 return dbPromise;
}
async function read(){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const req=db.transaction(STORE,'readonly').objectStore(STORE).get(KEY);
  req.onsuccess=()=>resolve(req.result||null);
  req.onerror=()=>reject(req.error||new Error('Construction read failed'));
 });
}
function save(now){
 if(!ready)return;
 const snapshot=JSON.parse(JSON.stringify(state));
 lastSave=now;dirty=false;
 saveChain=saveChain.catch(()=>{}).then(async()=>{
  const db=await openDb();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).put(snapshot,KEY);
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||new Error('Construction write failed'));
  });
 }).catch(e=>{console.error('MYON construction save:',e);dirty=true;});
}
function tick(){
 const now=Math.floor(Date.now()/1000);
 if(ready){advance(now);if(dirty&&now-lastSave>=20)save(now);}
 draw(now);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{if(ready&&dirty)save(Math.floor(Date.now()/1000));});
(async()=>{
 const now=Math.floor(Date.now()/1000);
 let saved=null;
 try{saved=await read();}catch(e){console.error('MYON construction load:',e);}
 if(valid(saved))state=saved;
 else{initial(now);dirty=true;}
 ready=true;
 tick();
 if(dirty)save(now);
 setInterval(tick,1000);
})();
})();