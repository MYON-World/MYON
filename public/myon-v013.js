// MYON v0.13.02 — unified autonomous 30-slot mission system.
// One hourly mission; transport and space return to origin before disposal.
(function () {
'use strict';
const DB='myon-v00804-progress',STORE='game',KEY='v01302-world',OLD_VEHICLES='v01204-world',OLD_CONSTRUCTION='v01300-construction';
const HOUR=3600,DAY=86400,WEEK=7*DAY,KST=9*HOUR,MAX=30,LOOKBACK=2*DAY;
const $=id=>document.getElementById(id);
const ui={list:$('slot-list'),date:$('clock-date'),clock:$('clock-time'),supply:$('next-supply')};
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const weekdayFmt=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',weekday:'short'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const pad=n=>String(Math.max(0,Math.floor(n))).padStart(2,'0');
const hms=n=>pad(n/3600)+':'+pad((n%3600)/60)+':'+pad(n%60);
const countdown=n=>{n=Math.max(0,Math.ceil(n));return n>=DAY?Math.floor(n/DAY)+'일 '+hms(n%DAY):hms(n);};
const shortRemaining=n=>{n=Math.max(0,Math.ceil(n));return n>=DAY?Math.ceil(n/DAY)+'일':n>=HOUR?Math.ceil(n/HOUR)+'시간':Math.ceil(n/60)+'분';};
const km=n=>(Math.max(0,n)/1000).toLocaleString('ko-KR',{maximumFractionDigits:2,minimumFractionDigits:2})+'km';
const seedNow=()=>((Math.random()*4294967296)>>>0)||1;
function mix(n){n=(n^(n>>>16))>>>0;n=Math.imul(n,0x7feb352d)>>>0;n=(n^(n>>>15))>>>0;n=Math.imul(n,0x846ca68b)>>>0;return (n^(n>>>16))>>>0;}
const range=(seed,index,min,max)=>min+(mix((seed+Math.imul((index+1)>>>0,0x9e3779b9))>>>0)%(max-min+1));
const routeTypes=[
 {key:'village',name:'마을버스',icon:'🚌',mode:'bus',stops:20,min:350,max:850,dwell:90,note:'정류장 20개'},
 {key:'city',name:'시내버스',icon:'🚌',mode:'bus',stops:40,min:600,max:1400,dwell:90,note:'정류장 40개'},
 {key:'express',name:'광역버스',icon:'🚌',mode:'bus',stops:10,min:450,max:1100,dwell:90,highway:true,note:'정류장 10개 · 고속도로 2시간'},
 {key:'nightExpress',name:'심야광역버스',icon:'🚌',mode:'bus',night:true,stops:10,min:450,max:1100,dwell:90,highway:true,note:'정류장 10개 · 심야운행'},
 {key:'tram',name:'트램',icon:'🚊',mode:'rail',stops:20,min:350,max:850,dwell:90,note:'정류장 20개 · 임시 이동 기준'},
 {key:'subway',name:'지하철',icon:'🚇',mode:'rail',stops:100,leg:180,dwell:60,note:'100개 역 · 이동 3분 · 정차 1분'},
 {key:'nightSubway',name:'심야지하철',icon:'🚇',mode:'rail',night:true,stops:100,leg:180,dwell:60,note:'100개 역 · 심야운행'},
 {key:'regional',name:'일반열차',icon:'🚆',mode:'rail',stops:10,leg:1800,dwell:60,note:'10개 역 · 이동 30분 · 정차 1분'},
 {key:'highspeed',name:'고속열차',icon:'🚄',mode:'rail',stops:5,leg:3600,dwell:60,note:'5개 역 · 이동 1시간 · 정차 1분'}
];
const specs=new Map(routeTypes.map(r=>[r.key,r]));
const modes=['taxi','truck','bus','rail','air','ship','space','construction'];
const unitNames={taxi:'택시',truck:'화물차',domestic:'국내선',international:'국제선',ship:'선박',space:'우주임무'};
const unitIcons={taxi:'🚕',truck:'🚚',domestic:'✈️',international:'✈️',ship:'🚢',space:'🚀'};
function kstMidnight(t){return Math.floor((t+KST)/DAY)*DAY-KST;}
function dayOfWeek(midnight){return new Date((midnight+KST)*1000).getUTCDay();}
function mondayStart(t){const m=kstMidnight(t);return m-((dayOfWeek(m)+6)%7)*DAY;}
function weekend(midnight){const d=dayOfWeek(midnight);return d===0||d===6;}
function intervalFor(route,originMidnight,offset){
 const off=offset%DAY;
 const peak=(off>=6*HOUR&&off<8*HOUR)||(off>=18*HOUR&&off<20*HOUR);
 if(route.night){
  if(weekend(originMidnight))return HOUR;
  return route.mode==='bus'?(peak?300:HOUR):(peak?1200:HOUR);
 }
 if(weekend(originMidnight))return route.mode==='bus'?1200:HOUR;
 return route.mode==='bus'?(peak?300:1200):(peak?1200:HOUR);
}
function departuresBetween(route,from,to){
 const spec=specs.get(route.routeKey);
 const result=[],first=kstMidnight(from)-DAY,last=kstMidnight(to),cutoff=route.cutoff;
 for(let day=first;day<=last;day+=DAY){
  if(day!==route.serviceDay)continue;
  if(spec.night){
   for(let offset=18*HOUR;offset<=DAY+8*HOUR;offset+=intervalFor(spec,day,offset)){
    const at=day+offset;
    if(at>=from&&at<=to&&at>=route.acquired&&at<=cutoff)result.push(at);
   }
  }else{
   const closing=weekend(day)?21*HOUR:23*HOUR;
   for(let offset=5*HOUR;offset<=closing;offset+=intervalFor(spec,day,offset)){
    const at=day+offset;
    if(at>=from&&at<=to&&at>=route.acquired&&at<cutoff)result.push(at);
   }
  }
 }
 result.sort((a,b)=>a-b);
 return result;
}
// A deterministic 15–25 km/h speed value every wall-clock second. A 256-second
// prefix table gives exact offline distance sums without second-by-second replay.
const speedPrefixes=new Map();
function speedPrefix(seed){
 let p=speedPrefixes.get(seed);
 if(p)return p;
 p=new Float64Array(257);
 for(let i=0;i<256;i++)p[i+1]=p[i]+range(seed,i,15,25);
 if(speedPrefixes.size>500)speedPrefixes.clear();
 speedPrefixes.set(seed,p);return p;
}
function speedUnits(seed,from,to){
 if(to<=from)return 0;
 const p=speedPrefix(seed);
 const sum=t=>Math.floor(t/256)*p[256]+p[t%256];
 return sum(to)-sum(from);
}
function distanceSince(seed,from,to){return speedUnits(seed,from,to)*5/18;}
function roadEnd(seed,from,distance){
 const target=Math.ceil(distance*18/5);
 let lo=from,hi=from+Math.ceil(distance*18/75)+3;
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if(speedUnits(seed,from,mid)>=target)hi=mid;else lo=mid+1;}
 return lo;
}

const constructionSpecs=[
 {key:'newRail',name:'신규 철도건설',dailyMeters:1000},
 {key:'railRepair',name:'철도보수',dailyMeters:1500},
 {key:'roadRepair',name:'도로보수',dailyMeters:2000}
];
// Official MYON game balance. Not manufacturer-certified equipment production.
const constructionTiers=[
 {weight:6500,min:5,max:50},     // 0.5–5km 65%
 {weight:2500,min:51,max:200},   // 5.1–20km 25%
 {weight:900,min:201,max:1000},  // 20.1–100km 9%
 {weight:90,min:1001,max:5000},  // 100.1–500km 0.9%
 {weight:10,min:5001,max:10000}  // 500.1–1000km 0.1%
];
let state=null,dbPromise=null,ready=false,lastSave=0,saveChain=Promise.resolve(),dirty=false;
const cards=new Map(),tripCache=new Map(),routeRows=new Map(),routeEndCache=new Map();
function nextRandom(){state.rng=(state.rng+0x6d2b79f5)>>>0;return mix(state.rng);}
function pick(arr){return arr[nextRandom()%arr.length];}
function addKstMonths(at,months){
 const d=new Date((at+KST)*1000),year=d.getUTCFullYear(),month=d.getUTCMonth()+months;
 const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 return Math.floor(Date.UTC(year,month,Math.min(d.getUTCDate(),lastDay),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds())/1000)-KST;
}
function jobIdentity(at,old){
 const id=old&&Number.isSafeInteger(old.id)&&old.id>0?old.id:state.nextId++;
 if(id>=state.nextId)state.nextId=id+1;
 return {id,seed:old&&Number.isInteger(old.seed)?old.seed>>>0:nextRandom(),acquired:at};
}
function createUnit(kind,at,old=null){
 const base=jobIdentity(at,old),seed=base.seed,stages=[];let cursor=at;
 const timed=(phase,duration)=>{const end=cursor+duration;stages.push({phase,start:cursor,end});cursor=end;};
 const drive=(phase,distance)=>{const end=roadEnd(seed,cursor,distance);stages.push({phase,start:cursor,end,distance});cursor=end;};
 // When upgrading from v0.13.01, carry forward the active leg rather than
 // restarting a vehicle that is still driving, flying or sailing.
 if(old&&Number.isSafeInteger(old.start)&&Number.isSafeInteger(old.end)&&
    old.start<=at&&old.end>at&&old.end>old.start){
  let legDistance=0;
  if((kind==='taxi'||kind==='truck')&&old.phase==='road'&&Number.isFinite(old.distance)&&old.distance>0){
   legDistance=old.distance;stages.push({phase:'outbound',start:old.start,end:old.end,distance:legDistance});
   cursor=old.end;
   if(kind==='truck')timed('unload',1800);
   drive('return',legDistance);
   return {...base,kind,start:old.start,end:cursor,stages};
  }
  if(kind==='truck'&&old.phase==='unload'){
   legDistance=range(seed,0,50,150)*100;
   stages.push({phase:'unload',start:old.start,end:old.end});cursor=old.end;
   drive('return',legDistance);
   return {...base,kind,start:old.start,end:cursor,stages};
  }
  if((kind==='domestic'||kind==='international')&&old.phase==='flight'){
   const flight=old.end-old.start;
   stages.push({phase:'outbound',start:old.start,end:old.end});cursor=old.end;
   timed('atc-return',600);timed('return',flight);
   return {...base,kind,start:old.start,end:cursor,stages};
  }
  if(kind==='ship'&&old.phase==='sailing'){
   const sail=old.end-old.start;
   stages.push({phase:'outbound',start:old.start,end:old.end});cursor=old.end;
   timed('return',sail);
   return {...base,kind,start:old.start,end:cursor,stages};
  }
 }
 if(kind==='taxi'){
  const distance=range(seed,0,30,100)*100;
  drive('outbound',distance);drive('return',distance);
 }else if(kind==='truck'){
  const distance=range(seed,0,50,150)*100;
  timed('load',1800);drive('outbound',distance);timed('unload',1800);drive('return',distance);
 }else if(kind==='domestic'||kind==='international'){
  const flight=(kind==='domestic'?1:range(seed,2,2,15))*HOUR;
  timed('atc',600);timed('outbound',flight);timed('atc-return',600);timed('return',flight);
 }else if(kind==='ship'){
  const leg=range(seed,3,2,30)*DAY;
  timed('outbound',leg);timed('return',leg);
 }else if(kind==='space'){
  // Three calendar months to one calendar year for the FULL round trip.
  const min=addKstMonths(at,3)-at,max=addKstMonths(at,12)-at;
  const total=min+Math.floor(nextRandom()/4294967296*(max-min+1));
  const outbound=Math.floor(total/2);
  timed('outbound',outbound);timed('return',total-outbound);
 }else throw new Error('Unknown mission kind: '+kind);
 return {...base,kind,start:at,end:cursor,stages};
}
function createRoute(at,old=null){
 const base=jobIdentity(at,old);
 const routeKey=old&&specs.has(old.routeKey)?old.routeKey:pick(routeTypes).key;
 const spec=specs.get(routeKey);
 const serviceDay=kstMidnight(at)+DAY;
 return {...base,kind:'route',routeKey,serviceDay,cutoff:serviceDay+DAY+(spec.night?8*HOUR:0)};
}
function createConstruction(at,old=null){
 const base=jobIdentity(at,old);
 const spec=old&&constructionSpecs.find(x=>x.key===old.kind)||pick(constructionSpecs);
 let targetMeters;
 if(old&&Number.isSafeInteger(old.targetMeters)&&old.targetMeters>0)targetMeters=old.targetMeters;
 else{
  let roll=nextRandom()%10000,tier=constructionTiers[constructionTiers.length-1];
  for(const candidate of constructionTiers){if(roll<candidate.weight){tier=candidate;break;}roll-=candidate.weight;}
  targetMeters=(tier.min+nextRandom()%(tier.max-tier.min+1))*100;
 }
 const dailyMeters=old&&Number.isInteger(old.dailyMeters)&&old.dailyMeters>0?old.dailyMeters:spec.dailyMeters;
 const start=old&&Number.isSafeInteger(old.startedAt)?old.startedAt:at;
 return {...base,kind:'construction',constructionKey:spec.key,targetMeters,dailyMeters,start,end:start+Math.ceil(targetMeters*DAY/dailyMeters)};
}
function itinerary(route,depart){
 const key=route.id+':'+depart;
 if(tripCache.has(key))return tripCache.get(key);
 const spec=specs.get(route.routeKey),stages=[];
 let offset=0,stop=1,dir=1;
 for(let i=0;i<2*(spec.stops-1);i++){
  const next=stop+dir;
  const highway=spec.highway&&((stop===5&&next===6)||(stop===6&&next===5));
  let length;
  if(highway)length=2*HOUR;
  else if(spec.leg)length=spec.leg;
  else{
   const legSeed=mix((route.seed^depart^Math.imul(i+1,0x9e3779b9))>>>0);
   const meters=range(legSeed,0,spec.min,spec.max);
   length=roadEnd(legSeed,depart+offset,meters)-(depart+offset);
  }
  offset+=length;
  stages.push({end:offset,phase:highway?'highway':'travel',from:stop,to:next});
  stop=next;
  if(stop===spec.stops&&dir===1)dir=-1;
  if(stop!==1){offset+=spec.dwell;stages.push({end:offset,phase:'stop',stop});}
 }
 const result={total:offset,stages};
 if(tripCache.size>6000)tripCache.clear();
 tripCache.set(key,result);
 return result;
}
function activeTrips(route,now){
 const times=departuresBetween(route,Math.max(route.acquired,now-LOOKBACK),now),active=[];
 for(const dep of times){
  const plan=itinerary(route,dep);
  const elapsed=now-dep;
  if(elapsed>=plan.total)continue;
  let lo=0,hi=plan.stages.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(plan.stages[mid].end>elapsed)hi=mid;else lo=mid+1;}
  const stage=plan.stages[lo];
  active.push({dep,stage,remaining:stage.end-elapsed});
 }
 return active;
}
function routeComplete(route,now){return now>=taskEnd(route);}

function routeEnd(route){
 const key=route.id+':'+route.serviceDay+':'+route.seed;
 if(routeEndCache.has(key))return routeEndCache.get(key);
 const departures=departuresBetween(route,route.serviceDay,route.cutoff);
 let end=route.cutoff;
 for(const dep of departures)end=Math.max(end,dep+itinerary(route,dep).total);
 if(routeEndCache.size>500)routeEndCache.clear();
 routeEndCache.set(key,end);
 return end;
}
function taskEnd(v){return v.kind==='route'?routeEnd(v):v.end;}
function availableModes(){
 return modes.filter(m=>m!=='bus'&&m!=='rail'||routeTypes.some(s=>s.mode===m&&!state.units.some(v=>v.kind==='route'&&v.routeKey===s.key)));
}
function supply(at){
 if(state.units.length>=MAX)return false;
 const choices=availableModes();
 if(!choices.length)return false;
 const mode=pick(choices);
 let job;
 if(mode==='bus'||mode==='rail'){
  const candidates=routeTypes.filter(x=>x.mode===mode&&!state.units.some(v=>v.kind==='route'&&v.routeKey===x.key));
  if(!candidates.length)return false;
  job=createRoute(at,{routeKey:pick(candidates).key});
 }else if(mode==='construction')job=createConstruction(at);
 else job=createUnit(mode==='air'?pick(['domestic','international']):mode,at);
 state.units.push(job);dirty=true;return true;
}
function earliestFinish(){
 let result=Infinity;
 for(const v of state.units)result=Math.min(result,taskEnd(v));
 return result;
}
function advance(now){
 if(!ready)return;
 // Chronological supply + retirement replay, including missed offline time.
 // A single pending supply is filled immediately once any mission completes.
 let count=0;
 while(count++<250000){
  const due=state.nextSupplyAt,finished=earliestFinish(),at=Math.min(due,finished);
  if(at>now||!Number.isFinite(at))break;
  const prevLength=state.units.length;
  if(finished<=at)state.units=state.units.filter(v=>taskEnd(v)>at);
  if(state.units.length!==prevLength)dirty=true;
  if(due===at){
   if(state.pending){
    if(state.units.length<MAX&&supply(at))state.pending=false;
   }else if(state.units.length<MAX)supply(at);
   else state.pending=true;
   state.nextSupplyAt+=HOUR;dirty=true;
  }else if(state.pending&&state.units.length<MAX&&supply(at))state.pending=false;
 }
}
function validWorld(s){
 return s&&s.schema===2&&Array.isArray(s.units)&&s.units.length<=101&&
 Number.isSafeInteger(s.nextId)&&s.nextId>0&&Number.isSafeInteger(s.nextSupplyAt)&&s.nextSupplyAt>0&&
 Number.isInteger(s.rng)&&typeof s.pending==='boolean'&&s.units.every(v=>
 v&&Number.isSafeInteger(v.id)&&v.id>0&&Number.isSafeInteger(taskEnd(v))&&
 (v.kind==='route'?specs.has(v.routeKey)&&Number.isSafeInteger(v.serviceDay):
 v.kind==='construction'?constructionSpecs.some(e=>e.key===v.constructionKey)&&v.dailyMeters>0:
 Array.isArray(v.stages)&&v.stages.length>0));
}
function initial(now){
 state={schema:2,nextId:1,nextSupplyAt:now+HOUR,pending:false,rng:seedNow(),units:[]};
 state.units.push(createUnit('taxi',now));return state;
}
function migrate(oldVehicles,oldConstruction,now){
 state={schema:2,nextId:1,nextSupplyAt:now+HOUR,pending:false,rng:oldVehicles&&Number.isInteger(oldVehicles.rng)?oldVehicles.rng:seedNow(),units:[]};
 if(oldVehicles&&oldVehicles.schema===1&&Array.isArray(oldVehicles.units)){
  const oldIds=new Set();
  for(const v of oldVehicles.units.slice(0,100)){
   if(!v||!Number.isSafeInteger(v.id)||v.id<=0||oldIds.has(v.id))continue;
   oldIds.add(v.id);
   if(v.kind==='route'&&specs.has(v.routeKey))state.units.push(createRoute(now,v));
   else if(['taxi','truck','domestic','international','ship'].includes(v.kind))state.units.push(createUnit(v.kind,now,v));
  }
  if(Number.isSafeInteger(oldVehicles.nextId))state.nextId=Math.max(state.nextId,oldVehicles.nextId);
  if(oldVehicles.pending)state.pending=true;
  if(Number.isSafeInteger(oldVehicles.nextSupplyAt)&&oldVehicles.nextSupplyAt>now&&oldVehicles.nextSupplyAt<=now+HOUR)state.nextSupplyAt=oldVehicles.nextSupplyAt;
 }
 const legacy=oldConstruction&&oldConstruction.mission;
 if(legacy&&constructionSpecs.some(e=>e.key===legacy.kind)&&Number.isSafeInteger(legacy.startedAt)&&legacy.startedAt>0&&
 Number.isSafeInteger(legacy.targetMeters)&&legacy.targetMeters>0&&Number.isSafeInteger(legacy.dailyMeters)&&legacy.dailyMeters>0){
  const end=legacy.startedAt+Math.ceil(legacy.targetMeters*DAY/legacy.dailyMeters);
  if(end>now)state.units.push(createConstruction(now,{...legacy,id:null}));
 }
 if(!state.units.length)state.units.push(createUnit('taxi',now));
 if(state.pending&&state.units.length<MAX&&supply(now))state.pending=false;
 return state;
}
function openDb(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
  const req=window.indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
 }).catch(e=>{dbPromise=null;throw e;});
 return dbPromise;
}
async function read(key){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const req=db.transaction(STORE,'readonly').objectStore(STORE).get(key);
  req.onsuccess=()=>resolve(req.result||null);
  req.onerror=()=>reject(req.error||new Error('MYON read failed'));
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
   tx.onerror=()=>reject(tx.error||new Error('MYON write failed'));
  });
 }).catch(e=>{console.error('MYON save:',e);dirty=true;});
}

function element(tag,cls,value){
 const el=document.createElement(tag);
 if(cls)el.className=cls;
 if(value!==undefined)el.textContent=value;
 return el;
}
function makeUnitCard(v){
 const card=element('article','slot'),head=element('div','slot-head'),name=element('div','slot-name');
 name.append(element('span','slot-icon',unitIcons[v.kind]),element('strong','',unitNames[v.kind]));
 const status=element('span','slot-state');
 head.append(name,status);
 const detail=element('div','slot-details');
 const left=element('span','slot-metric'),right=element('span','slot-metric slot-operations');
 detail.append(left,right);
 const bar=element('div','slot-progress');
 card.append(head,detail,bar);
 return {card,status,left,right,bar};
}
function makeConstructionCard(v){
 const card=element('article','slot construction-card');
 const row1=element('div','construction-line'),row2=element('div','construction-line');
 const name=element('strong'),total=element('span','construction-total');
 row1.append(name,total);
 const track=element('div','construction-track'),bar=element('div','construction-fill');
 track.append(bar);
 const progress=element('span','construction-progress');
 row2.append(track,progress);card.append(row1,row2);
 return {card,name,total,progress,bar};
}
function makeRouteCard(v){
 const spec=specs.get(v.routeKey),card=element('article','slot route-slot');
 const head=element('div','slot-head'),name=element('div','slot-name');
 name.append(element('span','slot-icon',spec.icon),element('strong','',spec.name));
 const status=element('span','slot-state');head.append(name,status);
 const info=element('div','route-info'),note=element('span','',spec.note),interval=element('span','');
 info.append(note,interval);
 const tableHead=element('div','route-row route-heading');
 tableHead.append(element('span','','출발시간'),element('span','','위치'));
 const rows=element('div','route-vehicles');
 card.append(head,info,tableHead,rows);
 return {card,status,interval,note,rows};
}

function reorder(){
 const list=state.units.slice().sort((a,b)=>taskEnd(a)-taskEnd(b)||a.id-b.id);
 const key=list.map(v=>v.id).join(',');
 if(reorder.key===key)return;
 const nodes=document.createDocumentFragment(),seen=new Set();
 for(const v of list){
  seen.add(v.id);
  let slot=cards.get(v.id);
  if(!slot){
   slot=v.kind==='route'?makeRouteCard(v):v.kind==='construction'?makeConstructionCard(v):makeUnitCard(v);
   cards.set(v.id,slot);
  }
  nodes.appendChild(slot.card);
 }
 for(const id of cards.keys())if(!seen.has(id)){cards.delete(id);routeRows.delete(id);}
 ui.list.replaceChildren(nodes);reorder.key=key;
}
function currentStage(v,now){return v.stages.find(s=>s.end>now)||v.stages[v.stages.length-1];}
function unitPresentation(v,now){
 const stage=currentStage(v,now);
 const states={
 taxi:{outbound:'목적지 이동',return:'복귀 중'},
 truck:{load:'상차 중',outbound:'배송 중',unload:'하역 중',return:'복귀 중'},
 domestic:{atc:'관제 중',outbound:'비행 중','atc-return':'귀항 준비',return:'귀항 중'},
 international:{atc:'관제 중',outbound:'비행 중','atc-return':'귀항 준비',return:'귀항 중'},
 ship:{outbound:'항해 중',return:'귀항 중'},
 space:{outbound:'우주임무 중',return:'지구 귀환 중'}
 };
 const remainingStage=stage.distance?km(Math.max(0,stage.distance-distanceSince(v.seed,stage.start,Math.min(now,stage.end)))):countdown(stage.end-now);
 return {status:states[v.kind][stage.phase]||'진행 중',value:remainingStage,progress:Math.max(0,Math.min(1,(now-v.start)/(v.end-v.start)))};
}
function routePosition(spec,trip){
 const s=trip.stage,term=spec.mode==='rail'&&!['tram'].includes(spec.key)?'역':'정류장';
 if(s.phase==='stop')return term+' '+s.stop+' 정차 중';
 if(s.phase==='highway')return '고속도로 이동 '+countdown(trip.remaining);
 return term+' '+s.from+' → '+s.to+' 이동 중';
}
function nextDeparture(route,now){
 const upcoming=departuresBetween(route,now+1,Math.min(route.cutoff,now+2*DAY));
 return upcoming.length?upcoming[0]:null;
}
function drawRoute(v,slot,now){
 const spec=specs.get(v.routeKey),trips=activeTrips(v,now);
 slot.note.textContent='남은 '+countdown(Math.max(0,taskEnd(v)-now));
 const isClosing=now>=v.cutoff;
 slot.status.textContent=trips.length?'운행 중 '+trips.length+'대':isClosing?'운행 종료':'출발 대기';
 slot.status.classList.toggle('waiting',!trips.length);
 const today=kstMidnight(now),int=intervalFor(spec,today,(now-today)%DAY);
 slot.interval.textContent='배차 '+(int===HOUR?'1시간':int/60+'분');
 const store=routeRows.get(v.id)||new Map();
 routeRows.set(v.id,store);
 const identities=trips.map(t=>String(t.dep));
 if(!trips.length){
  const next=nextDeparture(v,now);
  identities.push('standby');
  let row=store.get('standby');
  if(!row){
   const node=element('div','route-row route-vehicle'),a=element('span','route-depart'),b=element('span','route-position');
   node.append(a,b);row={node,a,b};store.set('standby',row);
  }
  row.a.textContent=next?timeFmt.format(new Date(next*1000)):'--:--';
  row.b.textContent=next?(new Date((next+KST)*1000).getUTCHours()===5?'첫차 출발대기 ':'출발대기 ')+countdown(next-now):'운행 종료';
 }
 for(const trip of trips){
  const id=String(trip.dep);
  let row=store.get(id);
  if(!row){
   const node=element('div','route-row route-vehicle'),a=element('span','route-depart'),b=element('span','route-position');
   node.append(a,b);row={node,a,b};store.set(id,row);
   row.a.textContent=timeFmt.format(new Date(trip.dep*1000));
  }
  row.b.textContent=routePosition(spec,trip);
 }
 const current=identities.join(',');
 if(slot.order!==current){
  const frag=document.createDocumentFragment();
  for(const id of identities)frag.appendChild(store.get(id).node);
  slot.rows.replaceChildren(frag);slot.order=current;
 }
 const keep=new Set(identities);
 for(const id of store.keys())if(!keep.has(id))store.delete(id);
}
function draw(now){
 const date=new Date(now*1000);
 ui.date.textContent=dateFmt.format(date).replace(/-/g,'.')+' ('+weekdayFmt.format(date)+')';
 ui.clock.textContent=timeFmt.format(date);
 if(!ready)return;
 reorder();
 for(const v of state.units){
  const slot=cards.get(v.id);if(!slot)continue;
  if(v.kind==='route'){drawRoute(v,slot,now);continue;}
  if(v.kind==='construction'){
   const spec=constructionSpecs.find(s=>s.key===v.constructionKey);
   const done=Math.min(v.targetMeters,Math.max(0,(now-v.start)*v.dailyMeters/DAY));
   const p=Math.min(1,done/v.targetMeters);
   slot.name.textContent=spec.name;slot.total.textContent='총 '+km(v.targetMeters);
   slot.progress.textContent=km(done)+' · '+(100*p).toFixed(1)+'% · '+shortRemaining(v.end-now)+' 남음';
   slot.bar.style.width=(100*p).toFixed(2)+'%';
   continue;
  }
  const info=unitPresentation(v,now);
  slot.status.textContent=info.status;
  slot.left.textContent=info.value;
  slot.right.textContent='남은 '+countdown(v.end-now);
  slot.bar.style.width=(100*info.progress).toFixed(2)+'%';
 }
 ui.supply.textContent=state.units.length>=MAX?state.units.length+'개 · 공급 대기':
  state.pending?'대기 임무 배정 예정':countdown(state.nextSupplyAt-now);
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
 let saved=null,oldVehicles=null,oldConstruction=null;
 try{
  saved=await read(KEY);
  if(!saved){oldVehicles=await read(OLD_VEHICLES);oldConstruction=await read(OLD_CONSTRUCTION);}
 }catch(e){console.error('MYON mission load:',e);}
 if(saved&&validWorld(saved))state=saved;
 else{state=migrate(oldVehicles,oldConstruction,now);dirty=true;}
 ready=true;
 tick();
 if(dirty)save(now);
 setInterval(tick,1000);
})();
})();
