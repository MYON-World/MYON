// MYON v0.13.41 — taxi/truck world switching, persistent contracts and level growth.
// Supply attempts every clock hour after any pre-existing countdown; missions retain normal completion.
(function () {
'use strict';
const DB='myon-v00804-progress',STORE='game',KEY='v01302-world',OLD_VEHICLES='v01204-world',OLD_CONSTRUCTION='v01300-construction';
const ASSISTANT_KEY='v01313-assistant',PROGRESSION_KEY='v01315-progression',MENU_KEY='v01317-bottom-nav'; // Original saves unchanged.
const PROFILE_KEY='v01319-player-profile',PREF_KEY='v01319-play-style',FINANCE_KEY='v01322-common-funds',TAXI_OFFERS_KEY='v01323-taxi-offers',LEDGER_KEY='v01324-finance-ledger',OWNED_KEY='v01325-owned-vehicles',TAXI_LEVEL_KEY='v01337-taxi-level',WORLD_KEY='v01341-world-switch',TRUCK_GARAGE_KEY='v01341-truck-garage',TRUCK_OFFERS_KEY='v01341-truck-offers';
// Only the official main path can read or write the player save.
const IS_LIVE=!/(?:^|\/)(?:test|dev)(?:\/|$)/.test(location.pathname);
const HOUR=3600,DAY=86400,WEEK=7*DAY,KST=9*HOUR,MAX=30,MAX_TOTAL=130,LOOKBACK=2*DAY,TAXI_OFFER_INTERVAL=300,TAXI_AUTO_INTERVAL=600;
const $=id=>document.getElementById(id);
const ui={list:$('slot-list'),date:$('clock-date'),clock:$('clock-time'),gear:$('top-settings-toggle'),version:$('home-version'),worldName:$('current-world-name'),settings:$('settings-panel'),notify:$('notification-toggle')};
const nav={home:$('home-screen'),character:$('character-screen'),world:$('world-screen')};
const assistantContainer=$('assistant-slot');
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const weekdayFmt=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',weekday:'short'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const pad=n=>String(Math.max(0,Math.floor(n))).padStart(2,'0');
const hms=n=>pad(n/3600)+':'+pad((n%3600)/60)+':'+pad(n%60);
// The next HH:00:00, shared by UTC and KST (UTC+9h).
const nextClockHour=at=>Math.floor(at/HOUR)*HOUR+HOUR;
const countdown=n=>{n=Math.max(0,Math.ceil(n));return n>=DAY?Math.floor(n/DAY)+'일 '+pad((n%DAY)/HOUR)+':'+pad((n%HOUR)/60):n>2*HOUR?pad(n/HOUR)+':'+pad((n%HOUR)/60):hms(n);};
const km=n=>(Math.max(0,n)/1000).toLocaleString('ko-KR',{maximumFractionDigits:2,minimumFractionDigits:2})+'km';
const seedNow=()=>((Math.random()*4294967296)>>>0)||1;
function mix(n){n=(n^(n>>>16))>>>0;n=Math.imul(n,0x7feb352d)>>>0;n=(n^(n>>>15))>>>0;n=Math.imul(n,0x846ca68b)>>>0;return (n^(n>>>16))>>>0;}
const range=(seed,index,min,max)=>min+(mix((seed+Math.imul((index+1)>>>0,0x9e3779b9))>>>0)%(max-min+1));
const routeTypes=[
 {key:'village',name:'마을버스',icon:'🚌',mode:'bus',stops:20,min:350,max:850,dwell:90,note:'정류장 20개'},
 {key:'city',name:'시내버스',icon:'🚌',mode:'bus',stops:40,min:600,max:1400,dwell:90,note:'정류장 40개'},
 {key:'express',name:'광역버스',icon:'🚌',mode:'bus',stops:10,min:450,max:1100,dwell:90,highway:true,note:'정류장 10개 · 고속도로 2시간'},
 {key:'nightExpress',name:'심야광역버스',icon:'🚌',mode:'bus',night:true,stops:10,min:450,max:1100,dwell:90,highway:true,note:'정류장 10개 · 심야운행'},
 {key:'demandMorning',name:'수요대응 광역버스 출근용',icon:'🚌',mode:'bus',demand:'morning',stops:10,min:450,max:1100,dwell:90,highway:true,note:'상행 06:00~08:00 · 30분 배차'},
 {key:'demandEvening',name:'수요대응 광역버스 퇴근용',icon:'🚌',mode:'bus',demand:'evening',stops:10,min:450,max:1100,dwell:90,highway:true,note:'상행 회송 후 하행 18:00~20:00 · 30분 배차'},
 {key:'demandFull',name:'수요대응 광역버스 전구간용',icon:'🚌',mode:'bus',demand:'full',stops:10,min:450,max:1100,dwell:90,highway:true,note:'광역 왕복 · 30분 배차'},
 {key:'demandCharter',name:'수요대응 전세버스',icon:'🚌',mode:'bus',demand:'charter',stops:10,min:450,max:1100,dwell:90,highway:true,note:'출퇴근 시간대 선택 · 1회 운행'},
 {key:'tram',name:'트램',icon:'🚊',mode:'rail',stops:20,min:350,max:850,dwell:90,note:'정류장 20개 · 임시 이동 기준'},
 {key:'subway',name:'지하철',icon:'🚇',mode:'rail',stops:100,leg:180,dwell:60,note:'100개 역 · 이동 3분 · 정차 1분'},
 {key:'subwayExpress',name:'지하철급행',icon:'🚇',mode:'rail',expressRail:true,stops:100,leg:180,dwell:60,note:'100개 역 · 5역 간격 정차 · 05:00~22:00'},
 {key:'nightSubway',name:'심야지하철',icon:'🚇',mode:'rail',night:true,stops:100,leg:180,dwell:60,note:'100개 역 · 심야운행'},
 {key:'regional',name:'일반열차',icon:'🚆',mode:'rail',stops:10,leg:1800,dwell:60,note:'10개 역 · 이동 30분 · 정차 1분'},
 {key:'highspeed',name:'고속열차',icon:'🚄',mode:'rail',stops:5,leg:3600,dwell:60,note:'5개 역 · 이동 1시간 · 정차 1분'}
];
const specs=new Map(routeTypes.map(r=>[r.key,r]));
// The third demand-bus variant selects just one peak, deterministically
// per mission, so reloading a save cannot change morning into evening.
function demandShift(spec,seed){
 return spec.demand==='full'||spec.demand==='charter'?
  (range(seed,31,0,1)===0?'morning':'evening'):spec.demand;
}
function charterSlot(seed){
 return range(seed,32,0,4); // One of five half-hour rush-hour departures.
}
const modes=['taxi','truck','bus','rail','air','ship','space','construction'];
const SECTOR_NAMES=['택시','화물','버스','철도','항공','해양','우주','건설'];
// Capacity blueprint only: owned-vehicle inventory and improved missions are not yet implemented.
const INVOLVED_MAX_MISSIONS=100,MAX_OWNED_VEHICLES=50;
function involvementAllocation(ownedVehicles){
 const vehicle=Math.max(0,Math.min(MAX_OWNED_VEHICLES,Number.isSafeInteger(ownedVehicles)?ownedVehicles:0));
 return {total:INVOLVED_MAX_MISSIONS,vehicle,withoutVehicle:INVOLVED_MAX_MISSIONS-vehicle};
}
const unitNames={taxi:'택시',truck:'화물차',domestic:'국내선',international:'국제선',ship:'선박',space:'우주임무'};
const unitIcons={taxi:'🚕',truck:'🚚',domestic:'✈️',international:'✈️',ship:'🚢',space:'🚀'};
function kstMidnight(t){return Math.floor((t+KST)/DAY)*DAY-KST;}
function dayOfWeek(midnight){return new Date((midnight+KST)*1000).getUTCDay();}
function mondayStart(t){const m=kstMidnight(t);return m-((dayOfWeek(m)+6)%7)*DAY;}
function weekend(midnight){const d=dayOfWeek(midnight);return d===0||d===6;}
function intervalFor(route,originMidnight,offset){
 if(route.expressRail)return HOUR; // 05:00–22:00, weekdays and weekends.
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
  if(spec.expressRail){
   // Exactly 18 hourly departures, from 05:00 through 22:00 (KST),
   // independent of weekday/weekend and of other subway services.
   for(let hour=5;hour<=22;hour++){
    const at=day+hour*HOUR;
    if(at>=from&&at<=to&&at>=route.acquired&&at<cutoff)result.push(at);
   }
   continue;
  }
  if(spec.demand){
   // Scheduled demand buses run five half-hour departures; charter
   // demand dispatches ONE bus at a deterministic time within one peak.
   const firstHour=demandShift(spec,route.seed)==='morning'?6:18;
   const charter=spec.demand==='charter';
   for(let i=charter?charterSlot(route.seed):0;i<=(charter?charterSlot(route.seed):4);i++){
    const at=day+firstHour*HOUR+i*1800;
    if(at>=from&&at<=to&&at>=route.acquired&&at<cutoff)result.push(at);
   }
   continue;
  }
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
// Construction equipment uses an explicit MYON game assumption of 20km/h for transit;
// outbound site travel is randomly 30 minutes to 8 hours. Return time follows distance.
const CONSTRUCTION_TRAVEL_METERS_PER_HOUR=20000;
const constructionTiers=[
 {weight:6500,min:5,max:50},     // 0.5–5km 65%
 {weight:2500,min:51,max:200},   // 5.1–20km 25%
 {weight:900,min:201,max:1000},  // 20.1–100km 9%
 {weight:90,min:1001,max:5000},  // 100.1–500km 0.9%
 {weight:10,min:5001,max:10000}  // 500.1–1000km 0.1%
];
let state=null,assistant=null,progression=null,releaseManifest=null,dbPromise=null,ready=false,lastSave=0,saveChain=Promise.resolve(),dirty=false;
let progressionDirty=false,progressionLastSave=0,progressionSaveChain=Promise.resolve();
let menuStudy=null,menuDirty=false,menuLastSave=0,menuSaveChain=Promise.resolve();
let profile=null,preferences=null,resetBusy=false,commonFunds=null,taxiOffers=null,financeLedger=null,offersDirty=false,taxiLevel=null,worldProgress=null,truckGarage=null,truckOffers=null,worldSwitchBusy=false,worldSwitchTarget=null,assetSalePending=null;
let profileSaveChain=Promise.resolve();
const cards=new Map(),offerCards=new Map(),waitingVehicleCards=new Map(),tripCache=new Map(),routeRows=new Map(),routeEndCache=new Map();
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
// Passenger fare: 0.48 M for the first 1.6km, then 0.01 M per started 131m.
// Distances are meters and money uses integral smallest units (1 M = 10,000 units).
function taxiFareUnits(distanceMeters){
 return 4800+Math.ceil(Math.max(0,distanceMeters-1600)/131)*100;
}
function taxiOutsourceShare(fareUnits){return fareUnits*40/100;}
// Level is unbounded; one completed taxi job earns one record after the initial legacy snapshot.
function levelNumber(){return taxiLevel?Math.floor(taxiLevel.completed/100)+1:1;}
function activeWorld(){return worldProgress?.active||'taxi';}
function currentWorldLevel(){return activeWorld()==='taxi'?levelNumber():truckLevelNumber();}
// A single cycle table drives actual earnings, city grants, max trip distance,
// the next-level reward and the expanded level preview. Revenue grows every
// level from LV.49 onward; distance tops out at LV.48 (200 km).
const TAXI_LEVEL_RULES={
 base:{revenue:40,distanceKm:20,cityCars:0},
 steps:{revenue:1,distanceKm:10,cityCars:1},
 caps:{distanceKm:200,cityCars:10},
 previewLastLevel:48,
 milestones:{2:'auto',3:'city'},
 phases:[
  {from:4,to:30,cycle:['revenue','distance','city']},
  {from:31,to:48,cycle:['revenue','distance']},
  {from:49,to:Infinity,cycle:['revenue']}
 ]
};
function taxiRewardType(level){
 if(TAXI_LEVEL_RULES.milestones[level])return TAXI_LEVEL_RULES.milestones[level];
 const phase=TAXI_LEVEL_RULES.phases.find(p=>level>=p.from&&level<=p.to);
 return phase?phase.cycle[(level-phase.from)%phase.cycle.length]:null;
}
// Count all occurrences without looping over level history or constructing a
// potentially unbounded array (the level can keep rising indefinitely).
function taxiRewardCount(type,level){
 let count=type==='city'&&level>=3?1:0;
 for(const phase of TAXI_LEVEL_RULES.phases){
  const steps=Math.max(0,Math.min(level,phase.to)-phase.from+1);
  if(!steps)continue;
  const repeats=Math.floor(steps/phase.cycle.length);
  count+=repeats*phase.cycle.filter(v=>v===type).length;
  for(let i=0;i<steps%phase.cycle.length;i++)if(phase.cycle[i]===type)count++;
 }
 return count;
}
function cityEntitlement(l=levelNumber()){
 const rules=TAXI_LEVEL_RULES;
 return Math.min(rules.caps.cityCars,rules.base.cityCars+rules.steps.cityCars*taxiRewardCount('city',l));
}
function levelMaxKm(l=levelNumber()){
 const rules=TAXI_LEVEL_RULES;
 return Math.min(rules.caps.distanceKm,rules.base.distanceKm+rules.steps.distanceKm*taxiRewardCount('distance',l));
}
function levelRevenue(l=levelNumber()){
 const rules=TAXI_LEVEL_RULES;
 return rules.base.revenue+rules.steps.revenue*taxiRewardCount('revenue',l);
}
function levelRateText(l=levelNumber()){
 const n=levelRevenue(l);
 return n<=100?'수익률 '+n+'%':'수익률 100% · 보너스 +'+(n-100)+'%';
}
function levelNextReward(l=levelNumber()){
 const n=l+1,type=taxiRewardType(n);
 if(type==='auto')return '10분마다 남은 외주 임무 자동수락 · 폐기 없음';
 if(type==='city')return n===3?'시지원 차량 1대 · 운행거리 최대 '+levelMaxKm(n)+'km':
  '시지원 차량 +1대 → 총 '+cityEntitlement(n)+'대';
 if(type==='distance')return '장거리 최대 '+levelMaxKm(n)+'km';
 if(type==='revenue'){
  const rate=levelRevenue(n);
  return '차량 수익률 +1%p → '+(rate<=100?rate+'%':'100% + 보너스 '+(rate-100)+'%');
 }
 return '다음 보상 준비 중';
}
function drawTaxiLevel(){
 if(activeWorld()==='truck'){drawTruckLevel();return;}
 if(!taxiLevel)return;
 $('world-level-label').textContent='택시 운영 레벨';
 const n=taxiLevel.completed%100,l=levelNumber();
 $('taxi-level').textContent='LV.'+l.toLocaleString('ko-KR');
 $('taxi-next-remaining').textContent=(100-n)+'건';
 $('taxi-level-progress').style.width=n+'%';
 $('taxi-level-count').textContent='누적 완료 '+taxiLevel.completed.toLocaleString('ko-KR')+'건';
 $('taxi-level-current').textContent=ownedGarage?.vehicles.length?levelRateText(l)+' · 최대 '+levelMaxKm(l)+'km':'외주 40% · 3~10km';
 $('taxi-next-reward').textContent=levelNextReward(l);
 const future=$('taxi-level-details');
 future.hidden=l>TAXI_LEVEL_RULES.previewLastLevel;
 if(future.hidden)future.open=false;
 renderTaxiFutureRewards();
 $('taxi-offer-rule').textContent=l>=2?
  '외주 임무 5분마다 등장 · 수동 수락 가능 · 10분마다 자동수락 · 폐기 없음':
  '외주 임무 5분마다 등장 · 수동 수락 · 미수락 시 1시간 뒤 폐기';
}
// Only finite LV.48 milestone rewards appear in the drop-down. Beyond that,
// one immutable explanation summarizes the unlimited +1%p revenue cycle.
function renderTaxiFutureRewards(){
 const details=$('taxi-level-details');
 if(!details||!details.open||details.hidden)return;
 const level=currentWorldLevel(),world=activeWorld();
 if(renderTaxiFutureRewards.key===world+':'+level)return;
 const list=$('taxi-level-future-list'),fragment=document.createDocumentFragment();
 const last=world==='taxi'?TAXI_LEVEL_RULES.previewLastLevel:Math.max(100,level+25);
 for(let n=level+2;n<=last;n++){
  const row=element('div','taxi-level-future-row');
  row.append(element('span','','LV.'+n.toLocaleString('ko-KR')),
   element('strong','',world==='taxi'?levelNextReward(n-1):truckNextReward(n-1)));
  fragment.append(row);
 }
 list.replaceChildren(fragment);
 renderTaxiFutureRewards.key=world+':'+level;
}
function initTaxiFutureUi(){
 $('taxi-level-details').addEventListener('toggle',renderTaxiFutureRewards);
}
initTaxiFutureUi();
async function startTaxiLevel(){
 if(!IS_LIVE){taxiLevel={schema:1,completed:assistantCompleted()};return;}
 try{
  const saved=await read(TAXI_LEVEL_KEY);
  if(saved){
   if(saved.schema===1&&Number.isSafeInteger(saved.completed)&&saved.completed>=0){taxiLevel=saved;return;}
   console.error('MYON level: invalid save preserved');return;
  }
 }catch(e){console.error('MYON level read:',e);}
 taxiLevel={schema:1,completed:assistantCompleted()};dirty=true;
}
function purgeNonTaxiMissions(){
 if(!state||!assistant)return;
 const count=state.units.filter(v=>v.kind!=='taxi').length;
 if(!count)return;
 state.units=state.units.filter(v=>v.kind==='taxi');
 assistant.discardedCount=(assistant.discardedCount||0)+count;
 state.pending=false;dirty=true;
}

function createUnit(kind,at,old=null,offer=null){
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
 let taxiContract=null;
 if(kind==='taxi'){
  const distance=offer?offer.distanceMeters:range(seed,0,30,100)*100;
  // A migrated or already-running taxi keeps its legacy no-settlement rules.
  if(!old){
   const fareUnits=offer?offer.fareUnits:taxiFareUnits(distance);
   const shareUnits=offer?offer.shareUnits:taxiOutsourceShare(fareUnits);
   taxiContract={taxiContractVersion:1,passengerMeters:distance,fareUnits,shareUnits,
    dispatch:offer?'accepted':'automatic',contractType:'outsource'};
  }
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
 return {...base,kind,start:at,end:cursor,stages,...(taxiContract||{})};
}
function createRoute(at,old=null){
 const base=jobIdentity(at,old);
 const routeKey=old&&specs.has(old.routeKey)?old.routeKey:pick(routeTypes).key;
 const spec=specs.get(routeKey);
 // Start with today's first departure if it has not passed yet (KST).
 // Otherwise, schedule the following day's first departure.
 const today=kstMidnight(at);
 // Evening duties begin with an empty positioning trip at 15:00 so
 // every 18:00–20:00 downhill passenger departure can run on time.
 const selectedShift=spec.demand?demandShift(spec,base.seed):null;
 const departureHour=selectedShift==='morning'?6:selectedShift==='evening'?
  (spec.demand==='evening'||spec.demand==='charter'?15:18):spec.night?18:5;
 const firstDeparture=today+departureHour*HOUR+
  (spec.demand==='charter'?charterSlot(base.seed)*1800:0);
 const serviceDay=at<=firstDeparture?today:today+DAY;
 return {...base,kind:'route',routeKey,serviceDay,cutoff:serviceDay+DAY+(spec.night?8*HOUR:0)};
}
function constructionTravelSeconds(meters){
 return Math.ceil(meters*HOUR/CONSTRUCTION_TRAVEL_METERS_PER_HOUR);
}
function scheduleConstruction(v,legacy=false){
 // The construction job's deterministic seed fixes its movement and rail type
 // across refreshes and offline replay without advancing the world's supply RNG.
 const travelSeconds=range(v.seed,19,1,16)*1800; // 30min–8h, 30min steps
 const travelMeters=travelSeconds*CONSTRUCTION_TRAVEL_METERS_PER_HOUR/HOUR;
 const tracks=v.constructionKey==='newRail'?(legacy?1:range(v.seed,20,1,2)):1;
 // Legacy work began at v.start and must not be reset by an upgrade.
 const workStart=legacy?v.start:v.start+travelSeconds;
 const workEnd=legacy?v.end:workStart+Math.ceil(v.targetMeters*DAY/v.dailyMeters);
 const dispatchStart=workStart-travelSeconds;
 let cursor=workEnd;
 const stages=[
  {phase:'travel-out',start:dispatchStart,end:workStart,distance:travelMeters},
  {phase:'work-out',start:workStart,end:workEnd,distance:v.targetMeters}
 ];
 if(tracks===2){
  // The return track is constructed while the equipment travels back along
  // the same section, then the vehicle drives its original approach route.
  const returnWorkEnd=cursor+(workEnd-workStart);
  stages.push({phase:'work-return',start:cursor,end:returnWorkEnd,distance:v.targetMeters});
  cursor=returnWorkEnd;
  stages.push({phase:'travel-return',start:cursor,end:cursor+travelSeconds,distance:travelMeters});
  cursor+=travelSeconds;
 }else{
  // A single track (and repair job) must drive all the way back from the far
  // end of the finished work section, including its original approach route.
  const returnDistance=v.targetMeters+travelMeters;
  const end=cursor+constructionTravelSeconds(returnDistance);
  stages.push({phase:'travel-return',start:cursor,end,distance:returnDistance});
  cursor=end;
 }
 v.trackCount=tracks;
 v.travelMeters=travelMeters;
 v.stages=stages;
 v.start=dispatchStart;
 v.end=cursor;
 return v;
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
 return scheduleConstruction({...base,kind:'construction',constructionKey:spec.key,targetMeters,dailyMeters,start,
  end:start+Math.ceil(targetMeters*DAY/dailyMeters)},Boolean(old&&Number.isSafeInteger(old.startedAt)));
}
function itinerary(route,depart){
 const key=route.id+':'+depart;
 if(tripCache.has(key))return tripCache.get(key);
 const spec=specs.get(route.routeKey),stages=[];
 // Stops 1 and 100 are mandatory terminals; all intermediate express
 // stops are multiples of five: 5,10,15,...,95. The SAME set applies
 // on the return. Existing regular/night subway stops stay unchanged.
 const expressStop=n=>n===1||n===spec.stops||n%5===0;
 if(spec.demand){
  // Passenger timetable: 06:00..08:00 uphill or 18:00..20:00
  // downhill. The full-route variant randomly selects one peak
  // and serves all ten stops in BOTH directions.
  // Each dispatched vehicle draws one 1h/2h highway duration and
  // reuses it in the opposite direction or empty repositioning.
  const highwayHours=range(mix((route.seed^depart)>>>0),17,1,2);
  const highwaySeconds=highwayHours*HOUR;
  const shift=demandShift(spec,route.seed);
  const reposition=shift==='evening'&&spec.demand!=='full'?3*HOUR:0;
  let offset=-reposition,stop=1,legIndex=0;
  const push=(phase,from,to,length,service)=>{
   offset+=length;
   stages.push({end:offset,phase,from,to,service});
   stop=to;
  };
  const passenger=(direction,service)=>{
   for(let i=0;i<spec.stops-1;i++,legIndex++){
    const next=stop+direction;
    const highway=(stop===5&&next===6)||(stop===6&&next===5);
    let length;
    if(highway)length=highwaySeconds;
    else{
     const legSeed=mix((route.seed^depart^Math.imul(legIndex+1,0x9e3779b9))>>>0);
     const meters=range(legSeed,0,spec.min,spec.max);
     length=roadEnd(legSeed,depart+offset,meters)-(depart+offset);
    }
    push(highway?'highway':'travel',stop,next,length,service);
    if(stop!==1){
     offset+=spec.dwell;
     stages.push({end:offset,phase:'stop',stop,service});
    }
   }
  };
  const emptyPosition=()=>{
   // Empty bus: departure area 5 stops collapsed into a 30-minute
   // uninterrupted relocation; highway; destination area 30 minutes.
   push('travel',1,5,1800,'position');
   push('highway',5,6,highwaySeconds,'position');
   push('travel',6,10,1800,'position');
  };
  const emptyReturn=()=>{
   // Morning bus: after passengers reach stop 10, drive back with
   // no boarding/station dwell (30m + same highway + 30m).
   push('travel',10,6,1800,'return');
   push('highway',6,5,highwaySeconds,'return');
   push('travel',5,1,1800,'return');
  };
  if(shift==='evening'&&spec.demand!=='full'){
   emptyPosition();
   if(offset>0)throw new Error('Demand bus misses its downhill start');
   // With a 1-hour highway the bus waits 1 hour; with 2 hours it
   // reaches the departure terminus just in time.
   if(offset<0)stages.push({end:0,phase:'layover',stop:10,service:'position'});
   offset=0;
   passenger(-1,'down');
  }else if(shift==='morning'&&spec.demand!=='full'){
   passenger(1,'up');
   emptyReturn();
  }else{
   passenger(1,'up');
   passenger(-1,'down');
  }
  const result={total:offset,startOffset:-reposition,highwayHours,stages};
  if(tripCache.size>6000)tripCache.clear();
  tripCache.set(key,result);
  return result;
 }
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
  if(spec.expressRail?expressStop(stop):stop!==1){
   offset+=spec.dwell;stages.push({end:offset,phase:'stop',stop});
  }
 }
 const result={total:offset,stages};
 if(tripCache.size>6000)tripCache.clear();
 tripCache.set(key,result);
 return result;
}
function activeTrips(route,now){
 const spec=specs.get(route.routeKey);
 const lead=(spec.demand==='evening'||spec.demand==='charter'&&demandShift(spec,route.seed)==='evening')?3*HOUR:0;
 const times=departuresBetween(route,Math.max(route.acquired,now-LOOKBACK),now+lead),active=[];
 for(const dep of times){
  const plan=itinerary(route,dep);
  const elapsed=now-dep;
  if(elapsed<(plan.startOffset||0)||elapsed>=plan.total)continue;
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
 // Rush-hour demand contracts end immediately after their final bus
 // returns; ordinary routes preserve their existing timetable cutoff.
 let end=specs.get(route.routeKey).demand?route.serviceDay:route.cutoff;
 for(const dep of departures)end=Math.max(end,dep+itinerary(route,dep).total);
 if(routeEndCache.size>500)routeEndCache.clear();
 routeEndCache.set(key,end);
 return end;
}
function taskEnd(v){return v.kind==='route'?routeEnd(v):v.end;}
function availableModes(){
 return modes.filter(m=>m!=='bus'&&m!=='rail'||routeTypes.some(s=>s.mode===m&&!state.units.some(v=>v.kind==='route'&&v.routeKey===s.key)));
}
function missionMode(v){
 return v.kind==='route'?specs.get(v.routeKey).mode:
  v.kind==='domestic'||v.kind==='international'?'air':
  v.kind==='construction'?'construction':v.kind;
}
// Automatic observer mission supply is retired in v0.13.35.
// Do not reinterpret or rewrite old play-style saves: existing jobs still finish.
// New mission-board offers are only manually accepted outsource taxi rides.
function allowsAcceptedMissions(){return true;}
function advance(now){
 if(!ready)return;
 // Pending hourly automatic assignments are cancelled, never existing jobs.
 if(state.pending){state.pending=false;dirty=true;}
 // Keep this saved timestamp valid for compatibility without spawning jobs.
 if(state.nextSupplyAt<=now){state.nextSupplyAt=nextClockHour(now);dirty=true;}
 // Retire saved jobs by their original completion timestamp, including offline
 // work. In particular, company-owned taxis and accepted taxi contracts still pay.
 const retiring=state.units.filter(v=>(v.kind==='taxi'||(v.kind==='truck'&&v.truckContractVersion===1))&&taskEnd(v)<=now)
  .sort((a,b)=>taskEnd(a)-taskEnd(b)||a.id-b.id);
 if(!retiring.length)return;
 for(const v of retiring){
  const at=taskEnd(v);
  if(v.kind==='taxi'&&[2,3].includes(v.taxiContractVersion)&&v.contractType==='owned')finishOwnedTrip(v,at);
  if(v.kind==='taxi'&&v.taxiContractVersion===1&&v.contractType==='outsource'&&
     Number.isSafeInteger(v.shareUnits)&&v.shareUnits>0&&commonFunds){
   const newBalance=commonFunds.balance+v.shareUnits;
   if(Number.isSafeInteger(newBalance)&&(!financeLedger||Number.isSafeInteger(financeLedger.totalIncome+v.shareUnits))){
    commonFunds.balance=newBalance;
    recordTaxiSettlement(v,at);
   }
  }
  if(v.kind==='taxi'&&v.contractType==='owned'&&v.vehicleId){
   const car=vehicleById(v.vehicleId);
   if(car&&car.origin==='city'&&car.recallAfterMission&&!car.activeMissionId){ownedGarage.vehicles=ownedGarage.vehicles.filter(x=>x.id!==car.id);dirty=true;}
  }
  if(v.kind==='truck'&&v.truckContractVersion===1)finishTruckTrip(v,at);
  if(v.kind==='taxi'&&activeWorld()==='taxi'&&v.worldCycle===worldProgress.cycles.taxi&&taxiLevel&&taxiLevel.completed<Number.MAX_SAFE_INTEGER)taxiLevel.completed++;
  if(v.kind==='truck'&&v.truckContractVersion===1&&activeWorld()==='truck'&&v.worldCycle===worldProgress.cycles.truck&&truckGarage.completed<Number.MAX_SAFE_INTEGER)truckGarage.completed++;
 }
 state.units=state.units.filter(v=>taskEnd(v)>now);
 dirty=true;
}

// Offers are real-time KST ten-minute slots. UTC epoch works because KST
// has a whole-hour offset; the seed never consumes the world mission RNG.
// Outsource supply and auto-accept use independent wall-clock slots.
function nextFiveMinute(at){return Math.floor(at/TAXI_OFFER_INTERVAL)*TAXI_OFFER_INTERVAL+TAXI_OFFER_INTERVAL;}
function nextTenMinute(at){return Math.floor(at/TAXI_AUTO_INTERVAL)*TAXI_AUTO_INTERVAL+TAXI_AUTO_INTERVAL;}
function newTaxiOffers(now){return {schema:1,seed:seedNow(),nextOfferAt:nextFiveMinute(now),
 nextAutoAt:nextTenMinute(now),offers:[]};}
function validTaxiOffers(value){
 return Boolean(value&&value.schema===1&&Number.isInteger(value.seed)&&
  Number.isSafeInteger(value.nextOfferAt)&&value.nextOfferAt>0&&
  (value.nextAutoAt===undefined||(Number.isSafeInteger(value.nextAutoAt)&&value.nextAutoAt>0))&&
  Array.isArray(value.offers)&&value.offers.length<=5000&&value.offers.every(o=>
   o&&Number.isSafeInteger(o.at)&&o.at>0&&o.at%TAXI_OFFER_INTERVAL===0&&
   o.expiresAt===o.at+HOUR&&Number.isSafeInteger(o.distanceMeters)&&
   o.distanceMeters>=3000&&o.distanceMeters<=10000&&o.distanceMeters%100===0&&
   Number.isSafeInteger(o.fareUnits)&&o.fareUnits>=4800&&
   Number.isSafeInteger(o.shareUnits)&&o.shareUnits>=0));
}
async function startTaxiOffers(now){
 taxiOffers=newTaxiOffers(now);
 if(!IS_LIVE)return;
 try{
  const saved=await read(TAXI_OFFERS_KEY);
  if(validTaxiOffers(saved)){
   taxiOffers=saved;
   // Keep old ten-minute offers and fill the intervening five-minute slot.
   const upcoming=nextFiveMinute(now);
   if(saved.nextOfferAt>upcoming){saved.nextOfferAt=upcoming;offersDirty=true;}
   if(!saved.nextAutoAt){saved.nextAutoAt=nextTenMinute(now);offersDirty=true;}
   return;
  }
  offersDirty=true;
 }catch(error){console.error('MYON taxi offers:',error);offersDirty=true;}
}
function advanceTaxiOffers(now){
 if(activeWorld()!=='taxi'||!taxiOffers)return;
 const previous=taxiOffers.offers.length;
 if(levelNumber()<2)taxiOffers.offers=taxiOffers.offers.filter(o=>now<o.expiresAt);
 if(previous!==taxiOffers.offers.length)offersDirty=true;
 if(now<taxiOffers.nextOfferAt)return;
 const first=Math.max(taxiOffers.nextOfferAt,nextFiveMinute(now-HOUR));
 for(let at=first;at<=now;at+=TAXI_OFFER_INTERVAL){
  const seed=mix((taxiOffers.seed^Math.imul(Math.floor(at/TAXI_OFFER_INTERVAL),0x9e3779b9))>>>0);
  const distanceMeters=range(seed,0,30,100)*100;
  const fareUnits=taxiFareUnits(distanceMeters);
  if(taxiOffers.offers.length<5000)taxiOffers.offers.push({at,expiresAt:at+HOUR,distanceMeters,fareUnits,
   shareUnits:taxiOutsourceShare(fareUnits)});
 }
 taxiOffers.nextOfferAt=nextFiveMinute(now);
 offersDirty=true;
}
function autoAcceptTaxiOffers(now){
 if(activeWorld()!=='taxi'||!taxiOffers)return;
 if(!Number.isSafeInteger(taxiOffers.nextAutoAt)||taxiOffers.nextAutoAt<=0){
  taxiOffers.nextAutoAt=nextTenMinute(now);offersDirty=true;return;
 }
 if(now<taxiOffers.nextAutoAt)return;
 taxiOffers.nextAutoAt=nextTenMinute(now);offersDirty=true;
 if(levelNumber()<2)return;
 let changed=false;
 // Auto-accept already waiting offers BEFORE generating the new supply.
 for(const offer of taxiOffers.offers.slice().sort((a,b)=>a.at-b.at)){
  if(state.units.length>=MAX_TOTAL||ownedActiveCount()>=INVOLVED_MAX_MISSIONS)break;
  const job=createUnit('taxi',now,null,offer);job.worldCycle=worldProgress.cycles.taxi;
  state.units.push(job);
  taxiOffers.offers=taxiOffers.offers.filter(o=>o.at!==offer.at);
  changed=true;
 }
 if(changed){dirty=true;offersDirty=true;}
}
async function acceptTaxiOffer(at){
 if(activeWorld()!=='taxi'||!ready||resetBusy||!taxiOffers||!allowsAcceptedMissions())return;
 const now=Math.floor(Date.now()/1000);
 advance(now);advanceTaxiOffers(now);
 const offer=taxiOffers.offers.find(v=>v.at===at);
 if(!offer||(levelNumber()<2&&now>=offer.expiresAt)||state.units.length>=MAX_TOTAL||ownedActiveCount()>=INVOLVED_MAX_MISSIONS){draw(now);return;}
 const job=createUnit('taxi',now,null,offer);job.worldCycle=worldProgress.cycles.taxi;
 state.units.push(job);
 taxiOffers.offers=taxiOffers.offers.filter(v=>v.at!==at);
 dirty=true;offersDirty=true;
 draw(now);
 await save(now);
}
function renderTaxiOffers(now){
 if(activeWorld()!=='taxi')return;
 const holder=$('taxi-offer-list'),empty=$('taxi-offer-empty');
 if(!holder||!empty||!taxiOffers)return;
 const list=allowsAcceptedMissions()?taxiOffers.offers.slice().sort((a,b)=>b.at-a.at):[];
 const order=list.map(x=>x.at).join(',')+':'+(levelNumber()>=2?'auto':'manual');
 if(renderTaxiOffers.order!==order){
  const nodes=document.createDocumentFragment(),keep=new Set();
  for(const offer of list){
   keep.add(offer.at);
   let slot=offerCards.get(offer.at);
   if(!slot){
    const card=element('article','slot taxi-offer');
    const head=element('div','slot-head'),name=element('div','slot-name');
    name.append(element('span','slot-icon','🚕'),element('strong','','MYON 택시'));
    const amount=element('strong','taxi-offer-amount',formatCommonFunds(offer.shareUnits));
    head.append(name,amount);
    const details=element('div','slot-details'),description=element('span','taxi-offer-description',
     (offer.distanceMeters/1000).toFixed(1)+'km · 외주 40%');
    const accept=element('button','slot-button','수락');accept.type='button';
    accept.addEventListener('click',()=>acceptTaxiOffer(offer.at));
    details.append(description,accept);
    const progress=element('div','slot-progress');progress.hidden=levelNumber()>=2;
    // Smooth, wall-clock-aligned animation; elapsed time is deliberately not displayed.
    progress.style.animation='taxi-offer-expiry '+HOUR+'s linear both';
    progress.style.animationDelay='-'+Math.max(0,Date.now()/1000-offer.at)+'s';
    card.append(head,details,progress);
    slot={card,accept};offerCards.set(offer.at,slot);
   }
   const bar=slot.card.querySelector('.slot-progress');if(bar)bar.hidden=levelNumber()>=2;
   nodes.appendChild(slot.card);
  }
  holder.replaceChildren(nodes);
  for(const key of offerCards.keys())if(!keep.has(key))offerCards.delete(key);
  renderTaxiOffers.order=order;
 }
 empty.hidden=list.length>0;
 for(const offer of list)offerCards.get(offer.at).accept.disabled=!allowsAcceptedMissions()||state.units.length>=MAX_TOTAL||ownedActiveCount()>=INVOLVED_MAX_MISSIONS;
}
function validWorld(s){
 return s&&s.schema===2&&Array.isArray(s.units)&&s.units.length<=MAX_TOTAL&&
 Number.isSafeInteger(s.nextId)&&s.nextId>0&&Number.isSafeInteger(s.nextSupplyAt)&&s.nextSupplyAt>0&&
 Number.isInteger(s.rng)&&typeof s.pending==='boolean'&&s.units.every(v=>
 v&&Number.isSafeInteger(v.id)&&v.id>0&&Number.isSafeInteger(taskEnd(v))&&
 (v.kind==='route'?specs.has(v.routeKey)&&Number.isSafeInteger(v.serviceDay):
 v.kind==='construction'?constructionSpecs.some(e=>e.key===v.constructionKey)&&v.dailyMeters>0:
 Array.isArray(v.stages)&&v.stages.length>0));
}
function initial(now){
 state={schema:2,nextId:1,nextSupplyAt:nextClockHour(now),pending:false,rng:seedNow(),units:[]};
 return state;
}
function migrate(oldVehicles,oldConstruction,now){
 state={schema:2,nextId:1,nextSupplyAt:nextClockHour(now),pending:false,rng:oldVehicles&&Number.isInteger(oldVehicles.rng)?oldVehicles.rng:seedNow(),units:[]};
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
  // Keep an existing countdown when migrating earlier save formats.
   if(Number.isSafeInteger(oldVehicles.nextSupplyAt)&&oldVehicles.nextSupplyAt>now&&oldVehicles.nextSupplyAt<=now+HOUR)state.nextSupplyAt=oldVehicles.nextSupplyAt;
 }
 const legacy=oldConstruction&&oldConstruction.mission;
 if(legacy&&constructionSpecs.some(e=>e.key===legacy.kind)&&Number.isSafeInteger(legacy.startedAt)&&legacy.startedAt>0&&
 Number.isSafeInteger(legacy.targetMeters)&&legacy.targetMeters>0&&Number.isSafeInteger(legacy.dailyMeters)&&legacy.dailyMeters>0){
  const end=legacy.startedAt+Math.ceil(legacy.targetMeters*DAY/legacy.dailyMeters);
  if(end>now)state.units.push(createConstruction(now,{...legacy,id:null}));
 }
 // Historical missions may be empty; never seed a new automatic taxi.
 state.pending=false;
 return state;
}
function openDb(){
 if(!IS_LIVE)return Promise.reject(new Error('Save access disabled outside main'));
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
 if(!IS_LIVE||!ready)return;
 const snapshot=JSON.parse(JSON.stringify(state));
 const fundsSnapshot=commonFunds?JSON.parse(JSON.stringify(commonFunds)):null;
 const offersSnapshot=taxiOffers?JSON.parse(JSON.stringify(taxiOffers)):null;
 const ledgerSnapshot=financeLedger?JSON.parse(JSON.stringify(financeLedger)):null;
 const garageSnapshot=ownedGarage?JSON.parse(JSON.stringify(ownedGarage)):null;
 const levelSnapshot=taxiLevel?JSON.parse(JSON.stringify(taxiLevel)):null;
 const worldSnapshot=worldProgress?JSON.parse(JSON.stringify(worldProgress)):null;
 const truckGarageSnapshot=truckGarage?JSON.parse(JSON.stringify(truckGarage)):null;
 const truckOffersSnapshot=truckOffers?JSON.parse(JSON.stringify(truckOffers)):null;
 const assistantSnapshot=assistant?JSON.parse(JSON.stringify(assistant)):null;
 lastSave=now;dirty=false;offersDirty=false;
 saveChain=saveChain.catch(()=>{}).then(async()=>{
  const db=await openDb();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   const store=tx.objectStore(STORE);
   // Store mission retirement, credited balance, ledger and offers atomically.
   store.put(snapshot,KEY);
   if(fundsSnapshot)store.put(fundsSnapshot,FINANCE_KEY);
   if(offersSnapshot)store.put(offersSnapshot,TAXI_OFFERS_KEY);
   if(ledgerSnapshot)store.put(ledgerSnapshot,LEDGER_KEY);
   if(garageSnapshot)store.put(garageSnapshot,OWNED_KEY);
   if(levelSnapshot)store.put(levelSnapshot,TAXI_LEVEL_KEY);
   if(worldSnapshot)store.put(worldSnapshot,WORLD_KEY);
   if(truckGarageSnapshot)store.put(truckGarageSnapshot,TRUCK_GARAGE_KEY);
   if(truckOffersSnapshot)store.put(truckOffersSnapshot,TRUCK_OFFERS_KEY);
   if(assistantSnapshot)store.put(assistantSnapshot,ASSISTANT_KEY);
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||new Error('MYON world/finance/ledger/owned/offers write failed'));
  });
 }).catch(e=>{console.error('MYON save:',e);dirty=true;offersDirty=true;});
 return saveChain;
}


function newAssistant(now,firstVisit=false){
 // Fresh players see the current secretary immediately, without rewriting any previous records.
 return {schema:1,startedAt:firstVisit?now-DAY:now,baselineNextId:state.nextId,baselineActive:state.units.length,discardedCount:0};
}
function validAssistant(value){
 return value&&value.schema===1&&Number.isSafeInteger(value.startedAt)&&value.startedAt>0&&
  Number.isSafeInteger(value.baselineNextId)&&value.baselineNextId>0&&
  Number.isSafeInteger(value.baselineActive)&&value.baselineActive>=0&&
  value.startedAt<=Math.floor(Date.now()/1000)+60&&
  state.nextId>=value.baselineNextId&&
  state.units.length<=value.baselineActive+(state.nextId-value.baselineNextId)&&
   (value.discardedCount===undefined||(Number.isSafeInteger(value.discardedCount)&&value.discardedCount>=0));
}
async function startAssistant(now,firstVisit=false){
 // Load the current official world FIRST and replay its missed hours.
 // Every assistant tracks completed missions from now; only the display state skips the old wait.
 if(!IS_LIVE){assistant=newAssistant(now,firstVisit);return;}
 let restored=null;
 try{restored=await read(ASSISTANT_KEY);}catch(e){console.error('MYON assistant read:',e);}
 if(validAssistant(restored)){assistant=restored;return;}
 assistant=newAssistant(now,firstVisit);
 try{
  const db=await openDb();
  await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).put(assistant,ASSISTANT_KEY);
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||new Error('MYON assistant write failed'));
  });
 }catch(e){console.error('MYON assistant save:',e);}
}
function assistantCompleted(){
 if(!assistant)return 0;
 // Every mission creation increments nextId exactly once; replaying missed
 // hours also updates it. No world save field or simulation branch is changed.
 const monitored=assistant.baselineActive+state.nextId-assistant.baselineNextId;
 return Math.max(0,monitored-state.units.length-(assistant.discardedCount||0));
}


// Assistant-gated research is kept separate from the immutable 23-type world engine.
// Offers use a separate seeded stream, so they never consume world RNG or real mission slots.
const RESEARCH=[
 {title:'비서전환',duration:HOUR,remaining:'전환 완료까지'},
 {title:'변경기록 알림서비스 연구',duration:HOUR,remaining:'연구 완료까지'},
 {title:'설정 시스템 연구',duration:DAY,remaining:'연구 완료까지'}
];
const RELEASE_DEFAULT={
 version:'0.13.41',title:'택시·트럭 월드 전환과 트럭 운송',
 entries:[
  '10레벨마다 임무판 월드 전환 제안 · 레벨 초기화와 기존 차량 자산 보존.',
  '트럭 월드 첫 진입 시 1톤 카고트럭과 트랙터 1대씩 이벤트 무상 지원.',
  '이전 월드 시지원 차량 회수 · 진행 중 임무는 완료까지 운행하고 공용자금에 정산.',
  '트럭 외주·카고·트레일러 운송 계약 5건 상시 표시 · 가상도시와 거리 랜덤.',
  '트럭 LV.2 중형, LV.5 대형 시지원 · LV.41 더블 ×2, LV.51 트리플 ×3, LV.61 4중 ×4.',
  '차량별 운송거리 제한과 최대 10,000km, 수익률 무한 성장 · LV.71 커스텀 구성은 추후 설계.',
  '월드 이벤트 차량 최초 한 번 지급 · 이전 월드 이벤트 차량은 신차가격의 25%로 판매 가능.'
 ]
};
releaseManifest=RELEASE_DEFAULT;
const OFFERS_MIN_WAIT=HOUR,OFFERS_MAX_WAIT=4*HOUR;
const OFFERS_MIN_EXPIRY=2*HOUR,OFFERS_MAX_EXPIRY=4*HOUR;
function progressionRandom(min,max){
 progression.rng=mix((progression.rng+0x9e3779b9)>>>0)||1;
 return min+progression.rng%(max-min+1);
}
function offerWait(){return progressionRandom(1,4)*HOUR;}
function offerLifetime(){return progressionRandom(2,4)*HOUR;}
function makeProgression(now,firstVisit=false){
 progression={schema:1,stage:firstVisit?3:0,mode:firstVisit?'done':'waiting',rng:seedNow(),nextOfferAt:0,offerAt:0,offerEndsAt:0,acceptedAt:0,completeAt:0,
  convertedAt:firstVisit?now:0,changelogAt:firstVisit?now:0,settingsAt:firstVisit?now:0,notifyEnabled:true,noticeVersion:'',noticeAt:0};
 // New players start with all currently released settings; previously saved research remains as-is.
 return progression;
}
function validProgression(p){
 if(!p||p.schema!==1||!Number.isInteger(p.stage)||p.stage<0||p.stage>3||
   !['waiting','offered','running','done'].includes(p.mode)||!Number.isInteger(p.rng)||
   typeof p.notifyEnabled!=='boolean'||typeof p.noticeVersion!=='string')return false;
 const numbers=['nextOfferAt','offerAt','offerEndsAt','acceptedAt','completeAt','convertedAt','changelogAt','settingsAt','noticeAt'];
 if(!numbers.every(key=>Number.isSafeInteger(p[key])&&p[key]>=0))return false;
 if(p.stage===3&&p.mode!=='done'||p.stage<3&&p.mode==='done')return false;
 if(p.stage>0&&!p.convertedAt||p.stage>1&&!p.changelogAt||p.stage>2&&!p.settingsAt)return false;
 if(p.mode==='offered'&&!(p.offerEndsAt>p.offerAt))return false;
 if(p.mode==='running'&&!(p.completeAt>p.acceptedAt))return false;
 if(p.noticeVersion&&!/^\d+\.\d{2}\.\d{2}$/.test(p.noticeVersion))return false;
 return true;
}
function markProgression(){progressionDirty=true;}
function saveProgression(now){
 if(!IS_LIVE||!progression)return;
 const snapshot=JSON.parse(JSON.stringify(progression));
 progressionDirty=false;progressionLastSave=now;
 progressionSaveChain=progressionSaveChain.catch(()=>{}).then(async()=>{
  const db=await openDb();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).put(snapshot,PROGRESSION_KEY);
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||new Error('MYON progression write failed'));
  });
 }).catch(e=>{console.error('MYON progression save:',e);progressionDirty=true;});
}
function advanceProgression(now){
 if(!progression||!assistant)return;
 const analysisEndsAt=assistant.startedAt+DAY;
 // On or after the actual 24h boundary, convert EVERY old observer,
 // including saved waiting/offered/running v0.13.15 conversion research.
 if(now>=analysisEndsAt&&progression.stage===0){
  progression.stage=1;
  progression.mode='waiting';
  progression.convertedAt=analysisEndsAt;
  progression.nextOfferAt=0;progression.offerAt=0;progression.offerEndsAt=0;
  progression.acceptedAt=0;progression.completeAt=0;
  markProgression();
 }
 // Secretary research offers are temporarily paused.
 // Previously accepted, running non-conversion research still finishes on time.
 for(let steps=0;steps<RESEARCH.length;steps++){
  if(progression.stage>=RESEARCH.length||progression.mode!=='running'||now<progression.completeAt)break;
  const completed=progression.completeAt;
  if(progression.stage===1)progression.changelogAt=completed;
  if(progression.stage===2)progression.settingsAt=completed;
  progression.stage++;
  progression.acceptedAt=0;progression.completeAt=0;
  progression.offerAt=0;progression.offerEndsAt=0;progression.nextOfferAt=0;
  progression.mode=progression.stage===RESEARCH.length?'done':'waiting';
  markProgression();
 }
 syncNotice(now);
}
async function startProgression(now,firstVisit=false){
 if(!IS_LIVE){makeProgression(now,firstVisit);advanceProgression(now);return;}
 let restored=null;
 try{restored=await read(PROGRESSION_KEY);}catch(e){console.error('MYON progression read:',e);}
 if(validProgression(restored))progression=restored;
 else{makeProgression(now,firstVisit);markProgression();}
 advanceProgression(now);
 if(progressionDirty)saveProgression(now);
}
function acceptResearch(){
 // No new assistant research can be accepted in v0.13.18.
}

 // Independent research: do not modify RESEARCH or v01315 saved stage=3.
 function menuRandom(a,b){
  menuStudy.rng=mix((menuStudy.rng+0x9e3779b9)>>>0)||1;
  return a+menuStudy.rng%(b-a+1);
 }
 function menuWait(){return menuRandom(1,4)*HOUR;}
 function menuExpiry(){return menuRandom(2,4)*HOUR;}
 function makeMenuStudy(now,firstVisit=false){
  menuStudy={schema:1,mode:firstVisit?'done':'locked',rng:seedNow(),nextOfferAt:0,offerAt:0,offerEndsAt:0,acceptedAt:0,completeAt:0,unlockedAt:firstVisit?now:0};
  // Latest menu is immediately available to newcomers; saved studies remain unchanged.
 }
 function validMenuStudy(s){
  if(!s||s.schema!==1||!['locked','waiting','offered','running','done'].includes(s.mode)||!Number.isInteger(s.rng))return false;
  if(!['nextOfferAt','offerAt','offerEndsAt','acceptedAt','completeAt','unlockedAt'].every(k=>Number.isSafeInteger(s[k])&&s[k]>=0))return false;
  if(s.mode==='offered'&&s.offerEndsAt<=s.offerAt)return false;
  if(s.mode==='running'&&s.completeAt<=s.acceptedAt)return false;
  if(s.mode==='done'&&!s.unlockedAt||s.unlockedAt&&s.mode!=='done')return false;
  return true;
 }
 function markMenu(){menuDirty=true;}
 function saveMenu(now){
  if(!IS_LIVE||!menuStudy)return;
  const snapshot=JSON.parse(JSON.stringify(menuStudy));
  menuDirty=false;menuLastSave=now;
  menuSaveChain=menuSaveChain.catch(()=>{}).then(async()=>{
   const db=await openDb();
   return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(snapshot,MENU_KEY);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('MYON menu save failed'));
   });
  }).catch(e=>{console.error('MYON menu save:',e);menuDirty=true;});
 }
 function advanceMenu(now){
  // Preserve prior offers without displaying them or generating new offers.
  // Only accepted work may complete while research is suspended.
  if(!menuStudy||menuStudy.mode!=='running'||now<menuStudy.completeAt)return;
  menuStudy.unlockedAt=menuStudy.completeAt;
  menuStudy.mode='done';
  menuStudy.nextOfferAt=0;menuStudy.offerAt=0;menuStudy.offerEndsAt=0;
  markMenu();
 }
 async function startMenu(now,firstVisit=false){
  if(!IS_LIVE){makeMenuStudy(now,firstVisit);advanceMenu(now);return;}
  let saved=null;
  try{saved=await read(MENU_KEY);}catch(e){console.error('MYON menu read:',e);}
  if(validMenuStudy(saved))menuStudy=saved;else{makeMenuStudy(now,firstVisit);markMenu();}
  advanceMenu(now);
  if(menuDirty)saveMenu(now);
 }
 function acceptMenu(){
  // Temporarily disabled while the new menu study is not offered.
 }
 const MANAGEMENT_SECTIONS={player:'내 정보',assistant:'비서',finance:'재정',vehicles:'차량'};
function showManagement(section=null){
 const selected=Object.prototype.hasOwnProperty.call(MANAGEMENT_SECTIONS,section)?section:null;
 $('management-menu').hidden=Boolean(selected);
 $('management-detail').hidden=!selected;
 for(const name of Object.keys(MANAGEMENT_SECTIONS))$('management-'+name).hidden=name!==selected;
 $('management-page-label').textContent=selected?MANAGEMENT_SECTIONS[selected]:'';
 if(selected==='vehicles')drawVehicles();
 nav.character.scrollTop=0;
}
function showWorldDirectory(){
 // Future unlocked navigation will set the current-world subtitle on entry.
 ui.worldName.textContent=activeWorld()==='truck'?'트럭 월드':'택시 월드';
 window.MYON_RPG_TAXI?.exit();
 $('world-directory').hidden=false;
 $('rpg-start-screen').hidden=true;
 document.querySelector('.common-funds').hidden=false;
 nav.world.scrollTop=0;
}
function showRpgStartScreen(){
 // RPG runs independently from legacy missions and funds.
 ui.worldName.textContent='RPG 월드';
 $('world-directory').hidden=true;
 $('rpg-start-screen').hidden=false;
 document.querySelector('.common-funds').hidden=true;
 nav.world.scrollTop=0;
 window.MYON_RPG_TAXI?.enter();
}
$('world-rpg-open').addEventListener('click',showRpgStartScreen);
$('rpg-back-to-worlds').addEventListener('click',showWorldDirectory);
for(const button of document.querySelectorAll('[data-manage-target]')){
 button.addEventListener('click',()=>showManagement(button.getAttribute('data-manage-target')));
}
$('management-back').addEventListener('click',()=>showManagement());

// v0.13.19 player profile and style preferences are stored separately from world jobs.
function defaultPreferences(){return {schema:1,style:'observe',total:8,counts:[1,1,1,1,1,1,1,1]};}
function validPreferences(p){
 return Boolean(p&&p.schema===1&&['observe','active','mixed'].includes(p.style)&&
  Number.isInteger(p.total)&&p.total>=8&&p.total<=MAX&&
  Array.isArray(p.counts)&&p.counts.length===8&&p.counts.every(n=>Number.isInteger(n)&&n>=0&&n<=MAX)&&
  p.counts.reduce((a,b)=>a+b,0)<=p.total);
}
function validProfile(p){
 return Boolean(p&&p.schema===1&&typeof p.name==='string'&&p.name.trim()===p.name&&p.name.length>=1&&p.name.length<=30&&
  ['male','female'].includes(p.gender)&&Number.isInteger(p.age)&&p.age>=1&&p.age<=120);
}
async function putRecord(key,value){
 if(!IS_LIVE)return;
 const db=await openDb();
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');
  tx.objectStore(STORE).put(value,key);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('MYON settings write failed'));
 });
}
function saveProfile(snapshot){
 profileSaveChain=profileSaveChain.catch(()=>{}).then(()=>putRecord(PROFILE_KEY,snapshot));
 return profileSaveChain;
}
function drawProfile(){
 const form=$('profile-form'),view=$('profile-view');
 form.hidden=Boolean(profile);view.hidden=!profile;
 $('profile-cancel').hidden=!profile;
 if(profile){
  $('profile-display-name').textContent=profile.name;
  $('profile-display-gender').textContent=profile.gender==='male'?'남성':'여성';
  $('profile-display-age').textContent=profile.age+'세';
 }
}
function openProfile(){
 $('profile-name').value=profile?profile.name:'';
 $('profile-age').value=profile?String(profile.age):'';
 for(const r of document.querySelectorAll('input[name="profile-gender"]'))r.checked=Boolean(profile&&r.value===profile.gender);
 $('profile-form').hidden=false;$('profile-view').hidden=true;
 $('profile-cancel').hidden=!profile;$('profile-feedback').textContent='';
}
function initProfileUi(){
 const form=$('profile-form');
 $('profile-edit').addEventListener('click',openProfile);
 $('profile-cancel').addEventListener('click',()=>{
  form.hidden=true;$('profile-view').hidden=false;$('profile-feedback').textContent='';
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  const selected=document.querySelector('input[name="profile-gender"]:checked');
  const draft={schema:1,name:$('profile-name').value.trim(),gender:selected?selected.value:null,age:Number($('profile-age').value)};
  if(!validProfile(draft)){$('profile-feedback').textContent='이름, 성별, 나이를 확인해 주세요.';return;}
  const button=form.querySelector('button[type="submit"]');button.disabled=true;
  try{
   await saveProfile(draft);profile=draft;drawProfile();
   $('profile-feedback').textContent='내 정보를 저장했습니다.';
  }catch(e){console.error('MYON player profile:',e);$('profile-feedback').textContent='저장에 실패했습니다. 다시 시도해 주세요.';}
  finally{button.disabled=false;}
 });
 drawProfile();
}
async function startPlayerSettings(){
 profile=null;preferences=defaultPreferences();
 if(IS_LIVE){
  try{
   const [savedProfile,savedPreferences]=await Promise.all([read(PROFILE_KEY),read(PREF_KEY)]);
   if(validProfile(savedProfile))profile=savedProfile;
   if(validPreferences(savedPreferences))preferences={schema:1,style:savedPreferences.style,total:savedPreferences.total,counts:savedPreferences.counts.slice()};
  }catch(e){console.error('MYON player settings load:',e);}
 }
 // Historical preferences are read but not rewritten or displayed.
 initProfileUi();
}

function versionCompare(a,b){
 const x=a.split('.').map(Number),y=b.split('.').map(Number);
 for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];
 return 0;
}
function validRelease(v){
 return v&&typeof v.version==='string'&&/^\d+\.\d{2}\.\d{2}$/.test(v.version)&&
 typeof v.title==='string'&&v.title.length>0&&v.title.length<=120&&
 Array.isArray(v.entries)&&v.entries.length>0&&v.entries.length<=12&&
 v.entries.every(x=>typeof x==='string'&&x.length>0&&x.length<=240);
}
function syncNotice(now){
 if(!progression||!progression.changelogAt)return;
 if(!progression.noticeVersion){
  progression.noticeVersion=releaseManifest.version;
  // The first notice begins when the research actually finished, even offline.
  progression.noticeAt=progression.changelogAt;
  markProgression();
 }else if(versionCompare(releaseManifest.version,progression.noticeVersion)>0){
  // A newly detected release supersedes an unfinished previous notification.
  progression.noticeVersion=releaseManifest.version;
  progression.noticeAt=now;
  markProgression();
 }
}
function applyRelease(candidate,now){
 if(!validRelease(candidate)||versionCompare(candidate.version,releaseManifest.version)<0)return;
 releaseManifest={version:candidate.version,title:candidate.title,entries:candidate.entries.slice()};
 syncNotice(now);
 if(progressionDirty&&now-progressionLastSave>=1)saveProgression(now);
 if(ready)draw(now);
}
async function refreshRelease(){
 if(!IS_LIVE||typeof fetch!=='function')return;
 try{
  const url='myon-release.json?check='+Date.now();
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)return;
  const data=await response.json();
  applyRelease(data,Math.floor(Date.now()/1000));
 }catch(e){console.warn('MYON release check:',e);}
}
function noticeShown(now){
 return Boolean(progression&&progression.changelogAt&&progression.notifyEnabled&&
  progression.noticeVersion===releaseManifest.version&&progression.noticeAt>0&&
  now<progression.noticeAt+DAY);
}
function updateSettings(now){
 if(!progression)return;
 const unlocked=Boolean(progression.settingsAt);
 ui.gear.disabled=!unlocked;
 ui.gear.setAttribute('aria-label',unlocked?'설정 열기':'설정 시스템 연구 후 해금');
 if(!unlocked){ui.settings.hidden=true;ui.gear.setAttribute('aria-expanded','false');}
 ui.version.hidden=false;
 ui.version.textContent='v'+releaseManifest.version;
 ui.notify.textContent=progression.notifyEnabled?'켜짐':'꺼짐';
 ui.notify.setAttribute('aria-pressed',String(progression.notifyEnabled));
}
ui.gear.addEventListener('click',()=>{
 if(!progression||!progression.settingsAt)return;
 ui.settings.hidden=!ui.settings.hidden;
 ui.gear.setAttribute('aria-expanded',String(!ui.settings.hidden));
});
ui.notify.addEventListener('click',()=>{
 if(!progression||!progression.settingsAt)return;
 progression.notifyEnabled=!progression.notifyEnabled;
 const now=Math.floor(Date.now()/1000);
 markProgression();saveProgression(now);draw(now);
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&!ui.settings.hidden){
  ui.settings.hidden=true;ui.gear.setAttribute('aria-expanded','false');ui.gear.focus();
 }
});

function element(tag,cls,value){
 const el=document.createElement(tag);
 if(cls)el.className=cls;
 if(value!==undefined)el.textContent=value;
 return el;
}
// Historical automatic-mission catalog removed from the UI in v0.13.35.
function makeUnitCard(v){
 const card=element('article','slot'),head=element('div','slot-head'),name=element('div','slot-name');
 name.append(element('span','slot-icon',unitIcons[v.kind]),element('strong','',v.kind==='truck'&&v.truckContractVersion===1?v.displayName:v.contractType==='owned'?'택시'+(v.vehicleNo||vehicleById(v.vehicleId)?.fleetNo||v.vehicleId)+'호':'MYON 택시'));
 const status=element('span','slot-state');
 head.append(name,status);
 const detail=element('div','slot-details');
 const left=element('span','slot-metric'),right=element('span','slot-metric slot-operations');
 detail.append(left,right);
 const bar=element('div','slot-progress');
 const ownedNote=v.contractType==='owned'||v.truckContractVersion===1?element('div','owned-taxi-note'):null;
 if(ownedNote)card.append(head,detail,ownedNote,bar);
 else card.append(head,detail,bar);
 return {card,status,left,right,bar,ownedNote};
}
function makeConstructionCard(v){
 // First line: mission name (single/double track for new rail) and travel/work
 // status. Second line: remaining distance for this stage and final ETA.
 const card=element('article','slot construction-card');
 const head=element('div','slot-head'),label=element('div','slot-name');
 const name=element('strong'),status=element('span','slot-state');
 label.append(name);head.append(label,status);
 const details=element('div','slot-details');
 const left=element('span','slot-metric'),right=element('span','slot-metric slot-operations');
 details.append(left,right);
 const bar=element('div','slot-progress');
 card.append(head,details,bar);
 return {card,name,status,left,right,bar};
}
function makeRouteCard(v){
 const spec=specs.get(v.routeKey),card=element('article','slot route-slot');
 const head=element('div','slot-head'),name=element('div','slot-name');
 const title=element('strong','',spec.name);
 name.append(element('span','slot-icon',spec.icon),title);
 const status=element('span','slot-state');head.append(name,status);
 const info=element('div','route-info'),note=element('span','',spec.note),interval=element('span','');
 info.append(note,interval);
 const tableHead=element('div','route-row route-heading');
 tableHead.append(element('span','','출발시간'),element('span','','위치'));
 const rows=element('div','route-vehicles');
 card.append(head,info,tableHead,rows);
 return {card,title,status,interval,note,rows};
}


function makeAssistantCard(){
 const card=element('article','slot assistant-card');
 const head=element('div','slot-head'),name=element('div','slot-name');
 name.append(element('strong','','관전임무 분석중'),element('span','assistant-dev-tag','개발중'));
 const status=element('span','slot-state');head.append(name,status);
 const time=element('div','slot-details'),left=element('span','slot-metric assistant-timer-label');
 const right=element('span','slot-metric slot-operations assistant-timer');time.append(left,right);
 const counts=element('div','assistant-counts');
 const activeBox=element('div','assistant-stat'),completedBox=element('div','assistant-stat');
 const active=element('strong','assistant-stat-number'),completed=element('strong','assistant-stat-number');
 activeBox.append(element('span','assistant-stat-label','진행 중인 임무'),active);
 completedBox.append(element('span','assistant-stat-label','분석 후 완료 임무'),completed);
 counts.append(activeBox,completedBox);
 const notes=element('details','assistant-release'),summary=element('summary','assistant-release-summary');
 const version=element('span','','v0.13.25'),update=element('span','release-new','NEW'),arrow=element('span','assistant-release-arrow','⌄');
 update.hidden=true;
 const rightSummary=element('span','slot-right');rightSummary.append(update,arrow);summary.append(version,rightSummary);
 const content=element('div','assistant-release-content'),subtitle=element('div','notice-subtitle'),list=element('ul','notice-list');
 content.append(subtitle,list);notes.append(summary,content);
 const bar=element('div','slot-progress');card.append(head,time,counts,notes,bar);
 return {card,name:name.querySelector('strong'),tag:name.querySelector('.assistant-dev-tag'),status,time,left,right,active,completed,bar,
  releaseVersion:version,releaseNew:update,releaseTitle:subtitle,releaseList:list,renderedVersion:null};
}
function makeResearchCard(onAccept=acceptResearch){
 const card=element('article','slot research-card'),head=element('div','slot-head');
 const name=element('div','slot-name'),title=element('strong');
 name.appendChild(title);
 const status=element('span','slot-state'),accept=element('button','slot-button research-accept','수락');
 accept.type='button';accept.addEventListener('click',onAccept);
 const rightHead=element('div','slot-right');rightHead.append(status,accept);
 head.append(name,rightHead);
 const details=element('div','slot-details'),left=element('span','slot-metric assistant-timer-label');
 const right=element('span','slot-metric slot-operations assistant-timer');details.append(left,right);
 const bar=element('div','slot-progress');card.append(head,details,bar);
 return {card,title,status,accept,left,right,bar};
}

function drawMenu(now){
 if(!menuStudy||!progression||!progression.convertedAt||!['offered','running'].includes(menuStudy.mode))return;
 const card=cards.get('menu-study');if(!card)return;
 const offered=menuStudy.mode==='offered';
 card.title.textContent='하단 메뉴 추가';card.accept.hidden=!offered;card.status.hidden=offered;
 card.status.textContent=offered?'':'연구중';
 card.left.textContent=offered?'임무 폐기까지':'연구 완료까지';
 const end=offered?menuStudy.offerEndsAt:menuStudy.completeAt;
 const start=offered?menuStudy.offerAt:menuStudy.acceptedAt;
 card.right.textContent=countdown(end-now);
 card.bar.style.width=(100*Math.max(0,Math.min(1,(now-start)/(end-start)))).toFixed(2)+'%';
}
function drawResearch(now){
 if(!progression||progression.stage>=RESEARCH.length)return;
 const slot=cards.get('research');if(!slot)return;
 const kind=RESEARCH[progression.stage],offered=progression.mode==='offered';
 slot.title.textContent=kind.title;
 slot.accept.hidden=!offered;
 slot.status.hidden=offered;
 slot.status.textContent=offered?'':'진행중';
 slot.left.textContent=offered?'임무 폐기까지':kind.remaining;
 const end=offered?progression.offerEndsAt:progression.completeAt;
 const begin=offered?progression.offerAt:progression.acceptedAt;
 slot.right.textContent=countdown(end-now);
 slot.bar.style.width=(100*Math.max(0,Math.min(1,(now-begin)/(end-begin)))).toFixed(2)+'%';
}
function makeNoticeCard(){
 const card=element('article','slot notice-card'),head=element('div','slot-head');
 const name=element('div','slot-name'),title=element('strong');
 const tag=element('span','system-tag','시스템');name.append(title,tag);
 const status=element('span','slot-state','알림중');head.append(name,status);
 const subtitle=element('div','notice-subtitle'),list=element('ul','notice-list');
 const details=element('div','slot-details'),left=element('span','slot-metric assistant-timer-label','알림 종료까지');
 const right=element('span','slot-metric slot-operations assistant-timer');
 details.append(left,right);
 const bar=element('div','slot-progress');card.append(head,subtitle,list,details,bar);
 return {card,title,subtitle,list,right,bar,renderedVersion:null};
}
function drawNotice(now){
 const slot=cards.get('release');if(!slot)return;
 slot.title.textContent='변경기록 · v'+releaseManifest.version;
 if(slot.renderedVersion!==releaseManifest.version){
  slot.subtitle.textContent=releaseManifest.title;
  const nodes=document.createDocumentFragment();
  for(const item of releaseManifest.entries)nodes.appendChild(element('li','',item));
  slot.list.replaceChildren(nodes);slot.renderedVersion=releaseManifest.version;
 }
 slot.right.textContent=countdown(progression.noticeAt+DAY-now);
 slot.bar.style.width=(100*Math.max(0,Math.min(1,(now-progression.noticeAt)/DAY))).toFixed(2)+'%';
}

function drawAssistant(now){
 if(!assistant)return;
 const slot=cards.get('assistant');if(!slot)return;
 const readyAt=assistant.startedAt+DAY,converted=now>=readyAt;
 slot.name.textContent=converted?'비서':'관전임무 분석중';
 // Keep initial 24-hour timer and tag; hide these redundant labels once secretary is active.
 slot.tag.hidden=converted;
 slot.status.hidden=converted;
 slot.time.hidden=converted;
 slot.tag.textContent='개발중';
 slot.status.textContent=converted?'':'분석중';
 slot.left.textContent=converted?'':'분석 완료까지';
 slot.right.textContent=converted?'':hms(Math.ceil(Math.max(0,readyAt-now)));
 slot.active.textContent=state.units.length+'건';
 slot.completed.textContent=assistantCompleted()+'건';
 slot.releaseVersion.textContent='v'+releaseManifest.version;
 slot.releaseNew.hidden=!noticeShown(now);
 if(slot.renderedVersion!==releaseManifest.version){
  slot.releaseTitle.textContent=releaseManifest.title;
  const entries=document.createDocumentFragment();
  for(const entry of releaseManifest.entries)entries.appendChild(element('li','',entry));
  slot.releaseList.replaceChildren(entries);
  slot.renderedVersion=releaseManifest.version;
 }
 slot.bar.hidden=converted;
 slot.bar.style.width=converted?'100%':(100*Math.max(0,Math.min(1,(now-assistant.startedAt)/DAY))).toFixed(4)+'%';
}
function reorder(now){
 if(assistant&&!cards.has('assistant')){
  const card=makeAssistantCard();cards.set('assistant',card);
  assistantContainer.appendChild(card.card);
 }
 // Home is reserved for currently running real missions. Secretary stays in management.
 const list=state.units.slice().sort((a,b)=>taskEnd(a)-taskEnd(b)||a.id-b.id);
 const key=list.map(v=>v.id).join(',');
 if(reorder.key===key)return;
 const nodes=document.createDocumentFragment(),seen=new Set(['assistant']);
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
 if(v.kind==='truck'&&v.truckContractVersion===1){
  const names={load:'상차 중',attach:'연결 중',prep:'출발 준비',outbound:'운송 중',unload:'하역 중',detach:'인도 중',deliver:'배송 완료 처리'};
  const value=stage.phase==='outbound'?Math.ceil(v.distanceKm*Math.max(0,(stage.end-now)/(stage.end-stage.start))).toLocaleString('ko-KR')+'km · '+v.from+' → '+v.to:v.from+' → '+v.to;
  return {status:names[stage.phase]||'운행 중',value,progress:Math.max(0,Math.min(1,(now-v.start)/(v.end-v.start)))};
 }
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
 if(spec.demand){
  if(s.phase==='layover')return '하행 운행 대기 '+countdown(trip.remaining);
  const direction=s.service==='position'?'상행 회송':s.service==='up'?'상행 운행':s.service==='return'?'하행 회송 복귀':'하행 운행';
  if(s.phase==='stop')return term+' '+s.stop+' '+direction+' 정차';
  if(s.phase==='highway')return direction+' · 고속도로 '+countdown(trip.remaining);
  return term+' '+s.from+' → '+s.to+' '+direction;
 }
 if(spec.expressRail){
  // A station is passed only AFTER the train reaches it. When riding
  // from station 1 to 2, never announce 2 as passed in advance.
  if(s.phase==='stop')return s.stop+'역 정차 중';
  if(s.phase==='travel'){
   const fromStop=s.from===1||s.from===spec.stops||s.from%5===0;
   return fromStop?s.from+'역 → '+s.to+'역 이동 중':s.from+'역 통과';
  }
 }
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
 if(spec.demand==='full'){
  const peak=demandShift(spec,v.seed)==='morning'?'출근 06:00~08:00':'퇴근 18:00~20:00';
  slot.note.textContent='광역 전구간 왕복 · '+peak+' · 30분 배차';
 }else if(spec.demand==='charter'){
  const shift=demandShift(spec,v.seed),morning=shift==='morning';
  slot.title.textContent='수요대응 전세버스 '+(morning?'출근용':'퇴근용');
  slot.note.textContent=(morning?'상행':'하행')+' 승객 운송 · 단 1회';
 }
 const isClosing=now>=v.cutoff;
 if(spec.demand==='charter'){
  const stage=trips[0]&&trips[0].stage;
  slot.status.textContent=!stage?(isClosing?'운행 종료':'출발 대기'):
   stage.phase==='layover'?'운행 대기':
   stage.service==='position'?'회송 중':
   stage.service==='return'?'복귀 중':'운행 중';
 }else{
  slot.status.textContent=trips.length?'운행 중 '+trips.length+'대':isClosing?'운행 종료':'출발 대기';
 }
 slot.status.classList.toggle('waiting',!trips.length);
 const today=kstMidnight(now),int=spec.demand?1800:intervalFor(spec,today,(now-today)%DAY);
 if(spec.demand==='charter'){
  const shift=demandShift(spec,v.seed);
  const departure=v.serviceDay+(shift==='morning'?6:18)*HOUR+charterSlot(v.seed)*1800;
  slot.interval.textContent='출발 '+timeFmt.format(new Date(departure*1000));
 }else{
  slot.interval.textContent='배차 '+(int===HOUR?'1시간':int/60+'분');
 }
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
  const positioning=(spec.demand==='evening'||spec.demand==='charter'&&demandShift(spec,v.seed)==='evening')&&next&&now<next-3*HOUR;
  const nextMove=positioning?next-3*HOUR:next;
  // For charter work, the left column always displays its ONE booked
  // passenger departure, not the earlier empty repositioning time.
  row.a.textContent=next?timeFmt.format(new Date((spec.demand==='charter'?next:nextMove)*1000)):'--:--';
  if(spec.demand==='charter'&&next){
   row.b.textContent=positioning?
    '회송 시작 '+timeFmt.format(new Date(nextMove*1000))+' · '+countdown(nextMove-now):
    '출발 대기 '+countdown(next-now);
  }else{
   row.b.textContent=next?(positioning?'상행 회송 대기 ':
    ((new Date((next+KST)*1000).getUTCHours()===5||spec.demand)?'첫차 출발대기 ':'출발대기 '))+countdown(nextMove-now):'운행 종료';
  }
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
// v0.13.24: independent income ledger, additive to old saved funds.
const FINANCE_HISTORY_LIMIT=100;
function newFinanceLedger(now){
 return {schema:1,openedAt:now,openingBalance:commonFunds?commonFunds.balance:0,totalIncome:0,totalExpenses:0,entries:[]};
}
const FINANCE_CATEGORIES=['taxi-outsource','taxi-owned','truck-outsource','truck-owned','vehicle-purchase','vehicle-repayment','vehicle-repair','vehicle-sale','vehicle-sale-payoff'];
function validFinanceLedger(v){
 return Boolean(v&&v.schema===1&&Number.isSafeInteger(v.openedAt)&&v.openedAt>0&&
  Number.isSafeInteger(v.openingBalance)&&v.openingBalance>=0&&
  Number.isSafeInteger(v.totalIncome)&&v.totalIncome>=0&&
  Number.isSafeInteger(v.totalExpenses)&&v.totalExpenses>=0&&
  Array.isArray(v.entries)&&v.entries.length<=FINANCE_HISTORY_LIMIT&&v.entries.every(e=>e&&
   Number.isSafeInteger(e.id)&&e.id>0&&Number.isSafeInteger(e.at)&&e.at>0&&
   FINANCE_CATEGORIES.includes(e.category)&&Number.isSafeInteger(e.amount)&&e.amount!==0));
}
async function startFinanceLedger(now){
 financeLedger=newFinanceLedger(now);
 if(!IS_LIVE)return;
 try{
  const saved=await read(LEDGER_KEY);
  if(validFinanceLedger(saved)){financeLedger=saved;return;}
 }catch(error){console.error('MYON finance ledger:',error);}
 // Opening a ledger never fabricates historic income from existing funds.
 dirty=true;
}
function recordFinanceTransaction(category,amount,at,id){
 if(!financeLedger||!Number.isSafeInteger(amount)||amount===0)return;
 if(amount>0)financeLedger.totalIncome+=amount;
 else financeLedger.totalExpenses+=-amount;
 financeLedger.entries.unshift({id,at,category,amount});
 if(financeLedger.entries.length>FINANCE_HISTORY_LIMIT)financeLedger.entries.length=FINANCE_HISTORY_LIMIT;
}
function recordTaxiSettlement(v,at){
 recordFinanceTransaction('taxi-outsource',v.shareUnits,at,v.id);
}
function drawFinance(now){
 if(!financeLedger||!state||!commonFunds)return;
 $('finance-balance').textContent=formatCommonFunds(commonFunds.balance);
 $('finance-income').textContent='+'+formatCommonFunds(financeLedger.totalIncome);
 let pending=0;
 for(const v of state.units){
  if(v.kind==='truck'&&v.truckContractVersion===1&&taskEnd(v)>now)pending+=v.shareUnits||0;
  if(v.kind==='taxi'&&v.taxiContractVersion===1&&v.contractType==='outsource'&&
   Number.isSafeInteger(v.shareUnits)&&v.shareUnits>0&&taskEnd(v)>now)pending+=v.shareUnits;
  if(v.kind==='taxi'&&v.taxiContractVersion===3&&v.contractType==='owned'&&taskEnd(v)>now)pending+=v.shareUnits||0;
  if(v.kind==='taxi'&&v.taxiContractVersion===2&&v.contractType==='owned'&&taskEnd(v)>now){
   const car=vehicleById(v.vehicleId);
   if(car)pending+=v.fareUnits-Math.min(car.remaining,Math.ceil(v.fareUnits*car.remaining/car.price));
  }
 }
 $('finance-pending').textContent='+'+formatCommonFunds(pending);
 const records=financeLedger.entries.slice(0,20);
 const signature=records.map(e=>e.category+':'+e.id+':'+e.at+':'+e.amount).join('|');
 if(drawFinance.signature===signature)return;
 const list=$('finance-transactions'),nodes=document.createDocumentFragment();
 if(!records.length)nodes.appendChild(element('p','finance-empty','아직 기록된 거래가 없습니다.'));
 for(const record of records){
  const row=element('div','finance-transaction'),left=element('div','finance-transaction-copy');
  const date=new Date(record.at*1000);
  const names={'taxi-outsource':'외주 택시 정산','taxi-owned':'보유 택시 수익','truck-outsource':'트럭 외주 정산','truck-owned':'트럭 운송 수익',
   'vehicle-purchase':'차량 구매','vehicle-repayment':'지원금 중도상환','vehicle-repair':'차량 수리',
   'vehicle-sale':'차량 판매','vehicle-sale-payoff':'판매 시 지원금 상환'};
  left.append(element('strong','',names[record.category]||'차량 거래'),
   element('small','',dateFmt.format(date).replace(/-/g,'.')+' '+timeFmt.format(date)));
  row.append(left,element('strong',record.amount>0?'finance-positive':'finance-negative',
   (record.amount>0?'+':'−')+formatCommonFunds(Math.abs(record.amount))));
  nodes.appendChild(row);
 }
 list.replaceChildren(nodes);
 drawFinance.signature=signature;
}

// v0.13.25 — Purchased taxis are permanent assets; active jobs are one-way trips.
const TAXI_MODELS=[
 {key:'myon',name:'MYON 택시',price:20000000},
 {key:'k5',name:'기아 K5 2.0 스마트 셀렉션',price:27240000},
 {key:'sonata',name:'현대 쏘나타 디 엣지',price:28760000}
];
// The three representative used-car listings keep a fixed 50% sale/purchase valuation.
const USED_MARKET=[
 {id:'u1',model:'k5',durability:90000},
 {id:'u2',model:'sonata',durability:70000},
 {id:'u3',model:'k5',durability:50000}
];
let ownedGarage=null,vehicleSelectedId=0,vehicleTab='owned',vehicleBuyType='new',vehicleBusy=false;
const currencyUnits=n=>formatCommonFunds(n);
const vehicleById=id=>ownedGarage&&ownedGarage.vehicles.find(v=>v.id===id);
function garageDefault(){return {schema:1,nextId:1,eventGranted:0,vehicles:[]};}
function validGarage(s){
 if(!s||s.schema!==1||!Number.isSafeInteger(s.nextId)||s.nextId<1||
    (!Number.isSafeInteger(s.eventGranted)&&s.eventGranted!==undefined)||
    (s.eventGranted!==undefined&&(s.eventGranted<0||s.eventGranted>2))||
    !Array.isArray(s.vehicles)||s.vehicles.length>MAX_OWNED_VEHICLES)return false;
 const ids=new Set();
 return s.vehicles.every(v=>{
  if(!v||!Number.isSafeInteger(v.id)||v.id<1||v.id>=s.nextId||ids.has(v.id))return false;
  ids.add(v.id);
  return TAXI_MODELS.some(m=>m.key===v.model)&&
   ['new','used','city','event'].includes(v.origin)&&Number.isSafeInteger(v.price)&&v.price>=(['city','event'].includes(v.origin)?0:1)&&
   Number.isSafeInteger(v.newPrice)&&v.newPrice>=v.price&&
   (v.fleetNo===undefined||(Number.isInteger(v.fleetNo)&&v.fleetNo>=1&&v.fleetNo<=50))&&
   Number.isSafeInteger(v.remaining)&&v.remaining>=0&&v.remaining<=v.price&&
   Number.isSafeInteger(v.durability)&&v.durability>=0&&v.durability<=100000&&
   Number.isSafeInteger(v.serviceRuns)&&v.serviceRuns>=0&&v.serviceRuns<=1000&&
   Number.isSafeInteger(v.trips)&&v.trips>=0&&Number.isSafeInteger(v.activeMissionId)&&v.activeMissionId>=0&&
   typeof v.location==='string'&&v.location.length<=60;
 });
}
async function startOwnedGarage(){
 ownedGarage=garageDefault();
 if(!IS_LIVE)return;
 try{
  const saved=await read(OWNED_KEY);
  if(validGarage(saved)){
   ownedGarage=saved;assignFleetNumbers();
   // A persisted grant count never decreases even if a gift is removed.
   if(ownedGarage.eventGranted===undefined){
    ownedGarage.eventGranted=ownedGarage.vehicles.filter(v=>v.origin==='event').length;
    dirty=true;
   }
   return;
  }
  if(saved)throw new Error('Saved vehicle data failed validation; preserving record');
  dirty=true;
 }catch(e){console.error('MYON owned vehicles:',e);if(e.message.includes('validation')){ownedGarage=null;}}
}
function fleetNextNumber(){
 const used=new Set((ownedGarage?.vehicles||[]).map(v=>v.fleetNo).filter(Boolean));
 for(let no=1;no<=MAX_OWNED_VEHICLES;no++)if(!used.has(no))return no;
 return 0;
}
function assignFleetNumbers(){
 if(!ownedGarage)return;
 const used=new Set();
 for(const v of ownedGarage.vehicles){
  if(Number.isInteger(v.fleetNo)&&v.fleetNo>=1&&v.fleetNo<=50&&!used.has(v.fleetNo))used.add(v.fleetNo);
  else v.fleetNo=0;
 }
 for(const v of ownedGarage.vehicles)if(!v.fleetNo){
  let no=1;while(used.has(no)&&no<=50)no++;
  if(no>50)break;
  v.fleetNo=no;used.add(no);dirty=true;
 }
}
function grantCityVehicles(){
 if(activeWorld()!=='taxi'||!ownedGarage||!taxiLevel)return;
 const target=cityEntitlement(),current=ownedGarage.vehicles.filter(v=>v.origin==='city'&&!v.recallAfterMission).length;
 for(let i=current;i<target&&ownedGarage.vehicles.length<MAX_OWNED_VEHICLES;i++){
  const no=fleetNextNumber();if(!no)break;
  const id=ownedGarage.nextId++;
  ownedGarage.vehicles.push({id,fleetNo:no,model:'myon',origin:'city',newPrice:0,price:0,remaining:0,
   durability:100000,serviceRuns:0,trips:0,location:'시 제공 차고지',activeMissionId:0});
  dirty=true;
 }
}
// Renewal gift: two free MYON taxis per player, running through the
// SAME owned-vehicle workflow. Unclaimed gift slots wait at the 50-car cap.
function grantEventVehicles(){
 if(activeWorld()!=='taxi'||!ownedGarage)return;
 if(!Number.isSafeInteger(ownedGarage.eventGranted))return;
 while(ownedGarage.eventGranted<2&&ownedGarage.vehicles.length<MAX_OWNED_VEHICLES){
  const no=fleetNextNumber();if(!no)break;
  const id=ownedGarage.nextId++;
  ownedGarage.vehicles.push({id,fleetNo:no,model:'myon',origin:'event',
   newPrice:20000000,price:0,remaining:0,
   durability:100000,serviceRuns:0,trips:0,location:'리뉴얼 이벤트 차고지',activeMissionId:0});
  ownedGarage.eventGranted++;
  dirty=true;
 }
}
function ownedActiveCount(){return state.units.filter(v=>v.dispatch==='accepted'||v.dispatch==='owned').length;}
function observerActiveCount(){return state.units.filter(v=>v.dispatch!=='accepted'&&v.dispatch!=='owned').length;}
function vehicleEquity(v){return v.price>0?(v.price-v.remaining)/v.price:1;}
function repairCost(v){return Math.ceil(v.newPrice*(v.durability>=70000?3:v.durability>=30000?6:10)/1000);}
function vehicleDispatchAvailable(v){
 return activeWorld()==='taxi'&&allowsAcceptedMissions()&&!!v&&!v.activeMissionId&&
  ownedActiveCount()<INVOLVED_MAX_MISSIONS&&state.units.length<MAX_TOTAL;
}
function ownedTaxiFare(distance,at){
 const base=taxiFareUnits(distance);
 const beyond10=Math.max(0,distance-10000);
 const extra=Math.ceil(Math.ceil(beyond10/131)*100*0.2);
 const hour=new Date((at+KST)*1000).getUTCHours();
 const nightRate=(hour>=23||hour<2)?40:(hour>=22||hour<4)?20:0;
 const night=Math.ceil(base*nightRate/100);
 return {base,extra,night,nightRate,total:base+extra+night};
}
function makeOwnedTrip(v,now){
 const base=jobIdentity(now,null),seed=base.seed;
 const distance=range(seed,22,30,levelMaxKm()*10)*100;
 const fare=ownedTaxiFare(distance,now);
 // The city-out-of-town tariff remains. LV.5 unlocks an extra 1% on >10km.
 const longFare=levelNumber()>=5&&distance>10000?Math.ceil(fare.total/100):0;
 const total=fare.total+longFare,rate=levelRevenue(),shareUnits=Math.floor(total*rate/100);
 const end=roadEnd(seed,now,distance);
 return {...base,kind:'taxi',dispatch:'owned',contractType:'owned',taxiContractVersion:3,worldCycle:worldProgress.cycles.taxi,
  vehicleId:v.id,vehicleNo:v.fleetNo||v.id,passengerMeters:distance,fareUnits:total,
  shareUnits,revenueRate:rate,cityCutUnits:Math.max(0,total-shareUnits),
  baseFare:fare.base,extraFare:fare.extra,nightFare:fare.night,longFare,nightRate:fare.nightRate,
  start:now,end,stages:[{phase:'outbound',start:now,end,distance}],
  startLocation:v.location,destination:'운행 거점 '+(v.trips+1)};
}
function finishOwnedTrip(task,at){
 const v=vehicleById(task.vehicleId);
 if(!v||v.activeMissionId!==task.id)return;
 if(task.taxiContractVersion===3){
  const player=task.shareUnits;
  if(!Number.isSafeInteger(player)||player<0||!commonFunds||!Number.isSafeInteger(commonFunds.balance+player))return;
  commonFunds.balance+=player;v.trips++;v.location=task.destination;v.activeMissionId=0;
  recordFinanceTransaction('taxi-owned',player,at,task.id);dirty=true;return;
 }
 if(task.taxiContractVersion!==2||v.price<=0)return;
 // Retain settlement terms of old paid-vehicle journeys; do not add repairs.
 const repay=Math.min(v.remaining,Math.ceil(task.fareUnits*v.remaining/v.price));
 const player=task.fareUnits-repay;
 if(!Number.isSafeInteger(player)||!Number.isSafeInteger(commonFunds.balance+player))return;
 commonFunds.balance+=player;v.remaining-=repay;
 v.trips++;v.location=task.destination;v.activeMissionId=0;
 recordFinanceTransaction('taxi-owned',player,at,task.id);dirty=true;
}
function vehicleStatus(v){
 return v.activeMissionId?'운행 중':'운행 대기';
}
function ownedTaxiMissionText(job){
 const chunks=[km(job.passengerMeters),'기본 '+formatCommonFunds(job.baseFare)];
 if(job.extraFare)chunks.push('시외 +'+formatCommonFunds(job.extraFare));
 if(job.longFare)chunks.push('장거리 1% +'+formatCommonFunds(job.longFare));
 if(job.nightFare)chunks.push('심야 +'+formatCommonFunds(job.nightFare));
 if(job.taxiContractVersion===3){
  chunks.push(job.revenueRate>100?'수익률 100% + 보너스 '+(job.revenueRate-100)+'%':'수익률 '+job.revenueRate+'%');
  chunks.push('예상 정산 '+formatCommonFunds(job.shareUnits));
 }else{
  const car=vehicleById(job.vehicleId);
  const income=car&&car.price>0?job.fareUnits-Math.min(car.remaining,Math.ceil(job.fareUnits*car.remaining/car.price)):0;
  chunks.push('예상 정산 '+formatCommonFunds(income));
 }
 return chunks.join(' · ');
}
function setVehicleMessage(message){$('vehicle-message').textContent=message;}
function selectVehicle(id){vehicleSelectedId=id;drawVehicles();}
function vehicleBuySelection(){
 const model=TAXI_MODELS.find(m=>m.key===$('vehicle-model').value)||TAXI_MODELS[0];
 if(vehicleBuyType==='new')return {model,price:model.price,durability:100000,origin:'new',newPrice:model.price};
 const listing=USED_MARKET.find(x=>x.id===$('vehicle-used').value)||USED_MARKET[0];
 const usedModel=TAXI_MODELS.find(m=>m.key===listing.model);
 return {model:usedModel,price:usedModel.price/2,durability:listing.durability,origin:'used',newPrice:usedModel.price};
}
function drawVehicleBuy(){
 if(!ownedGarage||!commonFunds)return;
 $('vehicle-buy-new').classList.toggle('selected',vehicleBuyType==='new');
 $('vehicle-buy-used').classList.toggle('selected',vehicleBuyType==='used');
 $('vehicle-model-row').hidden=vehicleBuyType==='used';
 $('vehicle-used-row').hidden=vehicleBuyType!=='used';
 const selected=vehicleBuySelection();
 const pct=Number($('vehicle-support').value);
 const subsidy=Math.round(selected.price*pct/100),self=selected.price-subsidy;
 $('vehicle-support-value').textContent=pct+'%';
 $('vehicle-price').textContent=currencyUnits(selected.price);
 $('vehicle-durability-buy').textContent=(selected.durability/1000).toFixed(3)+'%';
 $('vehicle-subsidy-value').textContent=currencyUnits(subsidy);
 $('vehicle-self-value').textContent=currencyUnits(self);
 $('vehicle-buy-action').textContent='차량 구매 · '+currencyUnits(self);
 $('vehicle-buy-action').disabled=vehicleBusy||ownedGarage.vehicles.length>=MAX_OWNED_VEHICLES||commonFunds.balance<self;
 $('vehicle-buy-note').textContent=ownedGarage.vehicles.length>=50?'차량은 최대 50대까지 보유할 수 있어요.':
   commonFunds.balance<self?'공용자금이 부족합니다.':'구매 시 자부담금만 공용자금에서 차감됩니다.';
}
function drawVehicles(){
 if(!ownedGarage||!commonFunds)return;
 $('vehicle-count').textContent=ownedGarage.vehicles.length+' / 50대';
 $('vehicle-funds').textContent=currencyUnits(commonFunds.balance);
 $('vehicle-tab-owned').classList.toggle('selected',vehicleTab==='owned');
 $('vehicle-tab-buy').classList.toggle('selected',vehicleTab==='buy');
 $('vehicle-owned-area').hidden=vehicleTab!=='owned';
 $('vehicle-buy-area').hidden=vehicleTab!=='buy';
 drawVehicleBuy();
 if(vehicleTab!=='owned')return;
 const holder=$('vehicle-owned-select');
 const key=ownedGarage.vehicles.map(v=>v.id+':'+v.model).join(',');
 if(drawVehicles.selectKey!==key){
  const fragment=document.createDocumentFragment();
  for(const v of ownedGarage.vehicles){
   const o=document.createElement('option');o.value=String(v.id);
   const model=TAXI_MODELS.find(m=>m.key===v.model);
   o.textContent='택시 '+v.id+'호차 · '+model.name;
   fragment.appendChild(o);
  }
  holder.replaceChildren(fragment);drawVehicles.selectKey=key;
 }
 if(!vehicleById(vehicleSelectedId))vehicleSelectedId=ownedGarage.vehicles.length?ownedGarage.vehicles[0].id:0;
 holder.value=String(vehicleSelectedId);
 const v=vehicleById(vehicleSelectedId);
 $('vehicle-owned-empty').hidden=!!v;
 $('vehicle-owned-detail').hidden=!v;
 if(!v)return;
 $('vehicle-title').textContent='택시 '+v.id+'호차 · '+TAXI_MODELS.find(m=>m.key===v.model).name;
 $('vehicle-status').textContent=vehicleStatus(v);
 $('vehicle-position').textContent=v.location;
 $('vehicle-durability').textContent=(v.durability/1000).toFixed(3)+'%';
 $('vehicle-durability-bar').style.width=(v.durability/1000)+'%';
 $('vehicle-service-runs').textContent=v.serviceRuns.toLocaleString('ko-KR')+' / 1,000회';
 $('vehicle-service-bar').style.width=(v.serviceRuns/10)+'%';
 $('vehicle-remaining').textContent=currencyUnits(v.remaining);
 $('vehicle-share').textContent=(100*vehicleEquity(v)).toFixed(2)+'%';
 $('vehicle-share-bar').style.width=(100*vehicleEquity(v))+'%';
 $('vehicle-price-paid').textContent=currencyUnits(v.price);
 $('vehicle-repair-price').textContent=currencyUnits(repairCost(v));
 $('vehicle-repair-action').disabled=vehicleBusy||!!v.activeMissionId||v.serviceRuns<1000||v.durability===0||commonFunds.balance<repairCost(v);
 $('vehicle-dispatch').disabled=vehicleBusy||!vehicleDispatchAvailable(v);
 $('vehicle-dispatch').textContent=v.activeMissionId?'운행 중':!allowsAcceptedMissions()?'관람형 · 수락형 운행 불가':v.serviceRuns>=1000?'수리 후 운행 가능':!v.durability?'내구도 소진':'새 승객 임무 시작';
 $('vehicle-sale-price').textContent=currencyUnits(v.newPrice/2);
 const net=v.newPrice/2-v.remaining;
 $('vehicle-sale-net').textContent=(net<0?'-':'+')+currencyUnits(Math.abs(net));
 $('vehicle-sale-action').disabled=vehicleBusy||!!v.activeMissionId||commonFunds.balance+net<0;
 const n=Number($('vehicle-repay-input').value),unitValue=Math.round(n*10000);
 const valid=Number.isFinite(n)&&n>0&&Math.abs(n*10000-unitValue)<0.00001&&unitValue<=v.remaining&&unitValue<=commonFunds.balance;
 $('vehicle-repay-action').disabled=vehicleBusy||!valid;
 $('vehicle-repay-next').textContent=valid?((1-(v.remaining-unitValue)/v.price)*100).toFixed(2)+'%':'—';
}
async function buyOwnedVehicle(){
 if(vehicleBusy||!ready||!ownedGarage)return;
 const selected=vehicleBuySelection();
 const pct=Number($('vehicle-support').value);
 if(!Number.isInteger(pct)||pct<0||pct>90||ownedGarage.vehicles.length>=MAX_OWNED_VEHICLES)return;
 const subsidy=Math.round(selected.price*pct/100),self=selected.price-subsidy;
 if(commonFunds.balance<self)return;
 vehicleBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);
  advance(now);
  if(commonFunds.balance<self)return;
  const id=ownedGarage.nextId++,fleetNo=fleetNextNumber();
  ownedGarage.vehicles.push({id,fleetNo,model:selected.model.key,origin:selected.origin,newPrice:selected.newPrice,
   price:selected.price,remaining:subsidy,durability:selected.durability,
   serviceRuns:0,trips:0,location:'차량 출고지',activeMissionId:0});
  commonFunds.balance-=self;
  recordFinanceTransaction('vehicle-purchase',-self,now,id);
  vehicleSelectedId=id;vehicleTab='owned';dirty=true;
  await save(now);setVehicleMessage('택시 '+id+'호차를 구매했습니다.');
 }finally{vehicleBusy=false;draw(Math.floor(Date.now()/1000));}
}
async function dispatchOwnedVehicle(){
 const v=vehicleById(vehicleSelectedId);
 if(vehicleBusy||!ready||!vehicleDispatchAvailable(v))return;
 vehicleBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);
  if(!vehicleDispatchAvailable(v))return;
  const job=makeOwnedTrip(v,now);
  state.units.push(job);v.activeMissionId=job.id;dirty=true;
  await save(now);setVehicleMessage('택시 '+v.id+'호차: '+km(job.passengerMeters)+' 승객 운행을 시작했습니다.');
 }finally{vehicleBusy=false;draw(Math.floor(Date.now()/1000));}
}
async function repayOwnedVehicle(){
 const v=vehicleById(vehicleSelectedId),n=Number($('vehicle-repay-input').value);
 const amount=Math.round(n*10000);
 if(vehicleBusy||!v||['city','event'].includes(v.origin)||!Number.isFinite(n)||n<=0||Math.abs(n*10000-amount)>=0.00001||
  amount>v.remaining||amount>commonFunds.balance)return;
 vehicleBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);
  if(amount>v.remaining||amount>commonFunds.balance)return;
  commonFunds.balance-=amount;v.remaining-=amount;
  recordFinanceTransaction('vehicle-repayment',-amount,now,v.id);
  dirty=true;await save(now);
  setVehicleMessage('중도상환 완료. 내 수익 지분이 증가했습니다.');
 }finally{vehicleBusy=false;draw(Math.floor(Date.now()/1000));}
}
async function repairOwnedVehicle(){
 const v=vehicleById(vehicleSelectedId);
 if(vehicleBusy||!v||['city','event'].includes(v.origin)||v.activeMissionId||v.serviceRuns<1000||v.durability<=0)return;
 const fee=repairCost(v);
 if(commonFunds.balance<fee)return;
 vehicleBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);
  if(commonFunds.balance<fee)return;
  commonFunds.balance-=fee;v.serviceRuns=0; // permanent durability is NEVER restored
  recordFinanceTransaction('vehicle-repair',-fee,now,v.id);
  dirty=true;await save(now);setVehicleMessage('수리 완료. 내구도는 회복되지 않습니다.');
 }finally{vehicleBusy=false;draw(Math.floor(Date.now()/1000));}
}
async function sellOwnedVehicle(){
 const v=vehicleById(vehicleSelectedId);
 if(vehicleBusy||!v||['city','event'].includes(v.origin)||v.activeMissionId)return;
 const gross=v.newPrice/2,net=gross-v.remaining;
 if(commonFunds.balance+net<0){setVehicleMessage('미상환 지원금을 정산할 공용자금이 부족합니다.');return;}
 if(!$('vehicle-sale-confirm').hidden)return;
 $('vehicle-sale-confirm').hidden=false;
}
async function confirmVehicleSale(){
 const v=vehicleById(vehicleSelectedId);
 if(vehicleBusy||!v||['city','event'].includes(v.origin)||v.activeMissionId)return;
 const gross=v.newPrice/2,net=gross-v.remaining;
 if(commonFunds.balance+net<0)return;
 vehicleBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);
  if(commonFunds.balance+net<0)return;
  commonFunds.balance+=net;
  recordFinanceTransaction('vehicle-sale',gross,now,v.id);
  if(v.remaining)recordFinanceTransaction('vehicle-sale-payoff',-v.remaining,now,v.id);
  ownedGarage.vehicles=ownedGarage.vehicles.filter(x=>x.id!==v.id);
  vehicleSelectedId=ownedGarage.vehicles[0]?.id||0;dirty=true;
  $('vehicle-sale-confirm').hidden=true;
  await save(now);setVehicleMessage('판매 완료. 차량이 보유 목록에서 제거됐습니다.');
 }finally{vehicleBusy=false;draw(Math.floor(Date.now()/1000));}
}
// The mission board owns all waiting taxi cards. No vehicle-operation panel or
// vehicle selector is exposed; an accepted car returns here after settlement.
const MYON_TAXI_PRICE=20000000;
let fleetBusy=false;
function taxiPurchaseTerms(){
 const rate=Math.min(100,levelRevenue()),player=Math.floor(MYON_TAXI_PRICE*rate/100);
 return {rate,player,city:MYON_TAXI_PRICE-player,price:MYON_TAXI_PRICE};
}
function formatManwon(value){return Math.floor(value/M_UNITS).toLocaleString('ko-KR')+'만원';}
function renderTaxiWaiting(){
 if(activeWorld()!=='taxi')return;
 const holder=$('taxi-vehicle-waiting');
 if(!holder||!ownedGarage)return;
 const idle=ownedGarage.vehicles.filter(v=>!v.activeMissionId)
  .sort((a,b)=>(a.fleetNo||a.id)-(b.fleetNo||b.id));
 const signature=idle.map(v=>v.id+':'+(v.fleetNo||v.id)).join(',');
 if(renderTaxiWaiting.signature!==signature){
  const nodes=document.createDocumentFragment(),keep=new Set();
  for(const v of idle){
   keep.add(v.id);
   let slot=waitingVehicleCards.get(v.id);
   if(!slot){
    const card=element('article','slot taxi-waiting');
    const head=element('div','slot-head'),name=element('div','slot-name');
    name.append(element('span','slot-icon','🚕'),
     element('strong','','택시'+(v.fleetNo||v.id)+'호'));
    head.append(name,element('span','slot-state','대기중'));
    const details=element('div','slot-details'),metric=element('span','slot-metric');
    const accept=element('button','slot-button','수락');
    accept.type='button';
    accept.addEventListener('click',()=>acceptWaitingTaxi(v.id));
    details.append(metric,accept);card.append(head,details);
    slot={card,metric,accept};
    waitingVehicleCards.set(v.id,slot);
   }
   nodes.appendChild(slot.card);
  }
  holder.replaceChildren(nodes);
  for(const key of waitingVehicleCards.keys())if(!keep.has(key))waitingVehicleCards.delete(key);
  renderTaxiWaiting.signature=signature;
 }
 for(const v of idle){
  const slot=waitingVehicleCards.get(v.id);
  slot.metric.textContent=(v.origin==='event'?'리뉴얼 이벤트':v.origin==='city'?'시지원':'구입 차량')+
   ' · 최대 '+levelMaxKm()+'km · '+levelRateText();
  slot.accept.disabled=fleetBusy||!vehicleDispatchAvailable(v);
 }
}
async function acceptWaitingTaxi(vehicleId){
 if(activeWorld()!=='taxi')return;
 const car=vehicleById(vehicleId);
 if(fleetBusy||!ready||resetBusy||!vehicleDispatchAvailable(car))return;
 fleetBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);
  advance(now);
  const vehicle=vehicleById(vehicleId);
  if(!vehicleDispatchAvailable(vehicle))return;
  const trip=makeOwnedTrip(vehicle,now);
  state.units.push(trip);vehicle.activeMissionId=trip.id;dirty=true;
  await save(now);
 }finally{
  fleetBusy=false;
  draw(Math.floor(Date.now()/1000));
 }
}
function drawTaxiPurchase(){
 if(!ownedGarage||!taxiLevel||!commonFunds)return;
 const terms=taxiPurchaseTerms(),total=ownedGarage.vehicles.length;
 const cityCount=ownedGarage.vehicles.filter(v=>v.origin==='city').length;
 const eventCount=ownedGarage.eventGranted||0;
 $('taxi-event-status').textContent=eventCount===2?
  '리뉴얼 이벤트 · MYON 택시 2대 무상 지급 완료':
  '리뉴얼 이벤트 · '+eventCount+' / 2대 지급'+(total>=MAX_OWNED_VEHICLES?' · 보유 한도 내 추가 지급 대기':'');
 $('taxi-purchase-count').textContent='전체 '+total+' / 50대 · 시지원 '+cityCount+' / 10 · 이벤트 '+(ownedGarage.eventGranted||0)+' / 2';
 $('taxi-purchase-player').textContent='내 부담 '+terms.rate+'% · '+formatManwon(terms.player);
 $('taxi-purchase-city').textContent='시지원 '+(100-terms.rate)+'% · '+formatManwon(terms.city);
 const button=$('taxi-purchase-action');
 button.textContent='차량 구입 · '+formatCommonFunds(terms.player);
 button.disabled=fleetBusy||resetBusy||total>=MAX_OWNED_VEHICLES||commonFunds.balance<terms.player;
 if(total>=MAX_OWNED_VEHICLES)$('taxi-purchase-note').textContent='총 50대 상한에 도달했습니다.';
 else if(commonFunds.balance<terms.player)$('taxi-purchase-note').textContent='구입 자금이 부족합니다.';
 else if(!$('taxi-purchase-note').textContent.startsWith('택시'))
  $('taxi-purchase-note').textContent='구입 완료 시 임무판에 대기 차량으로 추가됩니다.';
}
async function buyTaxiFleet(){
 if(activeWorld()!=='taxi')return;
 if(fleetBusy||!ready||resetBusy||!ownedGarage||!taxiLevel||!commonFunds)return;
 const terms=taxiPurchaseTerms();
 if(ownedGarage.vehicles.length>=MAX_OWNED_VEHICLES||commonFunds.balance<terms.player)return;
 const no=fleetNextNumber();if(!no)return;
 fleetBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);
  advance(now);grantCityVehicles();
  if(ownedGarage.vehicles.length>=MAX_OWNED_VEHICLES||commonFunds.balance<terms.player)return;
  const actualNo=fleetNextNumber();if(!actualNo)return;
  const id=ownedGarage.nextId++;
  ownedGarage.vehicles.push({
   id,fleetNo:actualNo,model:'myon',origin:'new',
   newPrice:terms.price,price:terms.price,remaining:0,
   citySupportUnits:terms.city,playerPaidUnits:terms.player,purchaseRate:terms.rate,
   durability:100000,serviceRuns:0,trips:0,location:'차량 출고지',activeMissionId:0
  });
  commonFunds.balance-=terms.player;
  recordFinanceTransaction('vehicle-purchase',-terms.player,now,id);
  dirty=true;
  await save(now);
  $('taxi-purchase-note').textContent='택시'+actualNo+'호 구입 완료 · 임무판 대기중';
 }finally{
  fleetBusy=false;
  draw(Math.floor(Date.now()/1000));
 }
}
function initTaxiPurchaseUi(){
 $('taxi-purchase-action').addEventListener('click',buyTaxiFleet);
}
initTaxiPurchaseUi();

function initOwnedVehicleUi(){
 const models=$('vehicle-model');
 for(const m of TAXI_MODELS){const option=document.createElement('option');option.value=m.key;option.textContent=m.name;models.appendChild(option);}
 const used=$('vehicle-used');
 for(const stock of USED_MARKET){
  const model=TAXI_MODELS.find(m=>m.key===stock.model),option=document.createElement('option');
  option.value=stock.id;option.textContent=model.name+' · 내구도 '+(stock.durability/1000)+'%';
  used.appendChild(option);
 }
 $('vehicle-tab-owned').addEventListener('click',()=>{vehicleTab='owned';drawVehicles();});
 $('vehicle-tab-buy').addEventListener('click',()=>{vehicleTab='buy';drawVehicles();});
 $('vehicle-buy-new').addEventListener('click',()=>{vehicleBuyType='new';drawVehicleBuy();});
 $('vehicle-buy-used').addEventListener('click',()=>{vehicleBuyType='used';drawVehicleBuy();});
 for(const name of ['vehicle-model','vehicle-used','vehicle-support'])$(name).addEventListener('input',drawVehicleBuy);
 $('vehicle-owned-select').addEventListener('change',e=>{vehicleSelectedId=Number(e.target.value);$('vehicle-sale-confirm').hidden=true;drawVehicles();});
 $('vehicle-repay-input').addEventListener('input',drawVehicles);
 $('vehicle-buy-action').addEventListener('click',buyOwnedVehicle);
 $('vehicle-dispatch').addEventListener('click',dispatchOwnedVehicle);
 $('vehicle-repay-action').addEventListener('click',repayOwnedVehicle);
 $('vehicle-repair-action').addEventListener('click',repairOwnedVehicle);
 $('vehicle-sale-action').addEventListener('click',sellOwnedVehicle);
 $('vehicle-sale-cancel').addEventListener('click',()=>{$('vehicle-sale-confirm').hidden=true;});
 $('vehicle-sale-confirm-action').addEventListener('click',confirmVehicleSale);
}
initOwnedVehicleUi();


// MYON v0.13.41 — separate world cycles, truck contracts, persistent vehicle pools.
const TRUCK_MODELS=[
 {key:'cargo1',name:'1톤 카고트럭',price:20000000,maxKm:200,kind:'cargo'},
 {key:'medium',name:'중형 카고트럭',price:50000000,maxKm:500,kind:'cargo'},
 {key:'large',name:'대형 카고트럭',price:120000000,maxKm:10000,kind:'cargo'},
 {key:'tractor',name:'트랙터',price:180000000,maxKm:10000,kind:'trailer'}
];
const TRUCK_CITIES=['하린','세온','미르','라온','노아','다온','서린','유안','가온','해온','온빛','나루','아라','새별','한울','바람'];
const TRUCK_JOB_NAMES={outsource:'외주 운송',cargo:'카고 운송',single:'단일 트레일러',double:'더블 트레일러',triple:'트리플 트레일러',quad:'4중 트레일러'};
const TRUCK_JOB_MULT={outsource:1,cargo:1,single:1,double:2,triple:3,quad:4};
const TRUCK_REWARD_PHASES=[
 {from:8,to:40,first:'revenue'},
 {from:42,to:50,first:'revenue'},
 {from:52,to:60,first:'distance'},
 {from:62,to:70,first:'revenue'},
 {from:72,to:Infinity,first:'distance'}
];
function truckRewardType(n){
 if(n===2)return 'medium';if(n===5)return 'large';
 if(n===41)return 'double';if(n===51)return 'triple';
 if(n===61)return 'quad';if(n===71)return 'custom';
 if(n===3||n===6)return 'revenue';if(n===4||n===7)return 'distance';
 const p=TRUCK_REWARD_PHASES.find(p=>n>=p.from&&n<=p.to);
 return p?((n-p.from)%2===0?p.first:(p.first==='revenue'?'distance':'revenue')):null;
}
function truckRewardCount(kind,l){
 let n=0;if(kind==='revenue')n+=(l>=3?1:0)+(l>=6?1:0);
 if(kind==='distance')n+=(l>=4?1:0)+(l>=7?1:0);
 for(const phase of TRUCK_REWARD_PHASES){
  const count=Math.max(0,Math.min(l,phase.to)-phase.from+1);
  n+=Math.floor(count/2)+(count%2&&phase.first===kind?1:0);
 }
 return n;
}
function truckLevelNumber(){return truckGarage?Math.floor(truckGarage.completed/100)+1:1;}
function truckRevenue(l=truckLevelNumber()){return 40+truckRewardCount('revenue',l);}
function truckMaxKm(l=truckLevelNumber()){return Math.min(10000,100+truckRewardCount('distance',l)*50);}
function truckNextReward(l=truckLevelNumber()){
 const n=l+1,type=truckRewardType(n);
 if(type==='medium')return '중형 카고트럭 1대 시지원';
 if(type==='large')return '대형 카고트럭 1대 시지원 · 차량지원 종료';
 if(type==='double')return '더블 트레일러 지원 · ×2 운송';
 if(type==='triple')return '트리플 트레일러 임무 추가 · ×3 운송';
 if(type==='quad')return '4중 트레일러 임무 추가 · ×4 운송';
 if(type==='custom')return '커스텀 트레일러 구성 해금 · 세부 설계 예정';
 if(type==='revenue')return '트럭 수익률 +1%p → '+truckRevenue(n)+'%';
 if(type==='distance')return truckMaxKm(n)>=10000?'최대 운송거리 10,000km 유지':'최대 운송거리 +50km → '+truckMaxKm(n).toLocaleString('ko-KR')+'km';
 return '성장 보상 준비 중';
}
function drawTruckLevel(){
 if(!truckGarage)return;
 const lv=truckLevelNumber(),n=truckGarage.completed%100;
 $('world-level-label').textContent='트럭 운영 레벨';
 $('taxi-level').textContent='LV.'+lv.toLocaleString('ko-KR');
 $('taxi-next-remaining').textContent=(100-n)+'건';
 $('taxi-level-progress').style.width=n+'%';
 $('taxi-level-count').textContent='누적 완료 '+truckGarage.completed.toLocaleString('ko-KR')+'건';
 $('taxi-level-current').textContent='수익률 '+truckRevenue(lv)+'% · 최대 '+truckMaxKm(lv).toLocaleString('ko-KR')+'km';
 $('taxi-next-reward').textContent=truckNextReward(lv);
 $('taxi-level-details').hidden=false;
 $('level-future-summary').textContent='트럭 보상 전체보기 · 이후 100레벨';
 $('level-infinite-title').textContent='거리 10,000km까지 성장';
 $('level-infinite-note').textContent='레벨별 +1%p / +50km 반복 · LV.71 커스텀 구성은 추후 설계';
 renderTaxiFutureRewards();
}
function defaultWorldProgress(){return {schema:1,active:'taxi',visited:{taxi:true,truck:false},cycles:{taxi:1,truck:0},seen:{taxi:0,truck:0}};}
function validWorldProgress(x){
 return Boolean(x&&x.schema===1&&['taxi','truck'].includes(x.active)&&x.visited&&x.visited.taxi===true&&typeof x.visited.truck==='boolean'&&x.cycles&&x.seen&&
 ['taxi','truck'].every(k=>Number.isSafeInteger(x.cycles[k])&&x.cycles[k]>=0&&Number.isSafeInteger(x.seen[k])&&x.seen[k]>=0));
}
function defaultTruckGarage(){return {schema:1,completed:0,nextId:1,eventGranted:0,cityGranted:{medium:false,large:false},vehicles:[]};}
function validTruckGarage(x){
 const ids=new Set();
 return Boolean(x&&x.schema===1&&Number.isSafeInteger(x.completed)&&x.completed>=0&&Number.isSafeInteger(x.nextId)&&x.nextId>=1&&
 Number.isSafeInteger(x.eventGranted)&&x.eventGranted>=0&&x.eventGranted<=2&&x.cityGranted&&typeof x.cityGranted.medium==='boolean'&&typeof x.cityGranted.large==='boolean'&&
 Array.isArray(x.vehicles)&&x.vehicles.length<=50&&x.vehicles.every(v=>{
  if(!v||!Number.isSafeInteger(v.id)||v.id<1||v.id>=x.nextId||ids.has(v.id)||!TRUCK_MODELS.some(m=>m.key===v.model))return false;
  ids.add(v.id);return ['event','city','new'].includes(v.origin)&&Number.isSafeInteger(v.newPrice)&&v.newPrice>=0&&Number.isSafeInteger(v.activeMissionId)&&v.activeMissionId>=0&&Number.isSafeInteger(v.trips)&&v.trips>=0;
 }));
}
function defaultTruckOffers(){return {schema:1,seed:seedNow(),nextId:1,offers:[]};}
function validTruckOffers(x){return Boolean(x&&x.schema===1&&Number.isInteger(x.seed)&&Number.isSafeInteger(x.nextId)&&x.nextId>=1&&
 Array.isArray(x.offers)&&x.offers.length<=5&&x.offers.every(v=>v&&Number.isSafeInteger(v.id)&&v.id>0&&v.id<x.nextId&&
 Object.hasOwn(TRUCK_JOB_NAMES,v.type)&&Number.isInteger(v.distanceKm)&&v.distanceKm>=20&&v.distanceKm<=10000&&
 TRUCK_CITIES.includes(v.from)&&TRUCK_CITIES.includes(v.to)&&v.from!==v.to));}
async function startWorldState(){
 worldProgress=defaultWorldProgress();truckGarage=defaultTruckGarage();truckOffers=defaultTruckOffers();
 if(!IS_LIVE)return;
 try{
  const [world,garage,offers]=await Promise.all([read(WORLD_KEY),read(TRUCK_GARAGE_KEY),read(TRUCK_OFFERS_KEY)]);
  if(world){if(!validWorldProgress(world))throw Error('Invalid saved world state');worldProgress=world;}else dirty=true;
  if(garage){if(!validTruckGarage(garage))throw Error('Invalid saved truck garage');truckGarage=garage;}else dirty=true;
  if(offers){if(!validTruckOffers(offers))throw Error('Invalid saved truck offers');truckOffers=offers;}else dirty=true;
 }catch(e){console.error('MYON world-state read:',e);throw e;}
 // Legacy already-running taxi jobs belong to the first preserved taxi cycle.
 for(const v of state.units)if(v.kind==='taxi'&&!v.worldCycle){v.worldCycle=worldProgress.cycles.taxi;dirty=true;}
}
function truckVehicleById(id){return truckGarage?.vehicles.find(v=>v.id===id);}
function truckAddVehicle(modelKey,origin){
 const model=TRUCK_MODELS.find(m=>m.key===modelKey);
 if(!model||!truckGarage||truckGarage.vehicles.length>=50)return false;
 truckGarage.vehicles.push({id:truckGarage.nextId++,model:model.key,origin,newPrice:model.price,activeMissionId:0,trips:0});dirty=true;return true;
}
function grantTruckEvent(){
 if(activeWorld()!=='truck'||!truckGarage)return;
 for(const [index,key] of [[0,'cargo1'],[1,'tractor']]){
  if(truckGarage.eventGranted<=index&&truckAddVehicle(key,'event'))truckGarage.eventGranted=index+1;
 }
}
function grantTruckCity(){
 if(activeWorld()!=='truck'||!truckGarage)return;
 for(const [level,key] of [[2,'medium'],[5,'large']]){
  if(truckLevelNumber()>=level&&!truckGarage.cityGranted[key]&&truckAddVehicle(key,'city'))truckGarage.cityGranted[key]=true;
 }
}
function recallWorldVehicles(from){
 if(from==='taxi'){
  for(const v of ownedGarage.vehicles)if(v.origin==='city'&&v.activeMissionId)v.recallAfterMission=true;
  ownedGarage.vehicles=ownedGarage.vehicles.filter(v=>v.origin!=='city'||v.activeMissionId);
 }else{
  for(const v of truckGarage.vehicles)if(v.origin==='city'&&v.activeMissionId)v.recallAfterMission=true;
  truckGarage.vehicles=truckGarage.vehicles.filter(v=>v.origin!=='city'||v.activeMissionId);
  truckGarage.cityGranted={medium:false,large:false};
 }dirty=true;
}
function unlockedTruckTypes(){
 const lv=truckLevelNumber(),all=['outsource','cargo','single'];
 if(lv>=41)all.push('double');if(lv>=51)all.push('triple');if(lv>=61)all.push('quad');
 return all;
}
function generateTruckOffer(){
 const id=truckOffers.nextId++,seed=mix((truckOffers.seed+Math.imul(id,0x9e3779b9))>>>0);
 const types=unlockedTruckTypes(),type=types[range(seed,0,0,types.length-1)];
 const a=range(seed,1,0,TRUCK_CITIES.length-1);
 let b=range(seed,2,0,TRUCK_CITIES.length-2);if(b>=a)b++;
 const distanceKm=range(seed,3,0,99)<65?range(seed,4,20,Math.max(20,truckMaxKm())):range(seed,5,20,10000);
 return {id,type,from:TRUCK_CITIES[a],to:TRUCK_CITIES[b],distanceKm};
}
function truckEligibleVehicle(offer){
 if(offer.type==='outsource')return null;
 const kind=offer.type==='cargo'?'cargo':'trailer';
 return truckGarage.vehicles.filter(v=>!v.activeMissionId&&!v.recallAfterMission).map(v=>({v,model:TRUCK_MODELS.find(m=>m.key===v.model)}))
  .filter(x=>x.model.kind===kind&&x.model.maxKm>=offer.distanceKm).sort((a,b)=>a.model.maxKm-b.model.maxKm||a.v.id-b.v.id)[0]?.v||null;
}
function canAcceptTruck(offer){
 return activeWorld()==='truck'&&offer.distanceKm<=truckMaxKm()&&unlockedTruckTypes().includes(offer.type)&&
 (offer.type==='outsource'||!!truckEligibleVehicle(offer))&&state.units.length<MAX_TOTAL&&ownedActiveCount()<INVOLVED_MAX_MISSIONS;
}
function fillTruckOffers(){
 if(activeWorld()!=='truck'||!truckOffers)return;
 while(truckOffers.offers.length<5&&truckOffers.nextId<Number.MAX_SAFE_INTEGER){truckOffers.offers.push(generateTruckOffer());dirty=true;}
 if(truckOffers.offers.length===5&&!truckOffers.offers.some(canAcceptTruck)&&state.units.length<MAX_TOTAL&&ownedActiveCount()<INVOLVED_MAX_MISSIONS){
  const o=generateTruckOffer();o.type='outsource';o.distanceKm=range(mix(truckOffers.seed^o.id),8,20,Math.max(20,truckMaxKm()));
  truckOffers.offers[4]=o;dirty=true;
 }
}
function truckTravelSeconds(distanceKm){return Math.max(900,Math.ceil(distanceKm*3600/65));}
function makeTruckContract(offer,vehicle,now){
 const seed=mix((truckOffers.seed^Math.imul(offer.id,0x85ebca6b))>>>0);
 const gross=offer.distanceKm*2000,rate=truckRevenue(),mult=TRUCK_JOB_MULT[offer.type],share=Math.floor(gross*rate*mult/100);
 const phases=offer.type==='outsource'?[['prep',300],['outbound',truckTravelSeconds(offer.distanceKm)],['deliver',300]]:
 offer.type==='cargo'?[['load',900],['outbound',truckTravelSeconds(offer.distanceKm)],['unload',600]]:
 [['attach',600],['outbound',truckTravelSeconds(offer.distanceKm)],['detach',600]];
 let cursor=now;
 const stages=phases.map(([phase,duration])=>{const start=cursor;cursor+=duration;return {phase,start,end:cursor,distance:phase==='outbound'?offer.distanceKm*1000:0};});
 const model=vehicle&&TRUCK_MODELS.find(m=>m.key===vehicle.model);
 const displayName=vehicle?model.name+' '+vehicle.id+'호 · '+TRUCK_JOB_NAMES[offer.type]:'MYON 외주 트럭';
 return {id:state.nextId++,seed,kind:'truck',truckContractVersion:1,worldCycle:worldProgress.cycles.truck,
 contractType:vehicle?'owned':'outsource',dispatch:'accepted',vehicleId:vehicle?.id||0,
 displayName,type:offer.type,from:offer.from,to:offer.to,distanceKm:offer.distanceKm,rate,multiplier:mult,
 fareUnits:gross,shareUnits:share,start:now,end:cursor,stages};
}
async function acceptTruckOffer(id){
 if(!ready||worldSwitchBusy||resetBusy||activeWorld()!=='truck')return;
 const offer=truckOffers.offers.find(x=>x.id===id);if(!offer)return;
 const now=Math.floor(Date.now()/1000);advance(now);
 if(!canAcceptTruck(offer)){draw(now);return;}
 const vehicle=truckEligibleVehicle(offer),task=makeTruckContract(offer,vehicle,now);
 state.units.push(task);if(vehicle)vehicle.activeMissionId=task.id;
 truckOffers.offers=truckOffers.offers.filter(x=>x.id!==id);fillTruckOffers();dirty=true;
 await save(now);draw(Math.floor(Date.now()/1000));
}
function finishTruckTrip(v,at){
 if(!commonFunds||!Number.isSafeInteger(v.shareUnits)||v.shareUnits<0||!Number.isSafeInteger(commonFunds.balance+v.shareUnits))return;
 commonFunds.balance+=v.shareUnits;
 recordFinanceTransaction(v.contractType==='outsource'?'truck-outsource':'truck-owned',v.shareUnits,at,v.id);
 const car=truckVehicleById(v.vehicleId);
 if(car&&car.activeMissionId===v.id){car.activeMissionId=0;car.trips++;
  if(car.origin==='city'&&car.recallAfterMission)truckGarage.vehicles=truckGarage.vehicles.filter(x=>x.id!==car.id);
 }dirty=true;
}
function truckMissionText(v){
 return v.from+' → '+v.to+' · '+v.distanceKm.toLocaleString('ko-KR')+'km · 수익률 '+v.rate+'%'+
 (v.multiplier>1?' × '+v.multiplier:'')+' · 정산 '+formatCommonFunds(v.shareUnits);
}
function drawTruckOffers(){
 if(activeWorld()!=='truck'||!truckOffers)return;
 const holder=$('truck-offer-list'),fragment=document.createDocumentFragment();
 for(const offer of truckOffers.offers){
  const card=element('article','slot truck-offer'),head=element('div','slot-head'),name=element('div','slot-name');
  name.append(element('span','slot-icon',offer.type==='cargo'?'🚚':offer.type==='outsource'?'📦':'🚛'),element('strong','',TRUCK_JOB_NAMES[offer.type]));
  const expected=Math.floor(offer.distanceKm*2000*truckRevenue()*TRUCK_JOB_MULT[offer.type]/100);
  head.append(name,element('strong','taxi-offer-amount',formatCommonFunds(expected)));
  const details=element('div','slot-details'),copy=element('span','taxi-offer-description',
  offer.from+' → '+offer.to+' · '+offer.distanceKm.toLocaleString('ko-KR')+'km'+(TRUCK_JOB_MULT[offer.type]>1?' · ×'+TRUCK_JOB_MULT[offer.type]:''));
  const btn=element('button','slot-button',canAcceptTruck(offer)?'수락':'제한');
  btn.type='button';btn.disabled=!canAcceptTruck(offer);btn.addEventListener('click',()=>acceptTruckOffer(offer.id));
  details.append(copy,btn);card.append(head,details);fragment.append(card);
 }holder.replaceChildren(fragment);
}
let truckBuyBusy=false;
function drawTruckPurchase(){
 if(activeWorld()!=='truck'||!truckGarage||!commonFunds)return;
 const select=$('truck-purchase-model');
 if(!select.options.length)for(const m of TRUCK_MODELS){const o=document.createElement('option');o.value=m.key;o.textContent=m.name;select.append(o);}
 const model=TRUCK_MODELS.find(m=>m.key===select.value)||TRUCK_MODELS[0];
 $('truck-purchase-count').textContent='보유 '+truckGarage.vehicles.length+' / 50대';
 $('truck-event-status').textContent='신규 월드 이벤트 · 1톤 카고 + 트랙터 각 1대 · 최초 1회';
 $('truck-purchase-spec').textContent='운송거리 '+model.maxKm.toLocaleString('ko-KR')+'km 한도 · 신차 '+formatManwon(model.price);
 $('truck-purchase-action').textContent='차량 구입 · '+formatCommonFunds(model.price);
 $('truck-purchase-action').disabled=truckBuyBusy||worldSwitchBusy||truckGarage.vehicles.length>=50||commonFunds.balance<model.price;
 $('truck-purchase-note').textContent=truckGarage.vehicles.length>=50?'차량 보유 한도 50대':
 commonFunds.balance<model.price?'구입 자금이 부족합니다.':'선택한 트럭이 차량 목록에 추가됩니다.';
 const pool=element('div','truck-owned-list');
 for(const v of truckGarage.vehicles){
  const m=TRUCK_MODELS.find(m=>m.key===v.model);
  pool.append(element('span','truck-owned-chip',m.name+' '+v.id+'호 · '+(v.activeMissionId?'운행 중':v.origin==='city'?'시지원 · 대기':'대기')));
 }$('truck-owned-pool').replaceChildren(pool);
}
async function buyTruck(){
 if(truckBuyBusy||activeWorld()!=='truck'||!ready||!commonFunds||!truckGarage)return;
 const model=TRUCK_MODELS.find(m=>m.key===$('truck-purchase-model').value);
 if(!model||truckGarage.vehicles.length>=50||commonFunds.balance<model.price)return;
 truckBuyBusy=true;
 try{const now=Math.floor(Date.now()/1000);advance(now);
  if(truckGarage.vehicles.length>=50||commonFunds.balance<model.price)return;
  if(!truckAddVehicle(model.key,'new'))return;
  commonFunds.balance-=model.price;
  recordFinanceTransaction('vehicle-purchase',-model.price,now,truckGarage.nextId-1);dirty=true;await save(now);
 }finally{truckBuyBusy=false;draw(Math.floor(Date.now()/1000));}
}
function milestoneAvailable(){
 if(!worldProgress)return 0;
 const w=activeWorld(),lv=currentWorldLevel(),milestone=Math.floor(lv/10)*10;
 return milestone>=10&&milestone>worldProgress.seen[w]?milestone:0;
}
function drawWorldSwitchCard(){
 const card=$('world-switch-card'),milestone=milestoneAvailable();card.hidden=!milestone;
 if(!milestone)return;
 $('world-switch-level').textContent=(activeWorld()==='taxi'?'택시':'트럭')+' LV.'+milestone+' · 월드 전환 가능';
 $('world-switch-taxi').hidden=activeWorld()==='taxi';
 $('world-switch-truck').hidden=activeWorld()==='truck';
 $('world-switch-truck').textContent=worldProgress.visited.truck?'트럭 월드로 복귀':'트럭 월드 최초 진출';
 $('world-switch-warning').hidden=!worldSwitchTarget;
 $('world-switch-confirm').hidden=!worldSwitchTarget;
 if(worldSwitchTarget)$('world-switch-warning').textContent=(worldSwitchTarget==='taxi'?'택시':'트럭')+' 월드 LV.1부터 시작합니다. 현재 레벨 초기화, 시지원 차량 회수. 공용 자금과 진행 중 정산은 유지됩니다.';
}
async function switchWorld(target){
 if(!ready||resetBusy||worldSwitchBusy||!milestoneAvailable()||target===activeWorld()||!['taxi','truck'].includes(target))return;
 worldSwitchBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);
  const from=activeWorld();worldProgress.seen[from]=Math.floor(currentWorldLevel()/10)*10;
  recallWorldVehicles(from);
  if(from==='taxi'){taxiLevel.completed=0;taxiOffers= newTaxiOffers(now);}
  else{truckGarage.completed=0;truckGarage.cityGranted={medium:false,large:false};truckOffers=defaultTruckOffers();}
  worldProgress.active=target;worldProgress.visited[target]=true;worldProgress.cycles[target]++;worldProgress.seen[target]=0;
  if(target==='taxi'){taxiLevel.completed=0;taxiOffers=newTaxiOffers(now);grantEventVehicles();}
  else{truckGarage.completed=0;truckGarage.cityGranted={medium:false,large:false};truckOffers=defaultTruckOffers();grantTruckEvent();grantTruckCity();fillTruckOffers();}
  renderTaxiFutureRewards.key=null;renderTaxiWaiting.signature=null;renderTaxiOffers.order=null;
  worldSwitchTarget=null;assetSalePending=null;dirty=true;offersDirty=true;await save(now);
 }finally{worldSwitchBusy=false;draw(Math.floor(Date.now()/1000));}
}
function renderWorldChrome(){
 const truck=activeWorld()==='truck';
 ui.worldName.textContent=truck?'트럭 월드':'택시 월드';
 nav.home.setAttribute('aria-label',truck?'트럭 월드 홈':'택시 월드 홈');
 $('taxi-offer-list').hidden=truck;$('taxi-offer-empty').hidden=truck;$('taxi-offer-rule').hidden=truck;
 $('taxi-vehicle-waiting').hidden=truck;$('taxi-purchase-area').hidden=truck;
 $('truck-offer-list').hidden=!truck;$('truck-offer-rule').hidden=!truck;$('truck-purchase-area').hidden=!truck;
 if(!truck){
  $('level-future-summary').textContent='레벨 보상 전체보기 · LV.48까지';
  $('level-infinite-title').textContent='LV.49부터 무한 성장';
  $('level-infinite-note').textContent='매 레벨 차량 수익률 +1%p · 최대 운행거리 200km 유지';
 }
}
function saleTerms(world,vehicle){
 if(vehicle.origin==='city')return null;
 const gross=Math.floor(vehicle.newPrice*(vehicle.origin==='event'?0.25:0.5));
 const remaining=world==='taxi'?vehicle.remaining||0:0;
 return {gross,remaining,net:gross-remaining};
}
function drawWorldAssets(){
 if(!worldProgress||!ownedGarage||!truckGarage||!commonFunds)return;
 const from=activeWorld()==='taxi'?'truck':'taxi',list=from==='taxi'?ownedGarage.vehicles:truckGarage.vehicles;
 const sellable=list.filter(v=>v.origin!=='city'),area=$('world-assets-area');area.hidden=!sellable.length;
 if(!sellable.length)return;
 $('world-assets-title').textContent=(from==='taxi'?'택시':'트럭')+' 월드 보유 차량 · 유지 또는 판매';
 const fragment=document.createDocumentFragment();
 for(const v of sellable){
  const model=from==='taxi'?TAXI_MODELS.find(x=>x.key===v.model):TRUCK_MODELS.find(x=>x.key===v.model);
  const terms=saleTerms(from,v),key=from+':'+v.id,row=element('div','world-asset-row'),copy=element('div','world-asset-info');
  copy.append(element('strong','',model.name+' '+v.id+'호'),element('small','',(v.origin==='event'?'이벤트 차량':'구입 차량')+' · '+(v.activeMissionId?'운행 중 · 완료 후 판매 가능':'대기 · 유지 가능')));
  const action=element('button','slot-button',assetSalePending===key?'판매 확정':'판매 · '+formatManwon(terms.net));
  action.type='button';action.disabled=Boolean(v.activeMissionId)||worldSwitchBusy||terms.net+commonFunds.balance<0;
  action.addEventListener('click',()=>sellWorldAsset(from,v.id));row.append(copy,action);fragment.append(row);
 }$('world-assets-list').replaceChildren(fragment);
}
async function sellWorldAsset(world,id){
 if(!ready||worldSwitchBusy||activeWorld()===world)return;
 const garage=world==='taxi'?ownedGarage:truckGarage,vehicle=garage?.vehicles.find(v=>v.id===id);
 if(!vehicle||vehicle.activeMissionId||vehicle.origin==='city')return;
 const terms=saleTerms(world,vehicle);if(!terms||commonFunds.balance+terms.net<0)return;
 const key=world+':'+id;
 if(assetSalePending!==key){assetSalePending=key;drawWorldAssets();return;}
 assetSalePending=null;worldSwitchBusy=true;
 try{const now=Math.floor(Date.now()/1000);advance(now);
  const latest=garage.vehicles.find(v=>v.id===id);if(!latest||latest.activeMissionId)return;
  commonFunds.balance+=terms.net;
  recordFinanceTransaction('vehicle-sale',terms.gross,now,id);
  if(terms.remaining)recordFinanceTransaction('vehicle-sale-payoff',-terms.remaining,now,id);
  garage.vehicles=garage.vehicles.filter(v=>v.id!==id);dirty=true;await save(now);
 }finally{worldSwitchBusy=false;draw(Math.floor(Date.now()/1000));}
}
$('truck-purchase-model').addEventListener('change',drawTruckPurchase);
$('truck-purchase-action').addEventListener('click',buyTruck);
$('world-keep').addEventListener('click',async()=>{
 if(!milestoneAvailable()||worldSwitchBusy)return;
 const now=Math.floor(Date.now()/1000);worldProgress.seen[activeWorld()]=Math.floor(currentWorldLevel()/10)*10;
 worldSwitchTarget=null;dirty=true;await save(now);draw(now);
});
for(const w of ['taxi','truck'])$('world-switch-'+w).addEventListener('click',()=>{worldSwitchTarget=w;drawWorldSwitchCard();});
$('world-switch-confirm').addEventListener('click',()=>{if(worldSwitchTarget)switchWorld(worldSwitchTarget);});

// Shared funds use an isolated save record; legacy missions and progression remain untouched.
function validCommonFunds(value){
 return Boolean(value&&value.schema===1&&Number.isSafeInteger(value.balance)&&value.balance>=0);
}
async function startCommonFunds(){
 commonFunds={schema:1,balance:0};
 if(!IS_LIVE)return;
 try{
  const saved=await read(FINANCE_KEY);
  if(validCommonFunds(saved)){commonFunds=saved;return;}
  await putRecord(FINANCE_KEY,commonFunds);
 }catch(error){console.error('MYON common funds:',error);}
}
// 1 M corresponds to 10,000 smallest currency units; store integral units to avoid float drift.
const M_UNITS=10000;
function formatCommonFunds(balance){
 const whole=Math.floor(balance/M_UNITS).toLocaleString('ko-KR');
 const fraction=String(balance%M_UNITS).padStart(4,'0').replace(/0+$/,'');
 return whole+(fraction?'.'+fraction:'')+' M';
}
function drawCommonFunds(){
 if(!commonFunds)return;
 $('common-funds-amount').textContent=formatCommonFunds(commonFunds.balance);
}
function draw(now){
 const date=new Date(now*1000);
 ui.date.textContent=dateFmt.format(date).replace(/-/g,'.')+' ('+weekdayFmt.format(date)+')';
 ui.clock.textContent=timeFmt.format(date);
 drawCommonFunds();
 if(!ready)return;
 renderWorldChrome();
 $('board-accept-area').hidden=false;
 drawFinance(now);
 drawVehicles();
 drawTaxiLevel();
 renderTaxiOffers(now);
 renderTaxiWaiting();
 drawTaxiPurchase();
 drawTruckOffers();drawTruckPurchase();drawWorldAssets();drawWorldSwitchCard();
 reorder(now);
 drawAssistant(now);
 drawNotice(now);
 updateSettings(now);
 for(const v of state.units){
  const slot=cards.get(v.id);if(!slot)continue;
  if(v.kind==='route'){drawRoute(v,slot,now);continue;}
  if(v.kind==='construction'){
   const spec=constructionSpecs.find(s=>s.key===v.constructionKey);
   const stage=v.stages.find(x=>now<x.end)||v.stages[v.stages.length-1];
   const ratio=Math.max(0,Math.min(1,(stage.end-now)/(stage.end-stage.start)));
   const remainingMeters=stage.distance*ratio;
   const working=stage.phase.startsWith('work');
   slot.name.textContent=spec.name+(spec.key==='newRail'?' · '+(v.trackCount===2?'복선':'단선'):'');
   slot.status.textContent=working?'작업중':'이동중';
   slot.status.classList.toggle('waiting',!working);
   slot.left.textContent=km(remainingMeters);
   slot.right.textContent=countdown(v.end-now);
   const p=Math.max(0,Math.min(1,(now-v.start)/(v.end-v.start)));
   slot.bar.style.width=(100*p).toFixed(2)+'%';
   continue;
  }
  const info=unitPresentation(v,now);
  if(slot.ownedNote)slot.ownedNote.textContent=v.kind==='truck'&&v.truckContractVersion===1?truckMissionText(v):ownedTaxiMissionText(v);
  slot.status.textContent=info.status;
  slot.left.textContent=info.value;
  slot.right.textContent=countdown(v.end-now);
  slot.bar.style.width=(100*info.progress).toFixed(2)+'%';
 }
}
function tick(){
 const now=Math.floor(Date.now()/1000);
 if(ready&&!resetBusy){advance(now);if(activeWorld()==='taxi'){grantCityVehicles();grantEventVehicles();autoAcceptTaxiOffers(now);advanceTaxiOffers(now);}else{grantTruckEvent();grantTruckCity();fillTruckOffers();}advanceProgression(now);advanceMenu(now);if((dirty||offersDirty)&&now-lastSave>=20)save(now);
  if(progressionDirty&&now-progressionLastSave>=2)saveProgression(now);
  if(menuDirty&&now-menuLastSave>=2)saveMenu(now);}
 draw(now);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{const now=Math.floor(Date.now()/1000);if(ready&&(dirty||offersDirty))save(now);if(ready&&progressionDirty)saveProgression(now);if(ready&&menuDirty)saveMenu(now);});
(async()=>{
 const now=Math.floor(Date.now()/1000);
 let saved=null,oldVehicles=null,oldConstruction=null;
 if(!IS_LIVE){state=initial(now);await startPlayerSettings();await startCommonFunds();await startFinanceLedger(now);await startOwnedGarage();await startTaxiOffers(now);await startAssistant(now,true);purgeNonTaxiMissions();await startTaxiLevel();await startWorldState();await startProgression(now,true);await startMenu(now,true);ready=true;tick();setInterval(tick,1000);return;}
 try{
  saved=await read(KEY);
  if(!saved){oldVehicles=await read(OLD_VEHICLES);oldConstruction=await read(OLD_CONSTRUCTION);}
 }catch(e){console.error('MYON mission load:',e);}
 const firstVisit=!saved&&!oldVehicles&&!oldConstruction;
 if(saved&&validWorld(saved)){
  state=saved;
  // Upgrade existing in-progress contracts in place: preserve already worked
  // distance and the scheduled work completion, only append the return journey.
  for(const v of state.units){
   if(v.kind==='construction'&&(!Array.isArray(v.stages)||!v.stages.length)){
    scheduleConstruction(v,true);
    dirty=true;
   }
  }
 }else{state=migrate(oldVehicles,oldConstruction,now);dirty=true;}
 // Apply elapsed offline mission events before starting a NEW analysis period.
 // This prevents existing users from retroactively counting old completions.
 await startPlayerSettings();
 await startCommonFunds();
 await startFinanceLedger(now);
 await startOwnedGarage();
 await startTaxiOffers(now);
 await startAssistant(now,firstVisit);
 purgeNonTaxiMissions();
 await startTaxiLevel();
 await startWorldState();
 ready=true;
 advance(now);
 grantCityVehicles();
 grantEventVehicles();grantTruckEvent();grantTruckCity();fillTruckOffers();
 await startProgression(now,firstVisit);
 await startMenu(now,firstVisit);
 tick();
 refreshRelease();
 setInterval(refreshRelease,5*60*1000);
 if(dirty)save(now);
 setInterval(tick,1000);
})();
})();
