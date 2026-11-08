// MYON v0.12.03 — one-page autonomous fleet. Operating counts replace money.
// New world save key preserves the old v01200-taxi record and all earlier versions.
(function () {
'use strict';
const DB='myon-v00804-progress', STORE='game', KEY='v01203-world', OLD_KEY='v01200-taxi';
const HOUR=3600000, DAY=24*HOUR, MINUTE=60000;
const MAX_VEHICLES=100, MAX_LEVEL=20, SPEED=250, PERIOD=4096;
const el=id=>document.getElementById(id);
const ui={date:el('clock-date'),clock:el('clock-time'),list:el('slot-list'),supply:el('next-supply')};
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const count=n=>n.toLocaleString('ko-KR')+'회';
const pad=n=>String(n).padStart(2,'0');
const mmss=s=>pad(Math.floor(s/60))+':'+pad(s%60);
const hhmmss=s=>pad(Math.floor(s/3600))+':'+pad(Math.floor(s/60)%60)+':'+pad(s%60);
const levelFor=n=>Math.min(MAX_LEVEL,1+Math.floor(n/100));
const cooldown=n=>Math.max(MINUTE,600000-(levelFor(n)-1)*30000);
const randomSeed=()=>Math.floor(Math.random()*4294967296)>>>0;
// A stable per-taxi pseudorandom 3–10 km itinerary, restorable without extra
// storage and fast-forwardable even after long periods away from the page.
function distanceFor(seed,index){
  let n=(seed+Math.imul(index%PERIOD+1,0x9e3779b9))>>>0;
  n=Math.imul(n^(n>>>16),0x7feb352d)>>>0;
  n=Math.imul(n^(n>>>15),0x846ca68b)>>>0;
  n=(n^(n>>>16))>>>0;
  return 3000+(n%71)*100;
}
const distanceMs=(v,index)=>distanceFor(v.seed,index)*1000/SPEED;
const initialVehicle=(id,at)=>{
  const v={id,kind:'taxi',seed:randomSeed(),completed:0,maxRuns:0,phase:'trip',since:at,until:at,distance:0};
  v.distance=distanceFor(v.seed,0);
  v.until=at+v.distance*1000/SPEED;
  return v;
};
const initial=(at)=>({schema:1,nextId:2,supplyHours:24,nextSupplyAt:at+DAY,vehicles:[initialVehicle(1,at)]});
function validWorld(s){
  if(!s||s.schema!==1||!Number.isSafeInteger(s.nextId)||s.nextId<1||!Number.isInteger(s.supplyHours)||s.supplyHours<1||s.supplyHours>24||!Number.isSafeInteger(s.nextSupplyAt)||s.nextSupplyAt<=0||!Array.isArray(s.vehicles)||s.vehicles.length>MAX_VEHICLES)return false;
  const seen=new Set();
  for(const v of s.vehicles){
    if(!v||v.kind!=='taxi'||!Number.isSafeInteger(v.id)||v.id<1||v.id>=s.nextId||seen.has(v.id)||!Number.isInteger(v.seed)||v.seed<0||v.seed>4294967295||!Number.isSafeInteger(v.completed)||v.completed<0||!Number.isSafeInteger(v.maxRuns)||v.maxRuns<0||v.maxRuns>v.completed||!['trip','wait','legacy'].includes(v.phase)||!Number.isSafeInteger(v.since)||v.since<=0||!Number.isSafeInteger(v.until)||v.until<v.since)return false;
    if(v.phase==='trip'&&(!Number.isInteger(v.distance)||v.distance<3000||v.distance>10000||v.until!==v.since+v.distance*1000/SPEED))return false;
    seen.add(v.id);
  }
  return true;
}
function migrate(old,at){
  const world=initial(at),v=world.vehicles[0];
  if(!old||![1,2].includes(old.schema)||!Number.isSafeInteger(old.completed)||old.completed<0)return world;
  v.completed=old.completed; // Past money is intentionally retired; past completed work is preserved.
  if(old.schema===2&&old.trip&&Number.isSafeInteger(old.trip.distance)&&Number.isSafeInteger(old.trip.startedAt)&&Number.isSafeInteger(old.trip.endsAt)){
    // Settle an already-finished old trip once at migration time; do not
    // retroactively run the new fleet rules before this version existed.
    v.phase='trip';v.distance=old.trip.distance;
    v.until=Math.max(at,old.trip.endsAt);v.since=v.until-v.distance*1000/SPEED;
  }else if(old.schema===2&&old.legacy&&Number.isSafeInteger(old.legacy.endsAt)){
    v.phase='legacy';v.distance=0;v.until=Math.max(at,old.legacy.endsAt);v.since=at;
  }else if(old.schema===1&&old.running&&Number.isSafeInteger(old.running.endsAt)){
    v.phase='legacy';v.distance=0;v.until=Math.max(at,old.running.endsAt);v.since=at;
  }else if(old.schema===2&&Number.isSafeInteger(old.waitingUntil)&&old.waitingUntil>at){
    v.phase='wait';v.distance=0;v.since=at;v.until=old.waitingUntil;
  }else{
    v.distance=distanceFor(v.seed,v.completed);
    v.until=at+v.distance*1000/SPEED;
  }
  // Prior versions had no max-level contribution, so the new per-taxi
  // contribution counter starts at zero even for a veteran taxi.
  return world;
}
let state,ready=false,dbPromise=null,saveQueue=Promise.resolve();
const slots=new Map(),prefixCache=new Map();
function openDb(){
  if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
    const req=window.indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
  }).catch(err=>{dbPromise=null;throw err;});
  return dbPromise;
}
async function read(key){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,'readonly').objectStore(STORE).get(key);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error||new Error('MYON save read failed'));
  });
}
function save(){
  if(!ready)return;
  const snapshot=JSON.parse(JSON.stringify(state));
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(snapshot,KEY);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('MYON save failed'));
      tx.onabort=()=>reject(tx.error||new Error('MYON save aborted'));
    });
  }).catch(err=>console.error('MYON save:',err));
}
function startTrip(v,at){
  v.phase='trip';v.since=at;
  v.distance=distanceFor(v.seed,v.completed);
  v.until=at+v.distance*1000/SPEED;
}
function endTrip(v,at){
  const previous=v.completed;
  v.completed++;
  if(previous>=1900){
    v.maxRuns++;
    if(v.maxRuns%100===0&&state.supplyHours>1){
      state.supplyHours--;
      // Change the *upcoming* vehicle's arrival immediately, not any past arrival.
      state.nextSupplyAt=Math.max(at,state.nextSupplyAt-HOUR);
    }
  }
  v.phase='wait';v.distance=0;v.since=at;v.until=at+cooldown(v.completed);
}
function stepVehicle(v){
  const at=v.until;
  if(v.phase==='wait')startTrip(v,at);
  else endTrip(v,at);
}
function addVehicle(at){
  if(state.vehicles.length>=MAX_VEHICLES)return false;
  const v=initialVehicle(state.nextId++,at);
  state.vehicles.push(v);
  return true;
}
function cyclePrefix(v){
  let c=prefixCache.get(v.id);
  if(c&&c.seed===v.seed)return c.values;
  const p=new Float64Array(PERIOD+1);
  for(let i=0;i<PERIOD;i++)p[i+1]=p[i]+distanceMs(v,i);
  prefixCache.set(v.id,{seed:v.seed,values:p});
  return p;
}
function cycleSum(v,index,n){
  const p=cyclePrefix(v);
  const sumTo=x=>Math.floor(x/PERIOD)*p[PERIOD]+p[x%PERIOD];
  return sumTo(index+n)-sumTo(index)+n*MINUTE;
}
function fastForwardOne(v,now){
  let changed=false;
  // Before Lv.20 the cooldown changes each 100 operations; replay those
  // limited transitions exactly, then use a closed-form Lv.20 schedule.
  while(v.completed<1900&&v.until<=now){stepVehicle(v);changed=true;}
  if(v.until>now)return changed;
  if(v.phase!=='wait'){
    stepVehicle(v);changed=true;
    if(v.until>now)return changed;
  }
  // At this point v is a Lv.20 taxi waiting to begin its next trip.
  const start=v.until,first=v.completed;
  let low=0,high=Math.floor((now-start)/(12*1000+MINUTE))+1;
  while(low<high){
    const mid=Math.floor((low+high+1)/2);
    if(start+cycleSum(v,first,mid)<=now)low=mid;
    else high=mid-1;
  }
  const completed=low;
  if(completed){v.completed+=completed;v.maxRuns+=completed;changed=true;}
  const nextStart=start+cycleSum(v,first,completed);
  const d=distanceFor(v.seed,v.completed),ends=nextStart+d*1000/SPEED;
  if(now<ends){
    v.phase='trip';v.since=nextStart;v.distance=d;v.until=ends;
  }else{
    v.completed++;v.maxRuns++;
    v.phase='wait';v.since=ends;v.distance=0;v.until=ends+MINUTE;
  }
  return true;
}
function advance(now){
  if(!ready)return;
  let changed=false,rosterChanged=false;
  // Replay chronologically until the vehicle supply interval reaches one hour.
  // Individual (not pooled) Lv.20 completions may shorten the next arrival.
  while(state.supplyHours>1){
    let next=state.nextSupplyAt,vehicle=null;
    for(const v of state.vehicles){if(v.until<next){next=v.until;vehicle=v;}}
    if(next>now)break;
    if(vehicle){stepVehicle(vehicle);changed=true;}
    else{
      if(addVehicle(next))rosterChanged=true;
      state.nextSupplyAt=next+state.supplyHours*HOUR;
      changed=true;
    }
  }
  // Once the floor is reached, supply milestones no longer alter the clock.
  // Jump over complete one-hour supply windows and long Lv.20 schedules.
  if(state.supplyHours===1){
    if(state.nextSupplyAt<=now){
      const due=Math.floor((now-state.nextSupplyAt)/HOUR)+1;
      const arrivals=Math.min(MAX_VEHICLES-state.vehicles.length,due);
      for(let i=0;i<arrivals;i++){
        addVehicle(state.nextSupplyAt+i*HOUR);
        rosterChanged=true;
      }
      state.nextSupplyAt+=due*HOUR;
      changed=true;
    }
    for(const v of state.vehicles)if(v.until<=now){
      if(fastForwardOne(v,now))changed=true;
    }
  }
  if(rosterChanged)renderSlots();
  if(changed)save();
}
function create(tag,cls,txt){
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(txt!==undefined)e.textContent=txt;
  return e;
}
function makeSlot(v){
  const card=create('article','slot');card.setAttribute('aria-label','택시 '+v.id+'호차');
  const head=create('div','slot-head');
  const name=create('div','slot-name');
  const icon=create('span','slot-icon','🚕');icon.setAttribute('aria-hidden','true');
  const title=create('strong','', '택시 '+v.id+'호차');
  const level=create('span','slot-level');name.append(icon,title,level);
  const right=create('div','slot-right');
  const status=create('span','slot-state','운행 중');
  const sale=create('button','slot-button','판매');sale.type='button';
  sale.addEventListener('click',()=>sellVehicle(v.id));
  right.append(status,sale);head.append(name,right);
  const details=create('div','slot-details');
  const left=create('span','slot-metric');
  const operations=create('span','slot-metric slot-operations');
  details.append(left,operations);
  const progress=create('div','slot-progress');
  card.append(head,details,progress);
  return {card,level,status,left,operations,progress};
}
function renderSlots(){
  const fragment=document.createDocumentFragment(),ids=new Set();
  for(const v of state.vehicles){
    ids.add(v.id);
    let slot=slots.get(v.id);
    if(!slot){slot=makeSlot(v);slots.set(v.id,slot);}
    fragment.appendChild(slot.card);
  }
  for(const id of slots.keys())if(!ids.has(id)){slots.delete(id);prefixCache.delete(id);}
  ui.list.replaceChildren(fragment);
}
function sellVehicle(id){
  if(!ready)return;
  const now=Date.now();
  advance(now);
  const i=state.vehicles.findIndex(v=>v.id===id);
  if(i<0)return;
  state.vehicles.splice(i,1);
  renderSlots();
  save(); // Irreversible by design; already-earned supply reductions remain.
  draw(now);
}
function draw(now){
  const date=new Date(now);
  ui.date.textContent=dateFmt.format(date).replace(/-/g,'.');
  ui.clock.textContent=timeFmt.format(date);
  if(!ready)return;
  for(const v of state.vehicles){
    const slot=slots.get(v.id);
    if(!slot)continue;
    const isTrip=v.phase==='trip',isWaiting=v.phase==='wait';
    slot.level.textContent='Lv.'+levelFor(v.completed);
    slot.status.style.display=isWaiting?'none':'inline-block';
    slot.left.textContent=isTrip?((Math.max(0,v.distance-(now-v.since)*SPEED/1000)/1000).toFixed(2)+'km'):
      isWaiting?'대기 '+mmss(Math.max(0,Math.ceil((v.until-now)/1000))):'—km';
    slot.operations.textContent=count(v.completed);
    slot.progress.style.width=isTrip?(Math.max(0,Math.min(100,(now-v.since)/(v.until-v.since)*100))+'%'):'0%';
  }
  ui.supply.textContent=state.vehicles.length>=MAX_VEHICLES?'차량 100대 도달':
    hhmmss(Math.max(0,Math.ceil((state.nextSupplyAt-now)/1000)));
}
function tick(){
  const now=Date.now();
  advance(now);
  draw(now);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{if(ready)save();});
(async()=>{
  const now=Date.now();
  let stored=null,old=null;
  try{stored=await read(KEY);if(!validWorld(stored))old=await read(OLD_KEY);}
  catch(err){console.error('MYON load:',err);}
  const fromCurrent=validWorld(stored);
  state=fromCurrent?stored:migrate(old,now);
  ready=true;
  renderSlots();
  if(!fromCurrent)save();
  tick();
  setInterval(tick,250);
})();
})();