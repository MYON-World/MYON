// MYON v0.13.18 — assistant pinned from day one, auto-conversion at 24 hours; new research offers paused.
// Supply attempts every clock hour after any pre-existing countdown; missions retain normal completion.
(function () {
'use strict';
const DB='myon-v00804-progress',STORE='game',KEY='v01302-world',OLD_VEHICLES='v01204-world',OLD_CONSTRUCTION='v01300-construction';
const ASSISTANT_KEY='v01313-assistant',PROGRESSION_KEY='v01315-progression',MENU_KEY='v01317-bottom-nav'; // Observer and unlocks have isolated saves.
// Only the official main path can read or write the player save.
const IS_LIVE=!/(?:^|\/)(?:test|dev)(?:\/|$)/.test(location.pathname);
const HOUR=3600,DAY=86400,WEEK=7*DAY,KST=9*HOUR,MAX=30,LOOKBACK=2*DAY;
const $=id=>document.getElementById(id);
const ui={list:$('slot-list'),date:$('clock-date'),clock:$('clock-time'),supply:$('next-supply'),gear:$('top-settings-toggle'),version:$('top-version'),settings:$('settings-panel'),notify:$('notification-toggle')};
const nav={home:$('home-screen'),character:$('character-screen'),bar:$('bottom-nav'),homeButton:$('bottom-home'),characterButton:$('bottom-character')};
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
   // Do not shift the saved first countdown; align only the next supply after it fires.
   state.nextSupplyAt=nextClockHour(at);dirty=true;
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
 state={schema:2,nextId:1,nextSupplyAt:nextClockHour(now),pending:false,rng:seedNow(),units:[]};
 state.units.push(createUnit('taxi',now));return state;
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
 if(!state.units.length)state.units.push(createUnit('taxi',now));
 if(state.pending&&state.units.length<MAX&&supply(now))state.pending=false;
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


function newAssistant(now){
 return {schema:1,startedAt:now,baselineNextId:state.nextId,baselineActive:state.units.length};
}
function validAssistant(value){
 return value&&value.schema===1&&Number.isSafeInteger(value.startedAt)&&value.startedAt>0&&
  Number.isSafeInteger(value.baselineNextId)&&value.baselineNextId>0&&
  Number.isSafeInteger(value.baselineActive)&&value.baselineActive>=0&&
  value.startedAt<=Math.floor(Date.now()/1000)+60&&
  state.nextId>=value.baselineNextId&&
  state.units.length<=value.baselineActive+(state.nextId-value.baselineNextId);
}
async function startAssistant(now){
 // Load the current official world FIRST and replay its missed hours.
 // A fresh assistant begins tracking from that moment, not from old history.
 if(!IS_LIVE){assistant=newAssistant(now);return;}
 let restored=null;
 try{restored=await read(ASSISTANT_KEY);}catch(e){console.error('MYON assistant read:',e);}
 if(validAssistant(restored)){assistant=restored;return;}
 assistant=newAssistant(now);
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
 return Math.max(0,monitored-state.units.length);
}


// Assistant-gated research is kept separate from the immutable 23-type world engine.
// Offers use a separate seeded stream, so they never consume world RNG or real mission slots.
const RESEARCH=[
 {title:'비서전환',duration:HOUR,remaining:'전환 완료까지'},
 {title:'변경기록 알림서비스 연구',duration:HOUR,remaining:'연구 완료까지'},
 {title:'설정 시스템 연구',duration:DAY,remaining:'연구 완료까지'}
];
const RELEASE_DEFAULT={
 version:'0.13.15',title:'비서 시스템의 첫 번째 연구',
 entries:[
  '관전 분석이 끝나면 비서전환 임무가 랜덤으로 등장합니다.',
  '비서전환 완료 후 변경기록 알림서비스와 설정 시스템을 순서대로 연구할 수 있습니다.',
  '변경기록 알림서비스 연구 완료 시 최신 버전과 24시간 업데이트 알림이 열립니다.',
  '설정 시스템 연구를 완료하면 톱니바퀴에서 변경기록 알림을 켜고 끌 수 있습니다.'
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
function makeProgression(now){
 progression={schema:1,stage:0,mode:'waiting',rng:seedNow(),nextOfferAt:0,offerAt:0,offerEndsAt:0,acceptedAt:0,completeAt:0,
  convertedAt:0,changelogAt:0,settingsAt:0,notifyEnabled:true,noticeVersion:'',noticeAt:0};
 progression.nextOfferAt=0; // No research offers until the secretary research system resumes.
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
async function startProgression(now){
 if(!IS_LIVE){makeProgression(now);advanceProgression(now);return;}
 let restored=null;
 try{restored=await read(PROGRESSION_KEY);}catch(e){console.error('MYON progression read:',e);}
 if(validProgression(restored))progression=restored;
 else{makeProgression(now);markProgression();}
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
 function makeMenuStudy(now){
  const converted=Boolean(progression&&progression.convertedAt);
  menuStudy={schema:1,mode:'locked',rng:seedNow(),nextOfferAt:0,offerAt:0,offerEndsAt:0,acceptedAt:0,completeAt:0,unlockedAt:0};
  // New research offers are paused; existing menu unlocks are restored from saved data.
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
 async function startMenu(now){
  if(!IS_LIVE){makeMenuStudy(now);advanceMenu(now);return;}
  let saved=null;
  try{saved=await read(MENU_KEY);}catch(e){console.error('MYON menu read:',e);}
  if(validMenuStudy(saved))menuStudy=saved;else{makeMenuStudy(now);markMenu();}
  advanceMenu(now);
  if(menuDirty)saveMenu(now);
 }
 function acceptMenu(){
  // Temporarily disabled while the new menu study is not offered.
 }
 function showPage(target){
  if(target==='character'&&!(menuStudy&&menuStudy.unlockedAt))return;
  const isCharacter=target==='character';
  nav.home.hidden=isCharacter;nav.character.hidden=!isCharacter;
  nav.homeButton.classList.toggle('selected',!isCharacter);
  nav.characterButton.classList.toggle('selected',isCharacter);
  if(isCharacter){nav.homeButton.removeAttribute('aria-current');nav.characterButton.setAttribute('aria-current','page');}
  else{nav.characterButton.removeAttribute('aria-current');nav.homeButton.setAttribute('aria-current','page');}
 }
 function updateNav(){
  const unlocked=Boolean(menuStudy&&menuStudy.unlockedAt);
  nav.bar.hidden=!unlocked;
  if(!unlocked&&nav.home.hidden)showPage('home');
 }
 nav.homeButton.addEventListener('click',()=>showPage('home'));
 nav.characterButton.addEventListener('click',()=>showPage('character'));

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
 ui.version.hidden=!progression.changelogAt;
 if(progression.changelogAt){
  const latest=progression.noticeVersion&&versionCompare(progression.noticeVersion,releaseManifest.version)>0?
   progression.noticeVersion:releaseManifest.version;
  ui.version.textContent='v'+latest;
 }
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
// Read the actual mission registries; this list is informational only.
// No RNG, assignment, simulation or save-state operations belong here.
function renderMissionCatalog(){
 const holder=$('mission-catalog-list'),count=$('mission-catalog-count');
 if(!holder||!count)return;
 const routeItems=mode=>routeTypes.filter(spec=>spec.mode===mode).map(spec=>{
  const note=spec.key==='demandCharter'?'출근용·퇴근용 랜덤 · 지정 시각 1회':
   spec.key==='demandFull'?'출근·퇴근 시간대 랜덤':null;
  return {name:spec.name,note};
 });
 const unitItems=keys=>keys.map(key=>({name:unitNames[key]}));
 const groups=[
  {name:'차량·화물',items:unitItems(['taxi','truck'])},
  {name:'버스',items:routeItems('bus')},
  {name:'철도',items:routeItems('rail')},
  {name:'항공',items:unitItems(['domestic','international'])},
  {name:'해상·우주',items:unitItems(['ship','space'])},
  {name:'건설·유지보수',items:constructionSpecs.map(spec=>({
   name:spec.name,note:spec.key==='newRail'?'단선·복선 랜덤':null
  }))}
 ];
 const nodes=document.createDocumentFragment();
 let total=0;
 for(const group of groups){
  total+=group.items.length;
  const section=element('section','mission-catalog-group');
  const header=element('div','mission-catalog-group-head');
  header.append(element('strong','',group.name),element('span','',group.items.length+'종'));
  const list=element('ul','mission-catalog-items');
  for(const item of group.items){
   const row=element('li','mission-catalog-item');
   row.appendChild(element('span','',item.name));
   if(item.note)row.appendChild(element('small','mission-catalog-item-note',item.note));
   list.appendChild(row);
  }
  section.append(header,list);
  nodes.appendChild(section);
 }
 holder.replaceChildren(nodes);
 count.textContent=total+'종';
}
renderMissionCatalog();
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
 const right=element('span','slot-metric slot-operations assistant-timer');
 time.append(left,right);
 const counts=element('div','assistant-counts');
 const activeBox=element('div','assistant-stat'),completedBox=element('div','assistant-stat');
 const active=element('strong','assistant-stat-number'),completed=element('strong','assistant-stat-number');
 activeBox.append(element('span','assistant-stat-label','진행 중인 임무'),active);
 completedBox.append(element('span','assistant-stat-label','분석 후 완료 임무'),completed);
 counts.append(activeBox,completedBox);
 const bar=element('div','slot-progress');
 card.append(head,time,counts,bar);
 return {card,name:name.querySelector('strong'),tag:name.querySelector('.assistant-dev-tag'),status,left,right,active,completed,bar};
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
 // Developer tag applies to initial analysis only. '개선중' is a temporary
 // development notice and will be removed manually after improvement is done.
 slot.tag.textContent=converted?'개선중':'개발중';
 slot.status.textContent=converted?'상시 분석':'분석중';
 slot.left.textContent=converted?'임무 분석 지속중':'분석 완료까지';
 slot.right.textContent=converted?'상단 고정':hms(Math.ceil(Math.max(0,readyAt-now)));
 slot.active.textContent=state.units.length+'건';
 slot.completed.textContent=assistantCompleted()+'건';
 slot.bar.hidden=converted;
 slot.bar.style.width=converted?'100%':(100*Math.max(0,Math.min(1,(now-assistant.startedAt)/DAY))).toFixed(4)+'%';
}
function reorder(now){
 const readyAt=assistant?assistant.startedAt+DAY:Infinity;
 const list=assistant?[...state.units,{id:'assistant',kind:'assistant',end:readyAt}]:state.units.slice();
 // Existing system change notices remain visible for users who unlocked them.
 if(now>=readyAt&&noticeShown(now))list.push({id:'release',kind:'notice',end:progression.noticeAt+DAY});
 // Assistant stays pinned even before its first 24h analysis has finished.
 const priority=v=>v.kind==='assistant'?0:v.kind==='notice'?1:2;
 list.sort((a,b)=>{
  const diff=priority(a)-priority(b);
  if(diff)return diff;
  const aEnd=['assistant','notice'].includes(a.kind)?a.end:taskEnd(a);
  const bEnd=['assistant','notice'].includes(b.kind)?b.end:taskEnd(b);
  return aEnd-bEnd||(a.id-b.id);
 });
 const key=list.map(v=>v.id).join(',');
 if(reorder.key===key)return;
 const nodes=document.createDocumentFragment(),seen=new Set();
 for(const v of list){
  seen.add(v.id);
  let slot=cards.get(v.id);
  if(!slot){
   slot=v.kind==='assistant'?makeAssistantCard():v.kind==='notice'?makeNoticeCard():
    v.kind==='route'?makeRouteCard(v):v.kind==='construction'?makeConstructionCard(v):makeUnitCard(v);
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
function draw(now){
 const date=new Date(now*1000);
 ui.date.textContent=dateFmt.format(date).replace(/-/g,'.')+' ('+weekdayFmt.format(date)+')';
 ui.clock.textContent=timeFmt.format(date);
 if(!ready)return;
 reorder(now);
 drawAssistant(now);
 drawNotice(now);
 updateNav();
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
  slot.status.textContent=info.status;
  slot.left.textContent=info.value;
  slot.right.textContent=countdown(v.end-now);
  slot.bar.style.width=(100*info.progress).toFixed(2)+'%';
 }
 ui.supply.textContent=state.units.length>=MAX?state.units.length+'개 · 공급 대기':
  state.pending?'대기 임무 배정 예정':countdown(state.nextSupplyAt-now);
}
function tick(){
 const now=Math.floor(Date.now()/1000);
 if(ready){advance(now);advanceProgression(now);advanceMenu(now);if(dirty&&now-lastSave>=20)save(now);
  if(progressionDirty&&now-progressionLastSave>=2)saveProgression(now);
  if(menuDirty&&now-menuLastSave>=2)saveMenu(now);}
 draw(now);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{const now=Math.floor(Date.now()/1000);if(ready&&dirty)save(now);if(ready&&progressionDirty)saveProgression(now);if(ready&&menuDirty)saveMenu(now);});
(async()=>{
 const now=Math.floor(Date.now()/1000);
 let saved=null,oldVehicles=null,oldConstruction=null;
 if(!IS_LIVE){state=initial(now);await startAssistant(now);await startProgression(now);await startMenu(now);ready=true;tick();setInterval(tick,1000);return;}
 try{
  saved=await read(KEY);
  if(!saved){oldVehicles=await read(OLD_VEHICLES);oldConstruction=await read(OLD_CONSTRUCTION);}
 }catch(e){console.error('MYON mission load:',e);}
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
 ready=true;
 advance(now);
 await startAssistant(now);
 await startProgression(now);
 await startMenu(now);
 tick();
 refreshRelease();
 setInterval(refreshRelease,5*60*1000);
 if(dirty)save(now);
 setInterval(tick,1000);
})();
})();
