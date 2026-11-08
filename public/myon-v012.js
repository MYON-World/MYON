// MYON v0.12.04 — autonomous road, route, air and sea transport.
// KST timetables use real clock time. Route departures are derived, not owned fleet slots.
(function () {
'use strict';
const DB='myon-v00804-progress',STORE='game',KEY='v01204-world',PREV='v01203-world',LEGACY='v01200-taxi';
const HOUR=3600,DAY=86400,WEEK=7*DAY,KST=9*HOUR,MAX=100,LOOKBACK=2*DAY;
const $=id=>document.getElementById(id);
const ui={list:$('slot-list'),date:$('clock-date'),clock:$('clock-time'),supply:$('next-supply')};
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const weekdayFmt=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',weekday:'short'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const pad=n=>String(Math.max(0,Math.floor(n))).padStart(2,'0');
const hms=n=>pad(n/3600)+':'+pad((n%3600)/60)+':'+pad(n%60);
const countdown=n=>{n=Math.max(0,Math.ceil(n));return n>=DAY?Math.floor(n/DAY)+'일 '+hms(n%DAY):hms(n);};
const km=n=>(Math.max(0,n)/1000).toFixed(2)+'km';
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
const modes=['taxi','truck','bus','rail','air','ship'];
const unitNames={taxi:'택시',truck:'화물차',domestic:'국내선',international:'국제선',ship:'선박'};
const unitIcons={taxi:'🚕',truck:'🚚',domestic:'✈️',international:'✈️',ship:'🚢'};
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
let state=null,dbPromise=null,ready=false,lastSave=0,saveChain=Promise.resolve(),dirty=false;
const cards=new Map(),tripCache=new Map(),routeRows=new Map();
function nextRandom(){state.rng=(state.rng+0x6d2b79f5)>>>0;return mix(state.rng);}
function pick(arr){return arr[nextRandom()%arr.length];}
function newUnit(kind,at,old=null){
 const id=old&&old.id?old.id:state.nextId++;
 const seed=old&&Number.isInteger(old.seed)?old.seed:nextRandom();
 const v={id,kind,seed,completed:old?Math.max(0,old.completed%100):0,phase:'',start:at,end:at,distance:0};
 if(id>=state.nextId)state.nextId=id+1;
 if(kind==='taxi')startRoad(v,at,range(seed,v.completed,30,100)*100);
 else if(kind==='truck')timed(v,'load',at,1800);
 else if(kind==='domestic'||kind==='international')timed(v,'atc',at,600);
 else startSailing(v,at);
 return v;
}
function timed(v,phase,at,seconds){v.phase=phase;v.start=at;v.end=at+seconds;v.distance=0;}
function startRoad(v,at,dist){v.phase='road';v.start=at;v.distance=dist;v.end=roadEnd(v.seed,at,dist);}
function startSailing(v,at){timed(v,'sailing',at,range(v.seed,v.completed,2,30)*DAY);}
function nextPhase(v,at){
 if(v.kind==='taxi'){
  if(v.phase==='road'){v.completed++;if(v.completed>=100)return false;timed(v,'wait',at,600);}
  else startRoad(v,at,range(v.seed,v.completed,30,100)*100);
 }else if(v.kind==='truck'){
  if(v.phase==='load')startRoad(v,at,range(v.seed,v.completed,50,150)*100);
  else if(v.phase==='road')timed(v,'unload',at,1800);
  else if(v.phase==='unload'){v.completed++;if(v.completed>=100)return false;timed(v,'wait',at,HOUR);}
  else timed(v,'load',at,1800);
 }else if(v.kind==='domestic'||v.kind==='international'){
  if(v.phase==='atc')timed(v,'flight',at,v.kind==='domestic'?HOUR:range(v.seed,v.completed,2,15)*HOUR);
  else if(v.phase==='flight'){v.completed++;if(v.completed>=100)return false;timed(v,'wait',at,HOUR);}
  else timed(v,'atc',at,600);
 }else{
  v.completed++;if(v.completed>=100)return false;startSailing(v,at);
 }
 return true;
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
function routeComplete(route,now){
 if(now<route.cutoff)return false;
 if(now>=route.cutoff+LOOKBACK)return true;
 return activeTrips(route,now).length===0;
}
function settle(at){
 let changed=false;
 state.units=state.units.filter(v=>{
  if(v.kind==='route'){
   if(routeComplete(v,at)){changed=true;return false;}
   return true;
  }
  let steps=0;
  while(v.end<=at&&steps<500){
   steps++;
   if(!nextPhase(v,v.end)){changed=true;return false;}
   changed=true;
  }
  return true;
 });
 if(changed)dirty=true;
}
function availableModes(){
 return modes.filter(m=>m!=='bus'&&m!=='rail'||routeTypes.some(s=>s.mode===m&&!state.units.some(v=>v.kind==='route'&&v.routeKey===s.key)));
}
function supply(at){
 if(state.units.length>=MAX)return false;
 const modeList=availableModes();
 if(!modeList.length)return false;
 const mode=pick(modeList);
 if(mode==='bus'||mode==='rail'){
  const unused=routeTypes.filter(r=>r.mode===mode&&!state.units.some(v=>v.kind==='route'&&v.routeKey===r.key));
  if(!unused.length)return false;
  const spec=pick(unused);
  const acquired=at,cutoff=mondayStart(at)+WEEK+(spec.night?8*HOUR:0);
  state.units.push({id:state.nextId++,kind:'route',routeKey:spec.key,seed:nextRandom(),acquired,cutoff,completed:0});
 }else{
  const kind=mode==='air'?pick(['domestic','international']):mode;
  state.units.push(newUnit(kind,at));
 }
 dirty=true;return true;
}
function advance(now){
 if(!ready)return;
 // Process supply chronologically, so newly acquired vehicles also work while offline.
 let processed=0;
 while(state.nextSupplyAt<=now&&processed<150000){
  const at=state.nextSupplyAt;
  settle(at);
  if(state.pending&&state.units.length<MAX){
   supply(at);state.pending=false;
  }else if(state.units.length<MAX)supply(at);
  else state.pending=true;
  state.nextSupplyAt+=HOUR;processed++;
 }
 if(processed>=150000)state.nextSupplyAt=now+HOUR;
 settle(now);
 if(state.pending&&state.units.length<MAX){
  if(supply(now)){state.pending=false;state.nextSupplyAt=Math.max(state.nextSupplyAt,now+HOUR);}
 }
 if(processed)dirty=true;
}
function validWorld(s){
 return s&&s.schema===1&&Array.isArray(s.units)&&s.units.length<=MAX&&Number.isSafeInteger(s.nextId)&&
  Number.isSafeInteger(s.nextSupplyAt)&&s.nextSupplyAt>0&&Number.isInteger(s.rng)&&typeof s.pending==='boolean'&&
  s.units.every(v=>v&&Number.isSafeInteger(v.id)&&typeof v.kind==='string'&&(v.kind!=='route'||specs.has(v.routeKey)));
}
function initial(now){return {schema:1,nextId:1,nextSupplyAt:now+HOUR,pending:false,rng:seedNow(),units:[]};}
function migrate(prev,legacy,now){
 const s=initial(now);state=s;
 if(prev&&prev.schema===1&&Array.isArray(prev.vehicles)){
  for(const old of prev.vehicles){
   if(s.units.length>=MAX)break;
   if(old&&Number.isInteger(old.id)&&Number.isInteger(old.completed)&&old.completed>=0){
    s.units.push(newUnit('taxi',now,old));
   }
  }
 }else if(legacy&&Number.isInteger(legacy.completed)){
  s.units.push(newUnit('taxi',now,{id:1,seed:seedNow(),completed:legacy.completed}));
 }
 if(!s.units.length)s.units.push(newUnit('taxi',now));
 return s;
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
 const e=document.createElement(tag);
 if(cls)e.className=cls;
 if(value!==undefined)e.textContent=value;
 return e;
}
function makeUnitCard(v){
 const card=element('article','slot');
 const head=element('div','slot-head'),name=element('div','slot-name');
 const icon=element('span','slot-icon',unitIcons[v.kind]),title=element('strong','',unitNames[v.kind]);
 const status=element('span','slot-state');
 name.append(icon,title);head.append(name,status);
 const details=element('div','slot-details'),left=element('span','slot-metric'),right=element('span','slot-metric slot-operations');
 details.append(left,right);
 const bar=element('div','slot-progress');
 card.append(head,details,bar);
 return {card,status,left,right,bar};
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
 return {card,status,interval,rows};
}
function reorder(){
 const units=state.units.slice().sort((a,b)=>{
  if(a.kind==='route'&&b.kind!=='route')return 1;
  if(a.kind!=='route'&&b.kind==='route')return -1;
  if(a.kind==='route'&&b.kind==='route')return a.acquired-b.acquired||a.id-b.id;
  return b.completed-a.completed||a.end-b.end||a.id-b.id;
 });
 const key=units.map(v=>v.id).join(',');
 if(reorder.key===key)return;
 const frag=document.createDocumentFragment(),ids=new Set();
 for(const v of units){
  ids.add(v.id);
  let card=cards.get(v.id);
  if(!card){card=v.kind==='route'?makeRouteCard(v):makeUnitCard(v);cards.set(v.id,card);}
  frag.appendChild(card.card);
 }
 for(const id of cards.keys())if(!ids.has(id)){cards.delete(id);routeRows.delete(id);}
 ui.list.replaceChildren(frag);reorder.key=key;
}
function unitPresentation(v,now){
 const left=Math.max(0,v.end-now);
 const states={taxi:{road:'운행 중',wait:'대기 중'},truck:{load:'상차 중',road:'운송 중',unload:'하역 중',wait:'대기 중'},
  domestic:{atc:'관제 중',flight:'비행 중',wait:'대기 중'},international:{atc:'관제 중',flight:'비행 중',wait:'대기 중'},
  ship:{sailing:'운항 중'}};
 const road=v.phase==='road',status=states[v.kind][v.phase]||'운행 중';
 const rem=road?Math.max(0,v.distance-distanceSince(v.seed,v.start,now)):0;
 const value=road?km(rem):(v.phase==='wait'?'대기 ':'')+countdown(left);
 const progress=road?(1-rem/v.distance):(now-v.start)/Math.max(1,v.end-v.start);
 return {status,value,progress:Math.max(0,Math.min(1,progress))};
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
  const p=unitPresentation(v,now);
  slot.status.textContent=p.status;slot.status.classList.toggle('waiting',v.phase==='wait');
  slot.left.textContent=p.value;slot.right.textContent=v.completed+'회';
  slot.bar.style.width=(p.progress*100).toFixed(2)+'%';
 }
 ui.supply.textContent=state.units.length>=MAX?'100대 · 공급 대기':
  state.pending?'대기 차량 등장 예정':countdown(state.nextSupplyAt-now);
}
function tick(){
 const now=Math.floor(Date.now()/1000);
 if(ready){advance(now);if(dirty&&(now-lastSave>=20))save(now);}
 draw(now);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{if(ready&&dirty)save(Math.floor(Date.now()/1000));});
(async()=>{
 const now=Math.floor(Date.now()/1000);
 let saved=null,old=null,legacy=null;
 try{
  saved=await read(KEY);
  if(!validWorld(saved)){old=await read(PREV);if(!old)legacy=await read(LEGACY);}
 }catch(e){console.error('MYON load:',e);}
 if(validWorld(saved))state=saved;
 else{state=migrate(old,legacy,now);dirty=true;}
 ready=true;
 tick();
 if(dirty)save(now);
 setInterval(tick,1000);
})();
})();