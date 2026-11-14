// MYON v0.13.53 — shared fleet, first-time support, auto contracts and update timer.
// Supply attempts every clock hour after any pre-existing countdown; missions retain normal completion.
(function () {
'use strict';
const DB='myon-v00804-progress',STORE='game',KEY='v01302-world',OLD_VEHICLES='v01204-world',OLD_CONSTRUCTION='v01300-construction';
const ASSISTANT_KEY='v01313-assistant',PROGRESSION_KEY='v01315-progression',MENU_KEY='v01317-bottom-nav'; // Original saves unchanged.
const COMPENSATION_KEY='v01348-emergency-compensation',BUS_KEY='v01352-bus-world';
const busEngine=window.MYON_BUS_ENGINE,busUi=window.MYON_BUS_UI;
if(!busEngine||!busUi)throw Error('Bus module not ready; original save protected');
const PROFILE_KEY='v01319-player-profile',PREF_KEY='v01319-play-style',FINANCE_KEY='v01322-common-funds',TAXI_OFFERS_KEY='v01323-taxi-offers',LEDGER_KEY='v01324-finance-ledger',OWNED_KEY='v01325-owned-vehicles',TAXI_LEVEL_KEY='v01337-taxi-level',WORLD_KEY='v01341-world-switch',TRUCK_GARAGE_KEY='v01341-truck-garage',TRUCK_OFFERS_KEY='v01341-truck-offers';
// Only the official main path can read or write the player save.
const IS_LIVE=!/(?:^|\/)(?:test|dev)(?:\/|$)/.test(location.pathname);
const HOUR=3600,DAY=86400,WEEK=7*DAY,KST=9*HOUR,MAX=30,MAX_TOTAL=130,LOOKBACK=2*DAY,TAXI_OFFER_INTERVAL=300,TAXI_AUTO_INTERVAL=1800;
const COMPENSATION_DURATION=7*DAY,COMPENSATION_FUNDS_UNITS=1000000000; // 100,000 M; no M_UNITS early access
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
const INVOLVED_MAX_MISSIONS=100,MAX_OWNED_VEHICLES=100;
const TAXI_UPGRADE_PRICES={distance:1000000,revenue:200000,fleet:2000000};
const SHARED_FLEET_PRICE=2000000,AUTO_MINUTE_PRICE=200000;
function sharedFleetSteps(){return Math.min(5,Math.max(0,worldProgress?.fleetUnlocks||0));}
function sharedFleetLimit(){return 50+10*sharedFleetSteps();}
function taxiAutoSteps(){return Math.min(25,taxiLevel?.upgrades?.autoMinutes||0);}
function truckAutoSteps(){return Math.min(30,truckGarage?.upgrades?.autoMinutes||0);}
function taxiAutoSeconds(){return Math.max(300,1800-60*taxiAutoSteps());}
function taxiNextAutoAt(now){return taxiAutoSteps()===25?nextFiveMinute(now):now+taxiAutoSeconds();}
function truckAutoSeconds(){return Math.max(0,1800-60*truckAutoSteps());}
function autoEarningsRate(base,steps){return Math.max(0,base-steps/5);}
function taxiAutoShare(fare,baseRate){return Math.floor(fare*(baseRate*5-taxiAutoSteps())/500);}
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
let compensation=null,compensationModalOpen=false,compensationBusy=false,compensationError='';
let busState=null,busBusy=false,worldUpgradeBusy=false;
let autoUpdateReloadLock=false;
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
// New LV.2+ manual contracts earn 50% extra on the player's 40% share.
// Never recalculate completed settlements or already-accepted active contracts.
function taxiManualShare(baseShare,lv=levelNumber()){return lv>=2?baseShare+Math.floor(baseShare/2):baseShare;}
// LV.10 MASTER stops XP growth; legacy completed records remain intact.
function levelNumber(){return taxiLevel?Math.min(10,Math.floor(taxiLevel.completed/100)+1):1;}
function taxiMaster(){return levelNumber()===10;}
function taxiUpgrades(){return taxiLevel?.upgrades||{distance:0,revenue:0,fleet:0};}
function taxiFleetLimit(){return sharedFleetLimit();}
function taxiOutsourcePercent(){return Math.max(0,100-(ownedGarage?.vehicles.length||0));}
function activeWorld(){return worldProgress?.active||'taxi';}
function currentWorldLevel(){return activeWorld()==='taxi'?levelNumber():activeWorld()==='truck'?truckLevelNumber():(busState?.level||1);}
// A single cycle table drives actual earnings, city grants, max trip distance,
// the next-level reward and the expanded level preview. Revenue grows every
// level from LV.49 onward; distance tops out at LV.48 (200 km).
const TAXI_LEVEL_RULES={
 base:{revenue:40,distanceKm:20,cityCars:0},
 steps:{revenue:1,distanceKm:10,cityCars:1},
 caps:{distanceKm:200,cityCars:3},
 previewLastLevel:10,
 milestones:{2:'auto',3:'city'},
 phases:[
  {from:4,to:10,cycle:['revenue','distance','city']}
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
 return Math.min(rules.caps.distanceKm,rules.base.distanceKm+rules.steps.distanceKm*taxiRewardCount('distance',l)+10*taxiUpgrades().distance);
}
function levelRevenue(l=levelNumber()){
 const rules=TAXI_LEVEL_RULES;
 return rules.base.revenue+rules.steps.revenue*taxiRewardCount('revenue',l)+taxiUpgrades().revenue;
}
function levelRateText(l=levelNumber()){
 const n=levelRevenue(l);
 return n<=100?'수익률 '+n+'%':'수익률 100% · 보너스 +'+(n-100)+'%';
}
function levelNextReward(l=levelNumber()){
 const n=l+1,type=taxiRewardType(n);
 if(n>10)return '마스터 · 자금으로 능력 해금';
 if(n===10)return '마스터 · 1,000 M 시스템 보상 · 수익률 43%';
 if(type==='auto')return '30분마다 외주·보유차량 자동수락 · 수동 수락 수익 +50% · 외주 폐기 없음';
 if(type==='city')return '차량 1대 지급';
 if(type==='distance')return '장거리 최대 '+levelMaxKm(n)+'km';
 if(type==='revenue'){
  const rate=levelRevenue(n);
  return '차량 수익률 +1%p → '+(rate<=100?rate+'%':'100% + 보너스 '+(rate-100)+'%');
 }
 return '다음 보상 준비 중';
}
function drawTaxiMaster(){
 $('taxi-master-summary').textContent='수익률 '+levelRevenue()+'% · 운송최대거리 '+levelMaxKm()+'km';
 const entries=[
  ['distance','운송거리 +10km',levelMaxKm()>=200,'현재 '+levelMaxKm()+'km · 최대 200km'],
  ['revenue','수익률 +1%p',levelRevenue()>=100,'현재 '+levelRevenue()+'% · 최대 100%'],
  ['fleet','차량 보유 한도 +10대',taxiFleetLimit()>=100,'현재 '+taxiFleetLimit()+'대 · 최대 100대']
 ];
 for(const [key,label,done,note] of entries){
  $('taxi-master-'+key+'-title').textContent=label;
  $('taxi-master-'+key+'-detail').textContent=note;
  const button=$('taxi-master-'+key+'-buy');
  button.textContent=done?'해금 완료':formatCommonFunds(TAXI_UPGRADE_PRICES[key]);
  button.disabled=done||fleetBusy||resetBusy||worldSwitchBusy||commonFunds.balance<TAXI_UPGRADE_PRICES[key];
 }
}
function drawTaxiLevel(){
 const master=activeWorld()==='taxi'&&taxiMaster();
 $('taxi-level-panel').hidden=master;
 $('taxi-master-panel').hidden=!master;
 $('truck-master-panel').hidden=true;
 if(activeWorld()==='truck'){drawTruckLevel();return;}
 if(!taxiLevel)return;
 if(master)drawTaxiMaster();
 else{
  $('world-level-label').textContent='택시 운영 레벨';
  const n=taxiLevel.completed%100,l=levelNumber();
  $('taxi-level').textContent='LV.'+l.toLocaleString('ko-KR');
  $('taxi-next-remaining').textContent=(100-n)+'건';
  $('taxi-level-progress').style.width=n+'%';
  $('taxi-level-count').textContent='누적 완료 '+taxiLevel.completed.toLocaleString('ko-KR')+'건';
  $('taxi-level-current').textContent=ownedGarage?.vehicles.length?levelRateText(l)+' · 최대 '+levelMaxKm(l)+'km':'외주 40% · 3~10km';
  $('taxi-next-reward').textContent=levelNextReward(l);
  $('taxi-level-details').hidden=false;renderTaxiFutureRewards();
 }
 $('taxi-offer-rule').textContent=lvlTaxiRule();
}
function lvlTaxiRule(){
 return levelNumber()>=2?'외주 5분 간격 · 수동 +50% · '+(taxiAutoSeconds()/60)+'분 자동수락 · 자동 정산 '+autoEarningsRate(40,taxiAutoSteps()).toFixed(1)+'% · 차량 100대 보유 시 외주 0%':
  '외주 5분 간격 · 수동 수락 · 미수락 시 1시간 뒤 폐기';
}
async function buyTaxiMasterUpgrade(type){
 if(!['distance','revenue','fleet'].includes(type)||!ready||resetBusy||worldSwitchBusy||
    fleetBusy||activeWorld()!=='taxi'||!taxiMaster()||!taxiLevel||!commonFunds)return;
 if(type==='fleet'){await buyWorldUpgrade('fleet');return;}
  const price=TAXI_UPGRADE_PRICES[type];
 const maxed=()=>type==='distance'?levelMaxKm()>=200:type==='revenue'?levelRevenue()>=100:taxiFleetLimit()>=100;
 if(maxed()||commonFunds.balance<price)return;
 fleetBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);
  if(maxed()||commonFunds.balance<price)return;
  commonFunds.balance-=price;taxiLevel.upgrades[type]++;
  recordFinanceTransaction('ability-unlock',-price,now,{distance:1,revenue:2,fleet:3}[type]);
  dirty=true;await save(now);
 }finally{fleetBusy=false;draw(Math.floor(Date.now()/1000));}
}
for(const type of ['distance','revenue','fleet'])$('taxi-master-'+type+'-buy').addEventListener('click',()=>buyTaxiMasterUpgrade(type));
// Only finite LV.48 milestone rewards appear in the drop-down. Beyond that,
// one immutable explanation summarizes the unlimited +1%p revenue cycle.
function renderTaxiFutureRewards(){
 const details=$('taxi-level-details');
 if(!details||!details.open||details.hidden)return;
 const level=currentWorldLevel(),world=activeWorld();
 if(renderTaxiFutureRewards.key===world+':'+level)return;
 const list=$('taxi-level-future-list'),fragment=document.createDocumentFragment();
 const last=10;
 for(let n=level+1;n<=last;n++){
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
// Preserve legacy earned revenue/distance skills without retroactively charging.
function normalizeTaxiLevel(x){
 if(!x||x.schema!==1||!Number.isSafeInteger(x.completed)||x.completed<0)return false;
 if(!x.upgrades){
  const level=Math.floor(x.completed/100)+1;
  const count=type=>{
   let n=type==='city'&&level>=3?1:0;
   const old=[{from:4,to:30,cycle:['revenue','distance','city']},
    {from:31,to:48,cycle:['revenue','distance']},{from:49,to:Infinity,cycle:['revenue']}];
   for(const phase of old){
    const steps=Math.max(0,Math.min(level,phase.to)-phase.from+1);
    n+=Math.floor(steps/phase.cycle.length)*phase.cycle.filter(t=>t===type).length;
    for(let i=0;i<steps%phase.cycle.length;i++)if(phase.cycle[i]===type)n++;
   }return n;
  };
  x.upgrades={distance:Math.max(0,Math.min(16,count('distance')-2)),
   revenue:Math.max(0,count('revenue')-3),fleet:0};
  dirty=true;
 }
 if(x.upgrades.autoMinutes===undefined){x.upgrades.autoMinutes=0;dirty=true;}
  if(!['distance','revenue','fleet'].every(k=>Number.isSafeInteger(x.upgrades[k])&&x.upgrades[k]>=0)||
    !Number.isSafeInteger(x.upgrades.autoMinutes)||x.upgrades.autoMinutes<0||x.upgrades.autoMinutes>25)return false;
 if(x.masterRewardPaid===undefined){x.masterRewardPaid=false;dirty=true;}
 return typeof x.masterRewardPaid==='boolean';
}
async function startTaxiLevel(){
 if(!IS_LIVE){taxiLevel={schema:1,completed:assistantCompleted()};normalizeTaxiLevel(taxiLevel);return;}
 try{
  const saved=await read(TAXI_LEVEL_KEY);
  if(saved){if(!normalizeTaxiLevel(saved))throw new Error('Invalid saved taxi level');taxiLevel=saved;return;}
 }catch(e){console.error('MYON level read:',e);throw e;}
 taxiLevel={schema:1,completed:assistantCompleted()};normalizeTaxiLevel(taxiLevel);dirty=true;
}
function grantTaxiMasterReward(now){
 if(!taxiLevel||!commonFunds||!taxiMaster()||taxiLevel.masterRewardPaid)return;
 const amount=1000*M_UNITS;
 if(!Number.isSafeInteger(commonFunds.balance+amount)||!financeLedger||
    !Number.isSafeInteger(financeLedger.totalIncome+amount))return;
 commonFunds.balance+=amount;taxiLevel.masterRewardPaid=true;
 recordFinanceTransaction('level-reward',amount,now,10);dirty=true;
}
function purgeNonTaxiMissions(){
 if(!state||!assistant)return;
 // Preserve real taxi AND freight contracts, including new Road Train work.
 const count=state.units.filter(v=>v.kind!=='taxi'&&v.kind!=='truck').length;
 if(!count)return;
 state.units=state.units.filter(v=>v.kind==='taxi'||v.kind==='truck');
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
 advanceRoadTrains(now);
 // Pending hourly automatic assignments are cancelled, never existing jobs.
 if(state.pending){state.pending=false;dirty=true;}
 // Keep this saved timestamp valid for compatibility without spawning jobs.
 if(state.nextSupplyAt<=now){state.nextSupplyAt=nextClockHour(now);dirty=true;}
 // Retire saved jobs by their original completion timestamp, including offline
 // work. In particular, company-owned taxis and accepted taxi contracts still pay.
 const retiring=state.units.filter(v=>(v.kind==='taxi'||(v.kind==='truck'&&(v.truckContractVersion===1||(v.truckContractVersion===2&&v.closed))))&&taskEnd(v)<=now)
  .sort((a,b)=>taskEnd(a)-taskEnd(b)||a.id-b.id);
 if(!retiring.length)return;
 for(const v of retiring){
  const at=taskEnd(v);
  if(v.kind==='taxi'&&[2,3].includes(v.taxiContractVersion)&&v.contractType==='owned')finishOwnedTrip(v,at);
  if(v.kind==='taxi'&&v.taxiContractVersion===1&&v.contractType==='outsource'&&
     Number.isSafeInteger(v.shareUnits)&&v.shareUnits>0&&commonFunds){
   const settlement=compensationSettlementAmount(v.shareUnits,at);
   const newBalance=commonFunds.balance+settlement;
   if(Number.isSafeInteger(newBalance)&&(!financeLedger||Number.isSafeInteger(financeLedger.totalIncome+settlement))){
    commonFunds.balance=newBalance;
    recordTaxiSettlement(v,at);
    recordCompensationIncome(v.shareUnits,at,v.id);
   }
  }
  if(v.kind==='taxi'&&v.contractType==='owned'&&v.vehicleId){
   const car=vehicleById(v.vehicleId);
   if(car&&car.origin==='city'&&car.recallAfterMission&&!car.activeMissionId){ownedGarage.vehicles=ownedGarage.vehicles.filter(x=>x.id!==car.id);dirty=true;}
  }
  if(v.kind==='truck'&&v.truckContractVersion===1)finishTruckTrip(v,at);
  if(v.kind==='truck'&&v.truckContractVersion===2)finishRoadTrain(v);
  if(v.kind==='taxi'&&activeWorld()==='taxi'&&v.worldCycle===worldProgress.cycles.taxi&&taxiLevel&&taxiLevel.completed<900)taxiLevel.completed++;
  if(v.kind==='truck'&&v.truckContractVersion===1&&activeWorld()==='truck'&&v.worldCycle===worldProgress.cycles.truck&&truckGarage.completed<900)truckGarage.completed++;
 }
 state.units=state.units.filter(v=>taskEnd(v)>now);
 dirty=true;
}

// Offers use real-time KST thirty-minute auto-accept slots. UTC epoch works because KST
// has a whole-hour offset; the seed never consumes the world mission RNG.
// Outsource supply and auto-accept use independent wall-clock slots.
function nextFiveMinute(at){return Math.floor(at/TAXI_OFFER_INTERVAL)*TAXI_OFFER_INTERVAL+TAXI_OFFER_INTERVAL;}
function nextAutoSlot(at,interval=TAXI_AUTO_INTERVAL){return Math.floor(at/interval)*interval+interval;}
function newTaxiOffers(now){return {schema:1,seed:seedNow(),nextOfferAt:nextFiveMinute(now),
 nextAutoAt:nextAutoSlot(now,taxiAutoSeconds()),autoInterval:taxiAutoSeconds(),offers:[]};}
function validTaxiOffers(value){
 return Boolean(value&&value.schema===1&&Number.isInteger(value.seed)&&
  Number.isSafeInteger(value.nextOfferAt)&&value.nextOfferAt>0&&
  (value.nextAutoAt===undefined||(Number.isSafeInteger(value.nextAutoAt)&&value.nextAutoAt>0))&&
  (value.autoInterval===undefined||Number.isSafeInteger(value.autoInterval)&&value.autoInterval>=300&&value.autoInterval<=1800&&value.autoInterval%60===0)&&
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
   // Preserve old unaccepted offers but switch ONLY the scheduling cursor.
   // Avoid replaying an old 10-minute slot as a new 30-minute automatic acceptance.
   const upcoming=nextFiveMinute(now);
   if(saved.nextOfferAt>upcoming){saved.nextOfferAt=upcoming;offersDirty=true;}
   if(saved.autoInterval!==taxiAutoSeconds()||!saved.nextAutoAt){
    saved.nextAutoAt=nextAutoSlot(now,taxiAutoSeconds());saved.autoInterval=taxiAutoSeconds();offersDirty=true;
   }
   return;
  }
  if(saved)throw new Error('Invalid saved taxi offers; refuse overwrite');
  offersDirty=true;
 }catch(error){console.error('MYON taxi offers:',error);throw error;}
}
function syncTaxiAutoCursor(now){
 if(!taxiOffers)return;
 const interval=taxiAutoSeconds();
 if(taxiOffers.autoInterval!==interval||
    taxiAutoSteps()===25&&taxiOffers.nextAutoAt%TAXI_OFFER_INTERVAL!==0){
  taxiOffers.autoInterval=interval;taxiOffers.nextAutoAt=taxiNextAutoAt(now);offersDirty=true;
 }
}
function advanceTaxiOffers(now){
 if(activeWorld()!=='taxi'||!taxiOffers)return;
 const previous=taxiOffers.offers.length;
 if(taxiOutsourcePercent()===0)taxiOffers.offers=[];
 else if(levelNumber()<2)taxiOffers.offers=taxiOffers.offers.filter(o=>now<o.expiresAt);
 if(previous!==taxiOffers.offers.length)offersDirty=true;
 if(now<taxiOffers.nextOfferAt)return;
 const first=Math.max(taxiOffers.nextOfferAt,nextFiveMinute(now-HOUR));
 for(let at=first;at<=now;at+=TAXI_OFFER_INTERVAL){
  const seed=mix((taxiOffers.seed^Math.imul(Math.floor(at/TAXI_OFFER_INTERVAL),0x9e3779b9))>>>0);
  if(range(seed,6,0,99)>=taxiOutsourcePercent())continue;
  const distanceMeters=range(seed,0,30,100)*100;
  const fareUnits=taxiFareUnits(distanceMeters);
  if(taxiOffers.offers.length<5000)taxiOffers.offers.push({at,expiresAt:at+HOUR,distanceMeters,fareUnits,
   shareUnits:taxiOutsourceShare(fareUnits)});
 }
 taxiOffers.nextOfferAt=nextFiveMinute(now);
 offersDirty=true;
}
// The shared 00/30-minute cursor dispatches idle owned taxis before outsource offers.
function autoAcceptOwnedTaxis(now){
 if(!ownedGarage)return false;
 let changed=false;
 for(const vehicle of ownedGarage.vehicles.slice().sort((a,b)=>(a.fleetNo||a.id)-(b.fleetNo||b.id))){
  if(!vehicleDispatchAvailable(vehicle))continue;
  const trip=makeOwnedTrip(vehicle,now,'auto');
  state.units.push(trip);vehicle.activeMissionId=trip.id;changed=true;
 }
 return changed;
}
function autoAcceptTaxiOffers(now){
 if(activeWorld()!=='taxi'||!taxiOffers)return;
 if(!Number.isSafeInteger(taxiOffers.nextAutoAt)||taxiOffers.nextAutoAt<=0){
  taxiOffers.nextAutoAt=nextAutoSlot(now,taxiAutoSeconds());taxiOffers.autoInterval=taxiAutoSeconds();offersDirty=true;return;
 }
 if(now<taxiOffers.nextAutoAt)return;
 taxiOffers.nextAutoAt=taxiNextAutoAt(now);taxiOffers.autoInterval=taxiAutoSeconds();offersDirty=true;
 if(levelNumber()<2)return;
 // Owned vehicles take priority over outsource offers within this same slot.
 let changed=autoAcceptOwnedTaxis(now);
 if(taxiOutsourcePercent()===0&&taxiOffers.offers.length){taxiOffers.offers=[];offersDirty=true;}
 // Auto-accept already waiting offers BEFORE generating the new supply.
 for(const offer of taxiOffers.offers.slice().sort((a,b)=>a.at-b.at)){
  if(state.units.length>=MAX_TOTAL||ownedActiveCount()>=INVOLVED_MAX_MISSIONS)break;
  const job=createUnit('taxi',now,null,offer);job.worldCycle=worldProgress.cycles.taxi;
  job.acceptMethod='auto'; // Freeze reduced share only on newly accepted jobs.
   job.shareUnits=taxiAutoShare(offer.fareUnits,40);
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
 if(!offer||taxiOutsourcePercent()===0||(levelNumber()<2&&now>=offer.expiresAt)||state.units.length>=MAX_TOTAL||ownedActiveCount()>=INVOLVED_MAX_MISSIONS){draw(now);return;}
 const job=createUnit('taxi',now,null,offer);job.worldCycle=worldProgress.cycles.taxi;
 // The bonus applies only to this NEW manual acceptance: never to previously accepted jobs.
 job.acceptMethod='manual';job.manualBonusUnits=taxiManualShare(offer.shareUnits)-offer.shareUnits;
 job.shareUnits=taxiManualShare(offer.shareUnits);
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
    const amount=element('strong','taxi-offer-amount',formatCommonFunds(taxiManualShare(offer.shareUnits)));
    head.append(name,amount);
    const details=element('div','slot-details'),description=element('span','taxi-offer-description',
     (offer.distanceMeters/1000).toFixed(1)+(levelNumber()>=2?'km · 수동 +50% (60%)':'km · 외주 40%'));
    const accept=element('button','slot-button','수락');accept.type='button';
    accept.addEventListener('click',()=>acceptTaxiOffer(offer.at));
    details.append(description,accept);
    const progress=element('div','slot-progress');progress.hidden=levelNumber()>=2;
    // Smooth, wall-clock-aligned animation; elapsed time is deliberately not displayed.
    progress.style.animation='taxi-offer-expiry '+HOUR+'s linear both';
    progress.style.animationDelay='-'+Math.max(0,Date.now()/1000-offer.at)+'s';
    card.append(head,details,progress);
    slot={card,accept,amount,description};offerCards.set(offer.at,slot);
   }
   const bar=slot.card.querySelector('.slot-progress');if(bar)bar.hidden=levelNumber()>=2;
   // An already-listed but unaccepted offer displays its new LV.2 manual payout after a level-up.
   slot.amount.textContent=formatCommonFunds(taxiManualShare(offer.shareUnits));
   slot.description.textContent=(offer.distanceMeters/1000).toFixed(1)+(levelNumber()>=2?'km · 수동 +50% (60%)':'km · 외주 40%');
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
// One-time, read-before-write raw restore snapshot of the prior game records.
const SAVE_RESTORE_POINT='v01347-restore-point';
const SAVE_RESTORE_POINT_48='v01348-before-compensation';
const SAVE_RESTORE_POINT_49='v01349-before-auto-update';
const SAVE_RESTORE_POINT_52='v01352-before-bus-world';
const SAVE_RESTORE_KEYS=[KEY,FINANCE_KEY,OWNED_KEY,TAXI_LEVEL_KEY,WORLD_KEY,
 TRUCK_GARAGE_KEY,TAXI_OFFERS_KEY,TRUCK_OFFERS_KEY,LEDGER_KEY,ASSISTANT_KEY,
 PROGRESSION_KEY,MENU_KEY,PROFILE_KEY,PREF_KEY,COMPENSATION_KEY,BUS_KEY];
async function preserveSaveRestorePoint(now,restoreKey=SAVE_RESTORE_POINT){
 if(!IS_LIVE)return;
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
  const existing=store.get(restoreKey);
  existing.onsuccess=()=>{
   if(existing.result)return;
   let remaining=SAVE_RESTORE_KEYS.length;const records={};
   for(const key of SAVE_RESTORE_KEYS){
    const req=store.get(key);
    req.onsuccess=()=>{
     if(req.result!==undefined)records[key]=req.result;
     if(!--remaining&&Object.keys(records).length)
      store.put({schema:1,at:now,records},restoreKey);
    };
   }
  };
  tx.oncomplete=resolve;
  tx.onerror=()=>reject(tx.error||new Error('MYON restore point failed'));
  tx.onabort=()=>reject(tx.error||new Error('MYON restore point aborted'));
 });
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
 const busSnapshot=busState?JSON.parse(JSON.stringify(busState)):null;
 const assistantSnapshot=assistant?JSON.parse(JSON.stringify(assistant)):null;
 const compensationSnapshot=compensation?JSON.parse(JSON.stringify(compensation)):null;
 lastSave=now;dirty=false;offersDirty=false;
 saveChain=saveChain.catch(()=>{}).then(async()=>{
  const db=await openDb();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   const store=tx.objectStore(STORE);
   // Prevent a stale open tab from overwriting a newly claimed reward.
   const compensationGuard=store.get(COMPENSATION_KEY);
   compensationGuard.onsuccess=()=>{
    const persisted=compensationGuard.result;
    if((persisted||compensationSnapshot)&&
       (!persisted||!compensationSnapshot||!validCompensation(persisted)||
        persisted.claimedAt!==compensationSnapshot.claimedAt)){
     tx.abort();return;
    }
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
    if(busSnapshot)store.put(busSnapshot,BUS_KEY);
   if(assistantSnapshot)store.put(assistantSnapshot,ASSISTANT_KEY);
   if(compensationSnapshot)store.put(compensationSnapshot,COMPENSATION_KEY);
   };
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||new Error('MYON world/finance/ledger/owned/offers write failed'));
   tx.onabort=()=>reject(tx.error||new Error('MYON compensation save conflict; reload required'));
  });
 }).catch(e=>{
  console.error('MYON save:',e);dirty=true;offersDirty=true;
  if(e.message&&e.message.includes('MYON compensation save conflict')){
   compensationModalOpen=true;
   compensationError='다른 탭에서 보상 데이터가 변경됐습니다. 저장 자료 보호를 위해 이 탭의 진행을 중단했습니다. 새로고침해 주세요.';
   drawCompensation(Math.floor(Date.now()/1000));
   ready=false;
  }
 });
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
 try{restored=await read(ASSISTANT_KEY);}catch(e){console.error('MYON assistant read:',e);throw e;}
 if(validAssistant(restored)){assistant=restored;return;}
 if(restored)throw new Error('Existing assistant save is invalid; refusing reset');
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
 version:'0.13.53',title:'자동수락 단축·월드 공용 차량 해금·지원 이력·업데이트 타이머 수정',
 entries:[
  '택시 30→5분, 트럭 30→즉시 자동수락: 1회 자금 해금마다 -1분 및 자동 정산율 -0.2%p (신규 임무부터 적용).',
   '택시 수동 보너스 +50% 유지, 트럭은 LV.2 이상 신규 수동 계약에 +50% 적용. 기존 계약 보상 유지.',
   '월드 공용 차량 구매 한도 50~100대(10대씩 해금), 레벨·최초 이벤트 지원은 실제 보유 100대까지 별도 지급.',
   '택시·트럭 지원 차량은 최초 레벨 달성 시 일회성 지급, 만차 지원은 빈자리까지 대기, 월드 복귀 중복 지급 방지.',
   '택시·트럭·버스 구매 차량 판매는 실제 구매가의 50%, 이벤트 무상 차량은 기존 신차기준 25%, 시 지원 차량 판매 불가.',
   '업데이트 화면 60분 카운터 진행바 누락 오류를 수정하고, 표시 오류 시에도 타이머 실행을 보호.',
   'MYON 솔라티 시지원 1대, 승객정원 15명, 기본요금 1,650원, 차량 신차 6,000만원.',
   '오전 06:00~12:00 / 오후 13:00~21:00 마지막 정류장 출발, 차고지 복귀 시 차량별 총매출 정산.',
   '정류장 간 300~800m 랜덤, 하차→승차, 누적 수송완료 1,000명 목표, LV.2 업글 준비 중 잠금.',
   'LV.1부터 차량 구매와 수익률 +1%p 영구 해금, 시지원·구입차 동일 정산율 40%부터 적용.',
   '버스 진행도·차량·해금은 별도 영구 저장, 기존 택시·트럭과 공용자금 보존.',
   '업데이트 상단 알림을 두 줄로 압축합니다. 첫 줄은 \'신규 업데이트 적용 중\'·중앙 진행률 %·오른쪽 큰 남은 시간 숫자입니다.',
  '둘째 줄에는 현재 실행 버전 → 배포된 신규 버전을 표시하고, 오른쪽에 길게 이어진 진행바를 배치합니다.',
  '남은 카운터의 \'남은\' 문구를 없애고 60:00부터 00:00까지 숫자만 크게 표시합니다.',
  '최신 배포 정보의 버전 번호를 실시간으로 읽어 실제 현재 실행 중인 버전과 신규 버전을 구분합니다.',
  '새 커밋이 배포되면 신규 버전 번호·퍼센트·남은 시간이 함께 갱신되고, 다시 60분 대기합니다.',
  '1시간 대기, 새 커밋마다 초기화, 안전한 세이브 검사 이후 자동 새로고침은 이전 버전과 동일하게 유지합니다.',
  '택시·트럭 진행 중 임무, 공용자금, 보상 잔여기간과 이전 저장 기록을 변경하지 않습니다.'
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
 try{restored=await read(PROGRESSION_KEY);}catch(e){console.error('MYON progression read:',e);throw e;}
 if(validProgression(restored))progression=restored;
 else{if(restored)throw new Error('Existing research progression invalid; refusing reset');makeProgression(now,firstVisit);markProgression();}
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
  try{saved=await read(MENU_KEY);}catch(e){console.error('MYON menu read:',e);throw e;}
  if(validMenuStudy(saved))menuStudy=saved;else{if(saved)throw new Error('Existing menu progression invalid; refusing reset');makeMenuStudy(now,firstVisit);markMenu();}
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
 ui.version.textContent='v0.13.53'; // Display the code actually loaded, not merely the latest online notice.
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
 name.append(element('span','slot-icon',unitIcons[v.kind]),element('strong','',v.kind==='truck'&&[1,2].includes(v.truckContractVersion)?v.displayName:v.contractType==='owned'?'택시'+(v.vehicleNo||vehicleById(v.vehicleId)?.fleetNo||v.vehicleId)+'호':'MYON 택시'));
 const status=element('span','slot-state');
 head.append(name,status);
 const detail=element('div','slot-details');
 const left=element('span','slot-metric'),right=element('span','slot-metric slot-operations');
 detail.append(left,right);
 const bar=element('div','slot-progress');
 const ownedNote=v.contractType==='owned'||[1,2].includes(v.truckContractVersion)?element('div','owned-taxi-note'):null;
 const bonusBadge=element('div','compensation-job-badge');bonusBadge.hidden=true;
 if(ownedNote)card.append(head,detail,ownedNote,bonusBadge,bar);
 else card.append(head,detail,bonusBadge,bar);
 return {card,status,left,right,bar,ownedNote,bonusBadge};
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
 if(v.kind==='truck'&&[1,2].includes(v.truckContractVersion)){
  const names={load:'상차 중',attach:'트레일러 연결 중',prep:'출발 준비',outbound:'운송 중',unload:'하역 중',detach:'인도 중',deliver:'배송 완료 처리'};
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
const FINANCE_CATEGORIES=['bus-operation','taxi-outsource','taxi-owned','truck-outsource','truck-owned','vehicle-purchase','vehicle-repayment','vehicle-repair','vehicle-sale','vehicle-sale-payoff','level-reward','ability-unlock','compensation-grant','compensation-income'];
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
  if(saved){if(!validFinanceLedger(saved))throw new Error('Invalid saved finance ledger');financeLedger=saved;return;}
 }catch(error){console.error('MYON finance ledger:',error);throw error;}
 // Only a genuinely absent ledger initializes for pre-ledger users.
 dirty=true;
}
function recordFinanceTransaction(category,amount,at,id){
 if(!financeLedger||!Number.isSafeInteger(amount)||amount===0)return;
 if(amount>0)financeLedger.totalIncome+=amount;
 else financeLedger.totalExpenses+=-amount;
 financeLedger.entries.unshift({id,at,category,amount});
 if(financeLedger.entries.length>FINANCE_HISTORY_LIMIT)financeLedger.entries.length=FINANCE_HISTORY_LIMIT;
}
// A separate bonus at settlement preserves every existing frozen contract.
function compensationActiveAt(at){
 return Boolean(compensation&&at>=compensation.claimedAt&&at<compensation.expiresAt);
}
function compensationExtra(base,at){
 const extra=compensationActiveAt(at)&&Number.isSafeInteger(base)&&base>0?base*2:0;
 return Number.isSafeInteger(extra)?extra:0;
}
function compensationSettlementAmount(base,at){return base+compensationExtra(base,at);}
function recordCompensationIncome(base,at,id){
 const extra=compensationExtra(base,at);
 if(extra)recordFinanceTransaction('compensation-income',extra,at,id);
}
function compensationPurchasePrice(price,at=Math.floor(Date.now()/1000)){
 return compensationActiveAt(at)?Math.floor(price/2):price;
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
   if(v.kind==='truck'&&v.truckContractVersion===2)pending+=v.trailers.reduce((a,t)=>a+t.shareUnits,0);
  if(v.kind==='taxi'&&v.taxiContractVersion===1&&v.contractType==='outsource'&&
   Number.isSafeInteger(v.shareUnits)&&v.shareUnits>0&&taskEnd(v)>now)pending+=v.shareUnits;
  if(v.kind==='taxi'&&v.taxiContractVersion===3&&v.contractType==='owned'&&taskEnd(v)>now)pending+=v.shareUnits||0;
  if(v.kind==='taxi'&&v.taxiContractVersion===2&&v.contractType==='owned'&&taskEnd(v)>now){
   const car=vehicleById(v.vehicleId);
   if(car)pending+=v.fareUnits-Math.min(car.remaining,Math.ceil(v.fareUnits*car.remaining/car.price));
  }
 }
 if(busState)pending+=busState.vehicles.reduce((sum,v)=>sum+Math.floor(v.gross*busEngine.rate(busState)/100),0);
  $('finance-pending').textContent='+'+formatCommonFunds(pending);
 const records=financeLedger.entries.slice(0,20);
 const signature=records.map(e=>e.category+':'+e.id+':'+e.at+':'+e.amount).join('|');
 if(drawFinance.signature===signature)return;
 const list=$('finance-transactions'),nodes=document.createDocumentFragment();
 if(!records.length)nodes.appendChild(element('p','finance-empty','아직 기록된 거래가 없습니다.'));
 for(const record of records){
  const row=element('div','finance-transaction'),left=element('div','finance-transaction-copy');
  const date=new Date(record.at*1000);
  const names={'bus-operation':'똑버스 차고지 정산','taxi-outsource':'외주 택시 정산','taxi-owned':'보유 택시 수익','truck-outsource':'트럭 외주 정산','truck-owned':'트럭 운송 수익',
   'vehicle-purchase':'차량 구매','vehicle-repayment':'지원금 중도상환','vehicle-repair':'차량 수리',
   'vehicle-sale':'차량 판매','vehicle-sale-payoff':'판매 시 지원금 상환','level-reward':'레벨 달성 보상','ability-unlock':'능력 해금'};
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
   (v.fleetNo===undefined||(Number.isInteger(v.fleetNo)&&v.fleetNo>=1&&v.fleetNo<=100))&&
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
  // Level progress written by v0.13.37+ normally implies an existing garage
  // record, even if it contains zero vehicles.
  if(await read(TAXI_LEVEL_KEY))throw new Error('Taxi garage missing while level exists; refusing empty garage');
  dirty=true;
 }catch(e){console.error('MYON owned vehicles:',e);ownedGarage=null;throw e;}
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
  if(Number.isInteger(v.fleetNo)&&v.fleetNo>=1&&v.fleetNo<=100&&!used.has(v.fleetNo))used.add(v.fleetNo);
  else v.fleetNo=0;
 }
 for(const v of ownedGarage.vehicles)if(!v.fleetNo){
  let no=1;while(used.has(no)&&no<=100)no++;
  if(no>100)break;
  v.fleetNo=no;used.add(no);dirty=true;
 }
}
function grantCityVehicles(){
 if(activeWorld()!=='taxi'||!ownedGarage||!taxiLevel||!worldProgress)return;
 const target=cityEntitlement();
 for(let i=worldProgress.taxiSupportGranted;i<target&&ownedGarage.vehicles.length<100;i++){
  const no=fleetNextNumber();if(!no)break;
  const id=ownedGarage.nextId++;
  ownedGarage.vehicles.push({id,fleetNo:no,model:'myon',origin:'city',newPrice:0,price:0,remaining:0,
   durability:100000,serviceRuns:0,trips:0,location:'시 제공 차고지',activeMissionId:0});
   worldProgress.taxiSupportGranted++;
  dirty=true;
 }
}
// Renewal gift: two free MYON taxis per player, running through the
// SAME owned-vehicle workflow. Unclaimed gift slots wait at the 50-car cap.
function grantEventVehicles(){
 if(activeWorld()!=='taxi'||!ownedGarage)return;
 if(!Number.isSafeInteger(ownedGarage.eventGranted))return;
 while(ownedGarage.eventGranted<2&&ownedGarage.vehicles.length<100){
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
function makeOwnedTrip(v,now,acceptMethod='manual'){
 const base=jobIdentity(now,null),seed=base.seed;
 const distance=range(seed,22,30,levelMaxKm()*10)*100;
 const fare=ownedTaxiFare(distance,now);
 // The city-out-of-town tariff remains. LV.5 unlocks an extra 1% on >10km.
 const longFare=levelNumber()>=5&&distance>10000?Math.ceil(fare.total/100):0;
 const total=fare.total+longFare,rate=levelRevenue(),baseShareUnits=Math.floor(total*rate/100);
 // Freeze +50% of the vehicle's own revenue only for a NEW manual LV.2+ trip.
 const manualBonusUnits=acceptMethod==='manual'?taxiManualShare(baseShareUnits)-baseShareUnits:0;
 const shareUnits=acceptMethod==='auto'?taxiAutoShare(total,rate):baseShareUnits+manualBonusUnits;
 const end=roadEnd(seed,now,distance);
 return {...base,kind:'taxi',dispatch:'owned',contractType:'owned',taxiContractVersion:3,worldCycle:worldProgress.cycles.taxi,
  vehicleId:v.id,vehicleNo:v.fleetNo||v.id,passengerMeters:distance,fareUnits:total,
  shareUnits,revenueRate:rate,acceptMethod,manualBonusUnits,cityCutUnits:Math.max(0,total-shareUnits),
  baseFare:fare.base,extraFare:fare.extra,nightFare:fare.night,longFare,nightRate:fare.nightRate,
  start:now,end,stages:[{phase:'outbound',start:now,end,distance}],
  startLocation:v.location,destination:'운행 거점 '+(v.trips+1)};
}
function finishOwnedTrip(task,at){
 const v=vehicleById(task.vehicleId);
 if(!v||v.activeMissionId!==task.id)return;
 if(task.taxiContractVersion===3){
  const player=task.shareUnits,settlement=compensationSettlementAmount(player,at);
  if(!Number.isSafeInteger(player)||player<0||!commonFunds||!Number.isSafeInteger(commonFunds.balance+settlement)||
     !financeLedger||!Number.isSafeInteger(financeLedger.totalIncome+settlement))return;
  commonFunds.balance+=settlement;v.trips++;v.location=task.destination;v.activeMissionId=0;
  recordFinanceTransaction('taxi-owned',player,at,task.id);
  recordCompensationIncome(player,at,task.id);dirty=true;return;
 }
 if(task.taxiContractVersion!==2||v.price<=0)return;
 // Retain settlement terms of old paid-vehicle journeys; do not add repairs.
 const repay=Math.min(v.remaining,Math.ceil(task.fareUnits*v.remaining/v.price));
 const player=task.fareUnits-repay;
 const settlement=compensationSettlementAmount(player,at);
 if(!Number.isSafeInteger(player)||!commonFunds||!Number.isSafeInteger(commonFunds.balance+settlement)||
    !financeLedger||!Number.isSafeInteger(financeLedger.totalIncome+settlement))return;
 commonFunds.balance+=settlement;v.remaining-=repay;
 v.trips++;v.location=task.destination;v.activeMissionId=0;
 recordFinanceTransaction('taxi-owned',player,at,task.id);
 recordCompensationIncome(player,at,task.id);dirty=true;
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
  if(job.manualBonusUnits>0)chunks.push('수동 수락 +50% '+formatCommonFunds(job.manualBonusUnits));
  else if(job.acceptMethod==='auto')chunks.push('자동 수락 · 기본 수익');
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
 if(vehicleBuyType==='new')return {model,price:compensationPurchasePrice(model.price),durability:100000,origin:'new',newPrice:model.price};
 const listing=USED_MARKET.find(x=>x.id===$('vehicle-used').value)||USED_MARKET[0];
 const usedModel=TAXI_MODELS.find(m=>m.key===listing.model);
 return {model:usedModel,price:compensationPurchasePrice(usedModel.price/2),durability:listing.durability,origin:'used',newPrice:usedModel.price};
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
 $('vehicle-price').textContent=currencyUnits(selected.price)+(compensationActiveAt(Math.floor(Date.now()/1000))?' · 긴급 50% 할인':'');
 $('vehicle-durability-buy').textContent=(selected.durability/1000).toFixed(3)+'%';
 $('vehicle-subsidy-value').textContent=currencyUnits(subsidy);
 $('vehicle-self-value').textContent=currencyUnits(self);
 $('vehicle-buy-action').textContent='차량 구매 · '+currencyUnits(self);
 $('vehicle-buy-action').disabled=vehicleBusy||ownedGarage.vehicles.length>=taxiFleetLimit()||commonFunds.balance<self;
 $('vehicle-buy-note').textContent=ownedGarage.vehicles.length>=taxiFleetLimit()?'차량 보유 한도 '+taxiFleetLimit()+'대에 도달했습니다.':
   commonFunds.balance<self?'공용자금이 부족합니다.':'구매 시 자부담금만 공용자금에서 차감됩니다.';
}
function drawVehicles(){
 if(!ownedGarage||!commonFunds)return;
 $('vehicle-count').textContent=ownedGarage.vehicles.length+' / '+taxiFleetLimit()+'대';
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
 $('vehicle-sale-price').textContent=currencyUnits(saleTerms('taxi',v)?.gross||0);
 const net=saleTerms('taxi',v)?.net||0;
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
 if(!Number.isInteger(pct)||pct<0||pct>90||ownedGarage.vehicles.length>=taxiFleetLimit())return;
 const subsidy=Math.round(selected.price*pct/100),self=selected.price-subsidy;
 if(commonFunds.balance<self)return;
 vehicleBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);
  advance(now);
  if(commonFunds.balance<self)return;
  const id=ownedGarage.nextId++,fleetNo=fleetNextNumber();
  ownedGarage.vehicles.push({id,fleetNo,model:selected.model.key,origin:selected.origin,newPrice:selected.newPrice,
   price:selected.price,remaining:subsidy,playerPaidUnits:self,durability:selected.durability,
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
 const terms=saleTerms('taxi',v),gross=terms.gross,net=terms.net;
 if(commonFunds.balance+net<0){setVehicleMessage('미상환 지원금을 정산할 공용자금이 부족합니다.');return;}
 if(!$('vehicle-sale-confirm').hidden)return;
 $('vehicle-sale-confirm').hidden=false;
}
async function confirmVehicleSale(){
 const v=vehicleById(vehicleSelectedId);
 if(vehicleBusy||!v||['city','event'].includes(v.origin)||v.activeMissionId)return;
 const terms=saleTerms('taxi',v),gross=terms.gross,net=terms.net;
 if(commonFunds.balance+net<0)return;
 vehicleBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);
  if(commonFunds.balance+net<0)return;
  commonFunds.balance+=net;
  recordFinanceTransaction('vehicle-sale',gross,now,v.id);
  if(v.remaining)recordFinanceTransaction('vehicle-sale-payoff',-v.remaining,now,v.id);
  ownedGarage.vehicles=ownedGarage.vehicles.filter(x=>x.id!==v.id);
  vehicleSelectedId=ownedGarage.vehicles[0]?.id||0;
   grantCityVehicles();grantEventVehicles();dirty=true;
  $('vehicle-sale-confirm').hidden=true;
  await save(now);setVehicleMessage('판매 완료. 차량이 보유 목록에서 제거됐습니다.');
 }finally{vehicleBusy=false;draw(Math.floor(Date.now()/1000));}
}
// The mission board owns all waiting taxi cards. No vehicle-operation panel or
// vehicle selector is exposed; an accepted car returns here after settlement.
const MYON_TAXI_PRICE=20000000;
let fleetBusy=false;
function taxiPurchaseTerms(){
 const rate=Math.min(100,levelRevenue()),price=compensationPurchasePrice(MYON_TAXI_PRICE),player=Math.floor(price*rate/100);
 return {rate,player,city:price-player,price};
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
  slot.metric.textContent='최대 '+levelMaxKm()+'km · '+levelRateText()+(levelNumber()>=2?' · 수동 +50%':'');
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
  const trip=makeOwnedTrip(vehicle,now,'manual');
  state.units.push(trip);vehicle.activeMissionId=trip.id;dirty=true;
  await save(now);
 }finally{
  fleetBusy=false;
  draw(Math.floor(Date.now()/1000));
 }
}
function drawTaxiPurchase(){
 if(!ownedGarage||!taxiLevel||!commonFunds)return;
 const terms=taxiPurchaseTerms(),total=ownedGarage.vehicles.length,cap=taxiFleetLimit();
 $('taxi-event-status').hidden=true;
 $('taxi-purchase-count').textContent='보유 '+total+' / '+cap+'대';
 $('taxi-purchase-area').querySelector('.taxi-purchase-title span').textContent=compensationActiveAt(Math.floor(Date.now()/1000))?'신차 · 2,000만원 → 1,000만원 (50% 할인)':'신차 · 2,000만원';
 $('taxi-purchase-player').textContent='내 부담 '+terms.rate+'% · '+formatManwon(terms.player);
 $('taxi-purchase-city').textContent='구매 지원 '+(100-terms.rate)+'% · '+formatManwon(terms.city);
 const button=$('taxi-purchase-action');
 button.textContent='차량 구입 · '+formatCommonFunds(terms.player);
 button.disabled=fleetBusy||resetBusy||total>=cap||commonFunds.balance<terms.player;
 if(total>=cap)$('taxi-purchase-note').textContent='차량 보유 한도 '+cap+'대에 도달했습니다.';
 else if(commonFunds.balance<terms.player)$('taxi-purchase-note').textContent='구입 자금이 부족합니다.';
 else if(!$('taxi-purchase-note').textContent.startsWith('택시'))
  $('taxi-purchase-note').textContent='구입 완료 시 임무판에 대기 차량으로 추가됩니다.';
}
async function buyTaxiFleet(){
 if(activeWorld()!=='taxi')return;
 if(fleetBusy||!ready||resetBusy||!ownedGarage||!taxiLevel||!commonFunds)return;
 const terms=taxiPurchaseTerms();
 if(ownedGarage.vehicles.length>=taxiFleetLimit()||commonFunds.balance<terms.player)return;
 const no=fleetNextNumber();if(!no)return;
 fleetBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);
  advance(now);grantCityVehicles();
  if(ownedGarage.vehicles.length>=taxiFleetLimit()||commonFunds.balance<terms.player)return;
  const actualNo=fleetNextNumber();if(!actualNo)return;
  const id=ownedGarage.nextId++;
  ownedGarage.vehicles.push({
   id,fleetNo:actualNo,model:'myon',origin:'new',
   newPrice:MYON_TAXI_PRICE,price:terms.price,remaining:0,
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


// MYON v0.13.44 — distance-only, vehicle-specific freight rates; preserve prior contracts.
const TRUCK_MODELS=[
 {key:'cargo1',name:'MYON 소형트럭',price:20000000,maxKm:200,kind:'cargo',kmRate:2000},
 {key:'medium',name:'MYON 중형트럭',price:150000000,maxKm:500,kind:'cargo',kmRate:4000},
 {key:'large',name:'MYON 대형트럭',price:210000000,maxKm:10000,kind:'cargo',kmRate:6000},
 {key:'tractor',name:'MYON 트랙터',price:180000000,maxKm:10000,kind:'trailer',kmRate:10000}
];
const TRUCK_CITIES=['하린','세온','미르','라온','노아','다온','서린','유안','가온','해온','온빛','나루','아라','새별','한울','바람'];
const TRUCK_JOB_NAMES={outsource:'외주 운송',cargo:'카고 운송',single:'단일 트레일러',double:'더블 트레일러',triple:'트리플 트레일러',quad:'4중 트레일러'};
const TRUCK_JOB_MULT={outsource:1,cargo:1,single:1,double:2,triple:3,quad:4};

// Literal currency units: M_UNITS is declared later in the script.
const TRUCK_UPGRADE_PRICES={distance:200000,revenue:500000,fleet:3000000};
const TRUCK_LOADING_MINUTES={
 cargo1:{load:[10,20],unload:[5,15]},
 medium:{load:[20,35],unload:[15,25]},
 large:{load:[30,50],unload:[20,40]},
 tractor:{load:[40,60],unload:[30,50]}
};
// The last ordinary truck level is 10. Earlier high-level benefits are migrated
// into the same persisted ability counters, without charging or repricing jobs.
function truckMaster(){return truckLevelNumber()===10;}
function truckLevelNumber(){return truckGarage?Math.min(10,Math.floor(truckGarage.completed/100)+1):1;}
function truckUpgradeState(){return truckGarage?.upgrades||{distance:0,revenue:0,fleet:0,roadtrain:0};}
function truckFleetLimit(){return sharedFleetLimit();}
function truckTrailerCount(){return Math.min(10,1+truckUpgradeState().roadtrain);}
function truckRewardType(n){
 return {2:'auto',3:'medium',4:'revenue',5:'distance',6:'large',7:'revenue',8:'distance',9:'revenue',10:'master'}[n]||null;
}
function truckRewardCount(type,l){
 const level=Math.min(10,l);
 if(type==='revenue')return [4,7,9,10].filter(x=>level>=x).length;
 if(type==='distance')return [5,8,10].filter(x=>level>=x).length;
 return 0;
}
function truckRevenue(l=truckLevelNumber()){return 40+truckRewardCount('revenue',l)+truckUpgradeState().revenue;}
function truckMaxKm(l=truckLevelNumber()){return Math.min(10000,100+truckRewardCount('distance',l)*50+truckUpgradeState().distance*50);}
function truckNextReward(l=truckLevelNumber()){
 const next=l+1,type=truckRewardType(next);
 if(type==='auto')return '30분마다 현 도시 배송 임무 자동수락';
 if(type==='medium')return 'MYON 중형트럭 1대 지급';
 if(type==='large')return 'MYON 대형트럭 1대 지급 · 차량지원 종료';
 if(type==='master')return '마스터 · 수익률 44% · 최대 250km · 1,000 M 보상';
 if(type==='revenue')return '수익률 +1%p → '+(40+truckRewardCount('revenue',next))+'%';
 if(type==='distance')return '최대 운송거리 +50km → '+(100+truckRewardCount('distance',next)*50)+'km';
 return '마스터 · 자금으로 능력 해금';
}
function truckRoadtrainPrice(){
 return (truckUpgradeState().roadtrain+1)*200*M_UNITS; // 200, 400, ... 1,800 M
}
function drawTruckMaster(){
 $('truck-master-summary').textContent='수익률 '+truckRevenue()+'% · 운송최대거리 '+truckMaxKm().toLocaleString('ko-KR')+'km';
 const upgraded=truckUpgradeState();
 const rows=[
  ['distance','운송거리 +50km','현재 '+truckMaxKm().toLocaleString('ko-KR')+'km · 최대 10,000km',truckMaxKm()>=10000,TRUCK_UPGRADE_PRICES.distance],
  ['revenue','수익률 +1%p','현재 '+truckRevenue()+'% · 최대 100%',truckRevenue()>=100,TRUCK_UPGRADE_PRICES.revenue],
  ['fleet','차량 보유 한도 +10대','현재 '+truckFleetLimit()+'대 · 최대 100대',truckFleetLimit()>=100,SHARED_FLEET_PRICE],
  ['roadtrain','로드트레인 +1 트레일러','현재 '+truckTrailerCount()+'대 · 수익 ×'+truckTrailerCount()+' · 최대 10대',truckTrailerCount()>=10,truckRoadtrainPrice()]
 ];
 for(const [key,label,detail,done,cost] of rows){
  $('truck-master-'+key+'-title').textContent=label;
  $('truck-master-'+key+'-detail').textContent=detail;
  const button=$('truck-master-'+key+'-buy');
  button.textContent=done?'해금 완료':formatCommonFunds(cost);
  button.disabled=done||worldSwitchBusy||resetBusy||truckBuyBusy||!ready||commonFunds.balance<cost;
 }
}
function drawTruckLevel(){
 if(!truckGarage)return;
 const master=truckMaster();
 $('taxi-level-panel').hidden=master;
 $('truck-master-panel').hidden=!master;
 $('taxi-master-panel').hidden=true;
 if(master){drawTruckMaster();return;}
 const lv=truckLevelNumber(),n=truckGarage.completed%100;
 $('world-level-label').textContent='트럭 운영 레벨';
 $('taxi-level').textContent='LV.'+lv.toLocaleString('ko-KR');
 $('taxi-next-remaining').textContent=(100-n)+'건';
 $('taxi-level-progress').style.width=n+'%';
 $('taxi-level-count').textContent='누적 완료 '+truckGarage.completed.toLocaleString('ko-KR')+'건';
 $('taxi-level-current').textContent='수익률 '+truckRevenue(lv)+'% · 최대 '+truckMaxKm(lv).toLocaleString('ko-KR')+'km';
 $('taxi-next-reward').textContent=truckNextReward(lv);
 $('taxi-level-details').hidden=false;
 $('level-future-summary').textContent='트럭 보상 전체보기 · LV.10까지';
 $('level-infinite-title').textContent='LV.10부터 로드트레인·능력 개발';
 $('level-infinite-note').textContent='운송거리·수익률·차량 한도·로드트레인 +1대 해금';
 renderTaxiFutureRewards();
}
async function buyTruckMasterUpgrade(type){
 if(!['distance','revenue','fleet','roadtrain'].includes(type)||!ready||resetBusy||worldSwitchBusy||
    truckBuyBusy||activeWorld()!=='truck'||!truckMaster()||!truckGarage||!commonFunds)return;
 if(type==='fleet'){await buyWorldUpgrade('fleet');return;}
  const price=type==='roadtrain'?truckRoadtrainPrice():TRUCK_UPGRADE_PRICES[type];
 const completed=()=>type==='distance'?truckMaxKm()>=10000:type==='revenue'?truckRevenue()>=100:
  type==='fleet'?truckFleetLimit()>=100:truckTrailerCount()>=10;
 if(completed()||commonFunds.balance<price)return;
 truckBuyBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);
  if(completed()||commonFunds.balance<price)return;
  commonFunds.balance-=price;truckGarage.upgrades[type]++;
  recordFinanceTransaction('ability-unlock',-price,now,{distance:4,revenue:5,fleet:6,roadtrain:7}[type]);
  dirty=true;await save(now);
 }finally{truckBuyBusy=false;draw(Math.floor(Date.now()/1000));}
}
for(const type of ['distance','revenue','fleet','roadtrain'])
 $('truck-master-'+type+'-buy').addEventListener('click',()=>buyTruckMasterUpgrade(type));
function defaultWorldProgress(){return {schema:1,active:'taxi',visited:{taxi:true,truck:false,bus:false},cycles:{taxi:1,truck:0,bus:0},seen:{taxi:0,truck:0,bus:0},fleetUnlocks:0,taxiSupportGranted:0};}
function validWorldProgress(x){
 return Boolean(x&&x.schema===1&&['taxi','truck','bus'].includes(x.active)&&x.visited&&x.visited.taxi===true&&typeof x.visited.truck==='boolean'&&
 (x.visited.bus===undefined||typeof x.visited.bus==='boolean')&&(x.active!=='bus'||x.visited.bus===true)&&x.cycles&&x.seen&&
 ['taxi','truck'].every(k=>Number.isSafeInteger(x.cycles[k])&&x.cycles[k]>=0&&Number.isSafeInteger(x.seen[k])&&x.seen[k]>=0)&&
 (x.cycles.bus===undefined||Number.isSafeInteger(x.cycles.bus)&&x.cycles.bus>=0)&&
 (x.seen.bus===undefined||Number.isSafeInteger(x.seen.bus)&&x.seen.bus>=0)&&
 (x.fleetUnlocks===undefined||Number.isSafeInteger(x.fleetUnlocks)&&x.fleetUnlocks>=0&&x.fleetUnlocks<=5)&&
 (x.taxiSupportGranted===undefined||Number.isSafeInteger(x.taxiSupportGranted)&&x.taxiSupportGranted>=0&&x.taxiSupportGranted<=3));
}
function defaultTruckGarage(){return {schema:1,completed:0,nextId:1,eventGranted:0,cityGranted:{medium:false,large:false},
 upgrades:{distance:0,revenue:0,fleet:0,roadtrain:0,autoMinutes:0},masterRewardPaid:false,vehicles:[]};}
// Once per legacy save, preserve every old LV.11+ earned skill. Previously unlocked
// multi-trailers are retained as free Road Train stages; ongoing contracts stay untouched.
function normalizeTruckGarage(g){
 if(!g||g.schema!==1||!Number.isSafeInteger(g.completed)||g.completed<0)return false;
 if(!g.upgrades){
  const level=Math.floor(g.completed/100)+1;
  const oldPhases=[{from:8,to:40,first:'revenue'},{from:42,to:50,first:'revenue'},
   {from:52,to:60,first:'distance'},{from:62,to:70,first:'revenue'},
   {from:72,to:Infinity,first:'distance'}];
  const oldCount=(type)=>{
   let amount=(type==='revenue'?[3,6]:[4,7]).filter(n=>level>=n).length;
   for(const ph of oldPhases){const c=Math.max(0,Math.min(level,ph.to)-ph.from+1);
    amount+=Math.floor(c/2)+(c%2&&ph.first===type?1:0);}
   return amount;
  };
  g.upgrades={
   distance:Math.max(0,Math.min(195,oldCount('distance')-3)),
   revenue:Math.max(0,oldCount('revenue')-4),
   fleet:0,
   roadtrain:level>=61?3:level>=51?2:level>=41?1:0
  };
  dirty=true;
 }
 if(g.upgrades.autoMinutes===undefined){g.upgrades.autoMinutes=0;dirty=true;}
  if(!['distance','revenue','fleet','roadtrain'].every(k=>Number.isSafeInteger(g.upgrades[k])&&g.upgrades[k]>=0)||
   !Number.isSafeInteger(g.upgrades.autoMinutes)||g.upgrades.autoMinutes<0||g.upgrades.autoMinutes>30)return false;
 if(g.masterRewardPaid===undefined){g.masterRewardPaid=false;dirty=true;}
 if(typeof g.masterRewardPaid!=='boolean')return false;
 for(const v of g.vehicles||[]){
  if(!TRUCK_CITIES.includes(v.location)){v.location=TRUCK_CITIES[0];dirty=true;}
 }
 return true;
}
function grantTruckMasterReward(now){
 if(!truckMaster()||!truckGarage||truckGarage.masterRewardPaid||!commonFunds)return;
 const amount=1000*M_UNITS;
 if(!financeLedger||!Number.isSafeInteger(commonFunds.balance+amount)||
  !Number.isSafeInteger(financeLedger.totalIncome+amount))return;
 commonFunds.balance+=amount;truckGarage.masterRewardPaid=true;
 recordFinanceTransaction('level-reward',amount,now,11);dirty=true;
}
function validTruckGarage(x){
 const ids=new Set();
 return Boolean(x&&x.schema===1&&Number.isSafeInteger(x.completed)&&x.completed>=0&&Number.isSafeInteger(x.nextId)&&x.nextId>=1&&
 Number.isSafeInteger(x.eventGranted)&&x.eventGranted>=0&&x.eventGranted<=2&&x.cityGranted&&typeof x.cityGranted.medium==='boolean'&&typeof x.cityGranted.large==='boolean'&&
 Array.isArray(x.vehicles)&&x.vehicles.length<=100&&x.vehicles.every(v=>{
  if(!v||!Number.isSafeInteger(v.id)||v.id<1||v.id>=x.nextId||ids.has(v.id)||!TRUCK_MODELS.some(m=>m.key===v.model))return false;
  ids.add(v.id);return ['event','city','new'].includes(v.origin)&&Number.isSafeInteger(v.newPrice)&&v.newPrice>=0&&Number.isSafeInteger(v.activeMissionId)&&v.activeMissionId>=0&&Number.isSafeInteger(v.trips)&&v.trips>=0&&TRUCK_CITIES.includes(v.location);
 }));
}
function defaultTruckOffers(){return {schema:1,seed:seedNow(),nextId:1,nextAutoAt:nextAutoSlot(Math.floor(Date.now()/1000)),offers:[]};}
function validTruckOffers(x){return Boolean(x&&x.schema===1&&Number.isInteger(x.seed)&&Number.isSafeInteger(x.nextId)&&x.nextId>=1&&
 (x.nextAutoAt===undefined||(Number.isSafeInteger(x.nextAutoAt)&&x.nextAutoAt>0))&&
 Array.isArray(x.offers)&&x.offers.length<=5&&x.offers.every(v=>v&&Number.isSafeInteger(v.id)&&v.id>0&&v.id<x.nextId&&
 Object.hasOwn(TRUCK_JOB_NAMES,v.type)&&Number.isInteger(v.distanceKm)&&v.distanceKm>=20&&v.distanceKm<=10000&&
 TRUCK_CITIES.includes(v.from)&&TRUCK_CITIES.includes(v.to)&&v.from!==v.to));}
async function startWorldState(){
 worldProgress=defaultWorldProgress();truckGarage=defaultTruckGarage();truckOffers=defaultTruckOffers();
 if(!IS_LIVE)return;
 try{
  const [world,garage,offers]=await Promise.all([read(WORLD_KEY),read(TRUCK_GARAGE_KEY),read(TRUCK_OFFERS_KEY)]);
  if(world){
   if(!validWorldProgress(world))throw Error('Invalid saved world state');
   worldProgress=world;
   if(worldProgress.visited.bus===undefined){worldProgress.visited.bus=false;dirty=true;}
   if(worldProgress.cycles.bus===undefined){worldProgress.cycles.bus=0;dirty=true;}
   if(worldProgress.seen.bus===undefined){worldProgress.seen.bus=0;dirty=true;}
  }else dirty=true;
  if(garage){if(!normalizeTruckGarage(garage)||!validTruckGarage(garage))throw Error('Invalid saved truck garage');truckGarage=garage;}else dirty=true;
   // First migration recognizes the highest existing taxi/truck fleet entitlement.
   if(worldProgress.fleetUnlocks===undefined){
    worldProgress.fleetUnlocks=Math.min(5,Math.max(taxiLevel?.upgrades?.fleet||0,truckGarage.upgrades.fleet||0));dirty=true;
   }
   if(worldProgress.taxiSupportGranted===undefined){
    const existing=ownedGarage.vehicles.filter(v=>v.origin==='city').length;
    const wasReentered=worldProgress.cycles.taxi>1||worldProgress.active!=='taxi';
    worldProgress.taxiSupportGranted=Math.min(3,Math.max(existing,wasReentered?cityEntitlement():0));dirty=true;
   }
   // Former world switches recalled city cars. Respect legacy claims without duplication.
   if(worldProgress.visited.truck&&(worldProgress.active!=='truck'||worldProgress.cycles.truck>1)){
    for(const [lv,key] of [[3,'medium'],[6,'large']]){
     if(truckLevelNumber()>=lv&&!truckGarage.cityGranted[key]){
      truckGarage.cityGranted[key]=true;dirty=true;
     }
    }
   }
   for(const v of [...ownedGarage.vehicles,...truckGarage.vehicles]){
    if(v.origin==='city'&&v.recallAfterMission){v.recallAfterMission=false;dirty=true;}
   }
  if(offers){
   if(!validTruckOffers(offers))throw Error('Invalid saved truck offers');
   truckOffers=offers;
   if(!Number.isSafeInteger(truckOffers.nextAutoAt)){
    truckOffers.nextAutoAt=nextAutoSlot(Math.floor(Date.now()/1000));dirty=true;
   }
   // Old unaccepted multi-trailer cards become normal single-trailer offers.
   for(const o of truckOffers.offers){
    if(!['outsource','cargo','single'].includes(o.type)){o.type='single';dirty=true;}
   }
  }else dirty=true;
 }catch(e){console.error('MYON world-state read:',e);throw e;}
 // Legacy already-running taxi jobs belong to the first preserved taxi cycle.
 for(const v of state.units)if(v.kind==='taxi'&&!v.worldCycle){v.worldCycle=worldProgress.cycles.taxi;dirty=true;}
}
function truckVehicleById(id){return truckGarage?.vehicles.find(v=>v.id===id);}
function truckAddVehicle(modelKey,origin){
 const model=TRUCK_MODELS.find(m=>m.key===modelKey);
 if(!model||!truckGarage||truckGarage.vehicles.length>=(origin==='new'?truckFleetLimit():100))return false;
 truckGarage.vehicles.push({id:truckGarage.nextId++,model:model.key,origin,newPrice:model.price,activeMissionId:0,trips:0,location:TRUCK_CITIES[0]});dirty=true;return true;
}
function grantTruckEvent(){
 if(activeWorld()!=='truck'||!truckGarage)return;
 for(const [index,key] of [[0,'cargo1'],[1,'tractor']]){
  if(truckGarage.eventGranted<=index&&truckAddVehicle(key,'event'))truckGarage.eventGranted=index+1;
 }
}
function grantTruckCity(){
 if(activeWorld()!=='truck'||!truckGarage)return;
 for(const [level,key] of [[3,'medium'],[6,'large']]){
  if(truckLevelNumber()>=level&&!truckGarage.cityGranted[key]&&truckAddVehicle(key,'city'))truckGarage.cityGranted[key]=true;
 }
}
function recallWorldVehicles(){
 // City/level grants are permanent first-time claims; retain the vehicle in its own garage.
 // Active-world checks already prevent cross-world dispatch.
}

// The old LV.41/51/61 types are replaced by a single Road Train investment.
// Every new trailer is priced as a separate destination-specific consignment.
function unlockedTruckTypes(){return ['outsource','cargo','single'];}
function truckVehicleModel(v){return TRUCK_MODELS.find(m=>m.key===v?.model);}
function truckIdleVehicles(){
 return truckGarage.vehicles.filter(v=>!v.activeMissionId&&!v.recallAfterMission);
}
function generateTruckOffer(forCity=null,forKind=null,limitKm=null){
 const id=truckOffers.nextId++,seed=mix((truckOffers.seed+Math.imul(id,0x9e3779b9))>>>0);
 const choices=unlockedTruckTypes();
 const type=forKind||choices[range(seed,0,0,choices.length-1)];
 const idle=truckIdleVehicles(),pickCity=idle.length?idle[range(seed,9,0,idle.length-1)].location:TRUCK_CITIES[0];
 const from=forCity||(type==='outsource'?TRUCK_CITIES[0]:(range(seed,7,0,99)<85?pickCity:TRUCK_CITIES[range(seed,1,0,TRUCK_CITIES.length-1)]));
 const startIdx=TRUCK_CITIES.indexOf(from);
 let endIdx=range(seed,2,0,TRUCK_CITIES.length-2);if(endIdx>=startIdx)endIdx++;
 const max=Math.max(20,Math.min(truckMaxKm(),limitKm||10000));
 const distanceKm=range(seed,3,20,max);
 return {id,type,from,to:TRUCK_CITIES[endIdx],distanceKm};
}
function truckEligibleVehicle(offer){
 if(offer.type==='outsource')return null;
 const kind=offer.type==='cargo'?'cargo':'trailer';
 return truckIdleVehicles().map(v=>({v,model:truckVehicleModel(v)}))
  .filter(x=>x.model&&x.model.kind===kind&&x.v.location===offer.from&&x.model.maxKm>=offer.distanceKm)
  .sort((a,b)=>a.model.maxKm-b.model.maxKm||a.v.id-b.v.id)[0]?.v||null;
}
function canAcceptTruck(offer){
 return activeWorld()==='truck'&&!!offer&&offer.distanceKm<=truckMaxKm()&&unlockedTruckTypes().includes(offer.type)&&
 (offer.type==='outsource'||!!truckEligibleVehicle(offer))&&state.units.length<MAX_TOTAL&&ownedActiveCount()<INVOLVED_MAX_MISSIONS;
}
function fillTruckOffers(){
 if(activeWorld()!=='truck'||!truckOffers)return;
 while(truckOffers.offers.length<5&&truckOffers.nextId<Number.MAX_SAFE_INTEGER){
  truckOffers.offers.push(generateTruckOffer());dirty=true;
 }
 // A new destination must always be reachable from an idle vehicle's
 // actual city; otherwise five unrelated cities would deadlock dispatch.
 if(truckOffers.offers.length===5&&!truckOffers.offers.some(canAcceptTruck)&&
    state.units.length<MAX_TOTAL&&ownedActiveCount()<INVOLVED_MAX_MISSIONS){
  const idle=truckIdleVehicles()[0];
  const model=truckVehicleModel(idle);
  if(idle&&model){
   const offer=generateTruckOffer(idle.location,model.kind==='trailer'?'single':'cargo',model.maxKm);
   truckOffers.offers[4]=offer;dirty=true;
  }else{
   truckOffers.offers[4]=generateTruckOffer(TRUCK_CITIES[0],'outsource');dirty=true;
  }
 }
}
function truckTravelSeconds(distanceKm){return Math.max(900,Math.ceil(distanceKm*3600/65));}
function truckHandlingSeconds(modelKey,part,seed,number){
 const profile=TRUCK_LOADING_MINUTES[modelKey]||TRUCK_LOADING_MINUTES.cargo1;
 return range(seed,number,...profile[part])*60;
}
// Freeze all accepted monetary terms, including each separately attached trailer.
function truckContractTerms(offer,vehicle,rate=truckRevenue(),method='manual'){
 const model=truckVehicleModel(vehicle);
 if(offer.type!=='outsource'&&!model)return null;
 const kmRate=offer.type==='outsource'?TRUCK_MODELS[0].kmRate:model.kmRate;
 const multiplier=TRUCK_JOB_MULT[offer.type]||1;
 const fareUnits=offer.distanceKm*kmRate;
 const actualRate=method==='auto'?autoEarningsRate(rate,truckAutoSteps()):rate;
 const base=Math.floor(fareUnits*actualRate*multiplier/100);
 const shareUnits=method==='manual'&&truckLevelNumber()>=2?base+Math.floor(base/2):base;
 return {kmRate,fareUnits,shareUnits,rate:actualRate,multiplier,model};
}
function makeTruckContract(offer,vehicle,now,method='manual'){
 const seed=mix((truckOffers.seed^Math.imul(offer.id,0x85ebca6b))>>>0);
 const terms=truckContractTerms(offer,vehicle,truckRevenue(),method);
 if(!terms)throw new Error('Truck contract requires an eligible vehicle');
 const {fareUnits,shareUnits,rate,multiplier,kmRate}=terms;
 const model=truckVehicleModel(vehicle),key=model?.key||'cargo1';
 const phases=[
  ['load',truckHandlingSeconds(key,'load',seed,11)],
  ['outbound',truckTravelSeconds(offer.distanceKm)],
  ['unload',truckHandlingSeconds(key,'unload',seed,12)]
 ];
 let cursor=now;
 const stages=phases.map(([phase,duration])=>{
  const start=cursor;cursor+=duration;
  return {phase,start,end:cursor,distance:phase==='outbound'?offer.distanceKm*1000:0};
 });
 const displayName=vehicle?model.name+' '+vehicle.id+'호 · '+TRUCK_JOB_NAMES[offer.type]:'MYON 외주 트럭';
 return {id:state.nextId++,seed,kind:'truck',truckContractVersion:1,worldCycle:worldProgress.cycles.truck,
  contractType:vehicle?'owned':'outsource',dispatch:'accepted',acceptMethod:method,vehicleId:vehicle?.id||0,
  displayName,type:offer.type,from:offer.from,to:offer.to,distanceKm:offer.distanceKm,rate,multiplier,kmRate,
  fareUnits,shareUnits,start:now,end:cursor,stages};
}
function truckShipment(offer,vehicle,method='manual'){
 const terms=truckContractTerms(offer,vehicle,truckRevenue(),method);
 return {offerId:offer.id,from:offer.from,to:offer.to,distanceKm:offer.distanceKm,
  rate:terms.rate,kmRate:terms.kmRate,fareUnits:terms.fareUnits,shareUnits:terms.shareUnits};
}
function truckAppendStage(trip,phase,seconds,city,km=0){
 const start=trip.end;trip.end+=seconds;
 trip.stages.push({phase,start,end:trip.end,distance:km*1000,city});
}
function roadtrainNextDelivery(trip){
 const next=trip.trailers[0];
 if(!next){trip.closed=true;return;}
 trip.nextOfferId=next.offerId;trip.to=next.to;
 trip.distanceKm=next.distanceKm;
 truckAppendStage(trip,'outbound',truckTravelSeconds(next.distanceKm),next.to,next.distanceKm);
 const seed=mix((trip.seed^Math.imul(next.offerId,0x9e3779b9))>>>0);
 truckAppendStage(trip,'unload',truckHandlingSeconds('tractor','unload',seed,17),next.to);
}
function makeRoadTrainContract(offer,vehicle,now,method='manual'){
 const trip=makeTruckContract(offer,vehicle,now,method);
 const first=truckShipment(offer,vehicle,method);
 // Replace the default single-destination phases with a mutable convoy timeline.
 trip.truckContractVersion=2;trip.type='roadtrain';
 trip.trailers=[first];trip.joinedOfferIds=[offer.id];
 trip.stages=[];trip.end=now;trip.closed=false;trip.location=offer.from;
 const available=truckOffers.offers.filter(o=>o.id!==offer.id&&o.type==='single'&&o.from===offer.from&&
   o.distanceKm<=Math.min(truckMaxKm(),truckVehicleModel(vehicle).maxKm)&&o.to!==first.to);
 for(const other of available){
  if(trip.trailers.length>=truckTrailerCount())break;
  if(trip.trailers.some(t=>t.to===other.to))continue;
  trip.trailers.push(truckShipment(other,vehicle,method));trip.joinedOfferIds.push(other.id);
 }
 for(let i=0;i<trip.trailers.length;i++){
  const t=trip.trailers[i],seed=mix(trip.seed^Math.imul(t.offerId,0x27d4eb2d));
  truckAppendStage(trip,'load',truckHandlingSeconds('tractor','load',seed,13),offer.from);
  if(i>0)truckAppendStage(trip,'attach',HOUR,offer.from);
 }
 trip.multiplier=trip.trailers.length;trip.shareUnits=trip.trailers.reduce((a,t)=>a+t.shareUnits,0);
 roadtrainNextDelivery(trip);
 return trip;
}
// Future stops may attach different-destination consignments in their city.
// Each new trailer needs both normal model-specific loading and +1h hookup.
function roadtrainConnectAtStop(trip,city){
 if(activeWorld()!=='truck'||truckTrailerCount()<2)return;
 const car=truckVehicleById(trip.vehicleId);
 if(!car||car.recallAfterMission)return;
 const available=truckOffers.offers.filter(o=>o.type==='single'&&o.from===city&&
   o.distanceKm<=Math.min(truckMaxKm(),truckVehicleModel(car).maxKm));
 for(const offer of available){
  if(trip.trailers.length>=truckTrailerCount())break;
  if(trip.trailers.some(t=>t.to===offer.to))continue;
  const next=truckShipment(offer,car,trip.acceptMethod),seed=mix(trip.seed^Math.imul(offer.id,0x27d4eb2d));
  trip.trailers.push(next);trip.joinedOfferIds.push(offer.id);
  truckAppendStage(trip,'load',truckHandlingSeconds('tractor','load',seed,13),city);
  truckAppendStage(trip,'attach',HOUR,city);
  truckOffers.offers=truckOffers.offers.filter(x=>x.id!==offer.id);
  trip.shareUnits+=next.shareUnits;
  dirty=true;
 }
}
function advanceRoadTrains(now){
 // Old v1 contracts never enter this path; their frozen end/settlement remains intact.
 for(const trip of state.units.filter(v=>v.kind==='truck'&&v.truckContractVersion===2)){
  if(trip.closed)continue;
  let count=0;
  while(!trip.closed&&trip.end<=now&&count++<100){
   const shipment=trip.trailers.find(t=>t.offerId===trip.nextOfferId);
   if(!shipment){trip.closed=true;break;}
   const at=trip.end,settlement=compensationSettlementAmount(shipment.shareUnits,at);
   if(!commonFunds||!financeLedger||!Number.isSafeInteger(commonFunds.balance+settlement)||
      !Number.isSafeInteger(financeLedger.totalIncome+settlement))break;
   commonFunds.balance+=settlement;
   recordFinanceTransaction('truck-owned',shipment.shareUnits,at,trip.id);
   recordCompensationIncome(shipment.shareUnits,at,trip.id);
   const car=truckVehicleById(trip.vehicleId);
   if(car){car.location=shipment.to;car.trips++;}
   if(activeWorld()==='truck'&&trip.worldCycle===worldProgress.cycles.truck&&truckGarage.completed<900)truckGarage.completed++;
   trip.trailers=trip.trailers.filter(t=>t.offerId!==shipment.offerId);
   trip.location=shipment.to;
   roadtrainConnectAtStop(trip,shipment.to);
   roadtrainNextDelivery(trip);
   dirty=true;
  }
 }
}
function finishRoadTrain(trip){
 const car=truckVehicleById(trip.vehicleId);
 if(car&&car.activeMissionId===trip.id){
  car.activeMissionId=0;
  if(car.origin==='city'&&car.recallAfterMission)
   truckGarage.vehicles=truckGarage.vehicles.filter(v=>v.id!==car.id);
  dirty=true;
 }
}
function dispatchTruckOffer(offer,now,method='manual'){
 if(!canAcceptTruck(offer))return false;
 const car=truckEligibleVehicle(offer);
 const trip=car&&offer.type==='single'&&truckTrailerCount()>1?
  makeRoadTrainContract(offer,car,now,method):makeTruckContract(offer,car,now,method);
 state.units.push(trip);
 if(car)car.activeMissionId=trip.id;
 const ids=new Set(trip.joinedOfferIds||[offer.id]);
 truckOffers.offers=truckOffers.offers.filter(o=>!ids.has(o.id));
 dirty=true;
 return true;
}
let truckAcceptBusy=false;
async function acceptTruckOffer(id){
 if(!ready||truckAcceptBusy||worldSwitchBusy||resetBusy||activeWorld()!=='truck')return;
 const offer=truckOffers.offers.find(x=>x.id===id);if(!offer)return;
 truckAcceptBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);
  if(!dispatchTruckOffer(offer,now,'manual'))return;
  fillTruckOffers();await save(now);
 }finally{truckAcceptBusy=false;draw(Math.floor(Date.now()/1000));}
}
function autoAcceptTruckOffers(now){
 if(activeWorld()!=='truck'||!truckOffers||!truckGarage||!ready)return;
 if(truckAutoSeconds()>0&&now<truckOffers.nextAutoAt)return;
 truckOffers.nextAutoAt=now+truckAutoSeconds();dirty=true;
 if(truckLevelNumber()<2)return;
 // One half-hour clock slot can dispatch each idle truck once.
 for(const vehicle of truckIdleVehicles()){
  if(state.units.length>=MAX_TOTAL||ownedActiveCount()>=INVOLVED_MAX_MISSIONS)break;
  const offer=truckOffers.offers.find(o=>o.type!=='outsource'&&o.from===vehicle.location&&
   (o.type==='single'?'trailer':'cargo')===truckVehicleModel(vehicle).kind&&
   o.distanceKm<=Math.min(truckMaxKm(),truckVehicleModel(vehicle).maxKm));
  if(offer)dispatchTruckOffer(offer,now,'auto');
 }
 // Outsourcing is dispatched from the company depot, not an arbitrary city.
 if(state.units.length<MAX_TOTAL&&ownedActiveCount()<INVOLVED_MAX_MISSIONS){
  const extra=truckOffers.offers.find(o=>o.type==='outsource'&&o.from===TRUCK_CITIES[0]&&canAcceptTruck(o));
  if(extra)dispatchTruckOffer(extra,now,'auto');
 }
 fillTruckOffers();
}
function finishTruckTrip(v,at){
 const settlement=compensationSettlementAmount(v.shareUnits,at);
 if(!commonFunds||!Number.isSafeInteger(v.shareUnits)||v.shareUnits<0||!Number.isSafeInteger(commonFunds.balance+settlement)||
    !financeLedger||!Number.isSafeInteger(financeLedger.totalIncome+settlement))return;
 commonFunds.balance+=settlement;
 recordFinanceTransaction(v.contractType==='outsource'?'truck-outsource':'truck-owned',v.shareUnits,at,v.id);
 recordCompensationIncome(v.shareUnits,at,v.id);
 const car=truckVehicleById(v.vehicleId);
 if(car&&car.activeMissionId===v.id){car.activeMissionId=0;car.trips++;car.location=v.to;
  if(car.origin==='city'&&car.recallAfterMission)truckGarage.vehicles=truckGarage.vehicles.filter(x=>x.id!==car.id);
 }dirty=true;
}
function truckMissionText(v){
 if(v.truckContractVersion===2)
  return '로드트레인 '+v.trailers.length+'대 · 현재 '+v.location+' → '+v.to+
   ' · 다음 목적지 '+v.to+' · 잔여 계약 '+formatCommonFunds(v.trailers.reduce((a,t)=>a+t.shareUnits,0));
 return v.from+' → '+v.to+' · '+v.distanceKm.toLocaleString('ko-KR')+'km'+
 (Number.isSafeInteger(v.kmRate)?' · km당 '+v.kmRate.toLocaleString('ko-KR')+'원':'')+
 ' · 수익률 '+v.rate+'%'+(v.multiplier>1?' × '+v.multiplier:'')+' · 정산 '+formatCommonFunds(v.shareUnits);
}
function drawTruckOffers(){
 if(activeWorld()!=='truck'||!truckOffers)return;
 const holder=$('truck-offer-list'),fragment=document.createDocumentFragment();
 for(const offer of truckOffers.offers){
  const card=element('article','slot truck-offer'),head=element('div','slot-head'),name=element('div','slot-name');
  name.append(element('span','slot-icon',offer.type==='cargo'?'🚚':offer.type==='outsource'?'📦':'🚛'),element('strong','',TRUCK_JOB_NAMES[offer.type]));
  const vehicle=truckEligibleVehicle(offer),terms=truckContractTerms(offer,vehicle);
  head.append(name,element('strong','taxi-offer-amount',terms?formatCommonFunds(terms.shareUnits):'—'));
  const details=element('div','slot-details'),copy=element('span','taxi-offer-description',
  offer.from+' → '+offer.to+' · '+offer.distanceKm.toLocaleString('ko-KR')+'km'+
  (terms?' · km당 '+terms.kmRate.toLocaleString('ko-KR')+'원'+(terms.model?' · '+terms.model.name:''): ' · 이용 가능한 차량 없음'));
  const btn=element('button','slot-button',canAcceptTruck(offer)?'수락':'제한');
  btn.type='button';btn.disabled=!canAcceptTruck(offer)||truckAcceptBusy;btn.addEventListener('click',()=>acceptTruckOffer(offer.id));
  details.append(copy,btn);card.append(head,details);fragment.append(card);
 }holder.replaceChildren(fragment);
}
let truckBuyBusy=false;
function drawTruckPurchase(){
 if(activeWorld()!=='truck'||!truckGarage||!commonFunds)return;
 const select=$('truck-purchase-model');
 if(!select.options.length)for(const m of TRUCK_MODELS){const o=document.createElement('option');o.value=m.key;o.textContent=m.name;select.append(o);}
 const model=TRUCK_MODELS.find(m=>m.key===select.value)||TRUCK_MODELS[0];
 $('truck-purchase-count').textContent='보유 '+truckGarage.vehicles.length+' / '+truckFleetLimit()+'대';
 $('truck-event-status').hidden=true;
 const price=compensationPurchasePrice(model.price);
 $('truck-purchase-spec').textContent='km당 '+model.kmRate.toLocaleString('ko-KR')+'원 · 운송거리 '+model.maxKm.toLocaleString('ko-KR')+'km 한도 · 신차 '+formatManwon(model.price)+(price!==model.price?' → '+formatManwon(price)+' (50% 할인)':'');
 $('truck-purchase-action').textContent='차량 구입 · '+formatCommonFunds(price);
 $('truck-purchase-action').disabled=truckBuyBusy||worldSwitchBusy||truckGarage.vehicles.length>=truckFleetLimit()||commonFunds.balance<price;
 $('truck-purchase-note').textContent=truckGarage.vehicles.length>=truckFleetLimit()?'차량 보유 한도 '+truckFleetLimit()+'대':
 commonFunds.balance<price?'구입 자금이 부족합니다.':'선택한 트럭이 차량 목록에 추가됩니다.';
 const pool=element('div','truck-owned-list');
 for(const v of truckGarage.vehicles){
  const m=TRUCK_MODELS.find(m=>m.key===v.model);
  pool.append(element('span','truck-owned-chip',m.name+' '+v.id+'호 · '+(v.activeMissionId?'운행 중':'대기')+' · '+v.location));
 }$('truck-owned-pool').replaceChildren(pool);
}
async function buyTruck(){
 if(truckBuyBusy||activeWorld()!=='truck'||!ready||!commonFunds||!truckGarage)return;
 const model=TRUCK_MODELS.find(m=>m.key===$('truck-purchase-model').value);
 if(!model||truckGarage.vehicles.length>=truckFleetLimit()||commonFunds.balance<compensationPurchasePrice(model.price))return;
 truckBuyBusy=true;
 try{const now=Math.floor(Date.now()/1000),price=compensationPurchasePrice(model.price,now);advance(now);
  if(truckGarage.vehicles.length>=truckFleetLimit()||commonFunds.balance<price)return;
  if(!truckAddVehicle(model.key,'new'))return;
   truckGarage.vehicles[truckGarage.vehicles.length-1].paidPrice=price;
  commonFunds.balance-=price;
  recordFinanceTransaction('vehicle-purchase',-price,now,truckGarage.nextId-1);dirty=true;await save(now);
 }finally{truckBuyBusy=false;draw(Math.floor(Date.now()/1000));}
}
function milestoneAvailable(){
 if(!worldProgress)return 0;
 if((activeWorld()==='taxi'&&taxiMaster())||(activeWorld()==='truck'&&truckMaster()))return 10; // A world's MASTER may always switch.
  if(activeWorld()==='bus')return taxiMaster()||truckMaster()?10:0;
 const w=activeWorld(),lv=currentWorldLevel(),milestone=Math.floor(lv/10)*10;
 return milestone>=10&&milestone>worldProgress.seen[w]?milestone:0;
}
function drawWorldSwitchCard(){
 const card=$('world-switch-card'),milestone=milestoneAvailable(),master=activeWorld()==='bus'?false:activeWorld()==='taxi'?taxiMaster():truckMaster();
 card.hidden=!milestone;
 if(!milestone)return;
 $('world-keep').hidden=master||activeWorld()==='bus';
 $('world-switch-level').textContent=activeWorld()==='bus'?'버스 LV.1 · 기존 마스터 월드 복귀 가능':master?(activeWorld()==='taxi'?'택시':'트럭')+' 마스터 · 자유로운 월드 이전':
  (activeWorld()==='taxi'?'택시':'트럭')+' LV.'+milestone+' · 월드 이전 기회';
 $('world-switch-taxi').hidden=activeWorld()==='taxi'||activeWorld()==='bus'&&!taxiMaster();
 $('world-switch-truck').hidden=activeWorld()==='truck'||activeWorld()==='bus'&&!truckMaster();
  $('world-switch-bus').hidden=activeWorld()==='bus';
  $('world-switch-bus').textContent=worldProgress.visited.bus?'버스 월드로 복귀':'버스 월드 최초 진출';
 $('world-switch-truck').textContent=worldProgress.visited.truck?'트럭 월드로 복귀':'트럭 월드 최초 진출';
 $('world-switch-warning').hidden=!worldSwitchTarget;
 $('world-switch-confirm').hidden=!worldSwitchTarget;
 if(worldSwitchTarget){
  const previous=worldProgress.visited[worldSwitchTarget];
  $('world-switch-warning').textContent=({taxi:'택시',truck:'트럭',bus:'버스'}[worldSwitchTarget])+
   (previous?' 월드의 저장된 레벨로 복귀합니다.':' 월드 LV.1부터 시작합니다.')+
   ' 이전 월드의 성장·보유 차량·공용 자금·기존 계약 정산은 유지됩니다. 무료 지급 차량은 현재 월드에서만 이용합니다.';
 }
}
async function switchWorld(target){
 if(!ready||resetBusy||worldSwitchBusy||!milestoneAvailable()||target===activeWorld()||!['taxi','truck','bus'].includes(target))return;
  if(activeWorld()==='bus'&&!(target==='taxi'&&taxiMaster()||target==='truck'&&truckMaster()))return;
 worldSwitchBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);grantTaxiMasterReward(now);grantTruckMasterReward(now);
  const from=activeWorld();
  worldProgress.seen[from]=Math.max(worldProgress.seen[from],Math.floor(currentWorldLevel()/10)*10);
  recallWorldVehicles(from);
  // Never reset taxiLevel.completed, truckGarage.completed, or purchased upgrades.
  // Keep world offer boards and milestone-use flags for a later return.
  if(target==='bus'&&!worldProgress.visited.bus){
    busState.lastAt=now;
    for(const v of busState.vehicles)v.createdAt=now;
   }
   worldProgress.active=target;worldProgress.visited[target]=true;worldProgress.cycles[target]++;
  if(target==='taxi'){grantCityVehicles();grantEventVehicles();}
  else if(target==='truck'){grantTruckEvent();grantTruckCity();fillTruckOffers();}
  renderTaxiFutureRewards.key=null;renderTaxiWaiting.signature=null;renderTaxiOffers.order=null;
  worldSwitchTarget=null;assetSalePending=null;dirty=true;offersDirty=true;await save(now);
 }finally{worldSwitchBusy=false;draw(Math.floor(Date.now()/1000));}
}
function renderWorldChrome(){
 const truck=activeWorld()==='truck',bus=activeWorld()==='bus';
  $('bus-world-panel').hidden=!bus;
  // Vehicle sales remain available in bus world.
  $('home-mission-board-title').textContent=bus?'버스 운영':'임무판';
  $('taxi-level-panel').hidden=bus;
  $('taxi-master-panel').hidden=bus;
  $('truck-master-panel').hidden=bus;
  $('home-running-separator').hidden=bus;
  $('slot-list').hidden=bus;
 ui.worldName.textContent=bus?'버스 월드':truck?'트럭 월드':'택시 월드';
 nav.home.setAttribute('aria-label',bus?'버스 월드 홈':truck?'트럭 월드 홈':'택시 월드 홈');
 $('taxi-offer-list').hidden=truck||bus;$('taxi-offer-empty').hidden=truck||bus;$('taxi-offer-rule').hidden=truck||bus;
 $('taxi-vehicle-waiting').hidden=truck||bus;$('taxi-purchase-area').hidden=truck||bus;
 $('truck-offer-list').hidden=!truck;$('truck-offer-rule').hidden=!truck;$('truck-purchase-area').hidden=!truck;
 if(!truck){
  $('level-future-summary').textContent='레벨 보상 전체보기 · LV.10까지';
  $('level-infinite-title').textContent='LV.10 마스터부터 능력 개발';
  $('level-infinite-note').textContent='자금으로 운송거리, 수익률 및 보유차량 한도를 확장할 수 있습니다.';
 }
}
function saleTerms(world,vehicle){
 if(vehicle.origin==='city')return null;
 const paid=world==='taxi'?(vehicle.playerPaidUnits??Math.max(0,vehicle.price-vehicle.remaining)):
   world==='bus'?(vehicle.purchasePrice??busEngine.PRICE):
   (vehicle.paidPrice??vehicle.newPrice);
  const gross=vehicle.origin==='event'?Math.floor(vehicle.newPrice/4):Math.floor(paid/2);
 const remaining=world==='taxi'?vehicle.remaining||0:0;
 return {gross,remaining,net:gross-remaining};
}
function drawWorldAssets(){
 // Purchased assets in all worlds remain available to sell.
 if(!worldProgress||!ownedGarage||!truckGarage||!commonFunds)return;
 const sellable=[
   ...ownedGarage.vehicles.filter(v=>v.origin!=='city').map(v=>({world:'taxi',v})),
   ...truckGarage.vehicles.filter(v=>v.origin!=='city').map(v=>({world:'truck',v})),
   ...(busState?.vehicles||[]).filter(v=>v.origin!=='city').map(v=>({world:'bus',v}))
  ],area=$('world-assets-area');area.hidden=!sellable.length;
 if(!sellable.length)return;
 $('world-assets-title').textContent='월드별 보유 차량 · 유지 또는 판매';
 const fragment=document.createDocumentFragment();
 for(const {world:from,v} of sellable){
  const model=from==='taxi'?TAXI_MODELS.find(x=>x.key===v.model):from==='truck'?TRUCK_MODELS.find(x=>x.key===v.model):{name:'MYON 솔라티'};
  const terms=saleTerms(from,v),key=from+':'+v.id,row=element('div','world-asset-row'),copy=element('div','world-asset-info');
  copy.append(element('strong','',model.name+' '+v.id+'호'),element('small','',(from==='taxi'?'':(v.origin==='event'?'이벤트 차량':'구입 차량')+' · ')+(v.activeMissionId?'운행 중 · 완료 후 판매 가능':'대기 · 유지 가능')));
  const action=element('button','slot-button',assetSalePending===key?'판매 확정':'판매 · '+formatManwon(terms.net));
  action.type='button';action.disabled=Boolean(v.activeMissionId)||worldSwitchBusy||terms.net+commonFunds.balance<0;
  action.addEventListener('click',()=>sellWorldAsset(from,v.id));row.append(copy,action);fragment.append(row);
 }$('world-assets-list').replaceChildren(fragment);
}
async function sellWorldAsset(world,id){
 if(!ready||worldSwitchBusy||autoUpdateReloadLock||busBusy||fleetBusy||vehicleBusy||truckBuyBusy||truckAcceptBusy)return;
 const garage=world==='taxi'?ownedGarage:world==='truck'?truckGarage:world==='bus'?busState:null,vehicle=garage?.vehicles.find(v=>v.id===id);
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
  garage.vehicles=garage.vehicles.filter(v=>v.id!==id);
   if(world==='taxi'){grantCityVehicles();grantEventVehicles();}
   if(world==='truck'){grantTruckEvent();grantTruckCity();}
   if(world==='bus')busUi.refresh();
   dirty=true;await save(now);
 }finally{worldSwitchBusy=false;draw(Math.floor(Date.now()/1000));}
}
$('truck-purchase-model').addEventListener('change',drawTruckPurchase);
$('truck-purchase-action').addEventListener('click',buyTruck);
$('world-keep').addEventListener('click',async()=>{
 if(!milestoneAvailable()||worldSwitchBusy)return;
 const now=Math.floor(Date.now()/1000);worldProgress.seen[activeWorld()]=Math.floor(currentWorldLevel()/10)*10;
 worldSwitchTarget=null;dirty=true;await save(now);draw(now);
});
for(const w of ['taxi','truck','bus'])$('world-switch-'+w).addEventListener('click',()=>{worldSwitchTarget=w;drawWorldSwitchCard();});
$('world-switch-confirm').addEventListener('click',()=>{if(worldSwitchTarget)switchWorld(worldSwitchTarget);});


function validCompensation(v){
 return Boolean(v&&v.schema===1&&Number.isSafeInteger(v.claimedAt)&&v.claimedAt>0&&
  Number.isSafeInteger(v.expiresAt)&&v.expiresAt===v.claimedAt+COMPENSATION_DURATION&&
  Number.isSafeInteger(v.giftIssued)&&v.giftIssued>=0&&v.giftIssued<=2);
}
async function startCompensation(){
 compensation=null;compensationModalOpen=false;compensationError='';
 if(!IS_LIVE)return;
 const saved=await read(COMPENSATION_KEY);
 if(saved){
  if(!validCompensation(saved))throw new Error('Invalid compensation record; original preserved');
  compensation=saved;
 }else{
  if(financeLedger&&financeLedger.entries.some(e=>e.category==='compensation-grant'))
   throw new Error('Compensation payment exists without claim record; duplicate payout blocked');
  compensationModalOpen=true;
 }
}
function insertGiftTaxi(garage){
 const used=new Set(garage.vehicles.map(v=>v.fleetNo).filter(Boolean));
 let number=1;while(used.has(number)&&number<=100)number++;
 if(number>100)return false;
 const id=garage.nextId++;
 garage.vehicles.push({id,fleetNo:number,model:'myon',origin:'event',compensationGift:true,
  newPrice:20000000,price:0,remaining:0,durability:100000,serviceRuns:0,trips:0,
  location:'긴급 복구 보상 차고지',activeMissionId:0});
 return true;
}
function deliverPendingCompensationCars(){
 if(!compensation||compensation.giftIssued>=2||!ownedGarage)return;
 while(compensation.giftIssued<2&&ownedGarage.vehicles.length<taxiFleetLimit()){
  if(!insertGiftTaxi(ownedGarage))break;
  compensation.giftIssued++;dirty=true;
 }
}
function compensationCountdown(now){
 const remaining=Math.max(0,compensation.expiresAt-now);
 return Math.floor(remaining/DAY)+'일 '+hms(remaining%DAY);
}
function drawCompensation(now){
 const active=compensation&&now<compensation.expiresAt;
 $('compensation-notice').hidden=Boolean(compensation&&!active);
 $('compensation-benefit').hidden=!active;
 if(active){
  $('compensation-countdown').textContent='남은 시간 '+compensationCountdown(now);
  $('compensation-remaining-cars').textContent=compensation.giftIssued<2?
   ' · 택시 '+(2-compensation.giftIssued)+'대 지급 대기':'';
 }
 $('compensation-notice-action').textContent=compensation?'보상 내역':'보상 확인';
 $('compensation-overlay').hidden=!compensationModalOpen;
 $('compensation-claim').hidden=Boolean(compensation);
 $('compensation-claim').disabled=compensationBusy;
 $('compensation-popup-subtitle').textContent=compensation?
  '공용자금 100,000 M 지급 완료 · '+(active?'남은 혜택 '+compensationCountdown(now):'혜택 기간 종료'):
  '세이브 오류 복구 사과 보상 · 수락 시 즉시 지급';
 $('compensation-error').textContent=compensationError;
}


async function claimCompensation(){
 if(!ready||!IS_LIVE||compensationBusy||compensation||!commonFunds||!ownedGarage||!financeLedger)return;
 compensationBusy=true;compensationError='';
 try{
  const now=Math.floor(Date.now()/1000);
  advance(now);
  // Drain pending saves before the award; no stale funds snapshot may follow it.
  await save(now);
  const db=await openDb();
  const result=await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
   const keys=[COMPENSATION_KEY,FINANCE_KEY,OWNED_KEY,LEDGER_KEY],loaded={};
   let remaining=keys.length,completed=null,problem=null;
   const abort=msg=>{problem=new Error(msg);tx.abort();};
   for(const key of keys){
    const req=store.get(key);
    req.onsuccess=()=>{
     loaded[key]=req.result;
     if(--remaining>0)return;
     const funds=loaded[FINANCE_KEY],garage=loaded[OWNED_KEY],ledger=loaded[LEDGER_KEY],existing=loaded[COMPENSATION_KEY];
     if(existing){
      if(!validCompensation(existing)){abort('Invalid saved compensation: refuse overwrite');return;}
      completed={claim:existing,funds,garage,ledger,alreadyPaid:true};return;
     }
     if(!validCommonFunds(funds)||!validGarage(garage)||!validFinanceLedger(ledger)){
      abort('Saved funds, taxis or ledger invalid: refuse compensation write');return;
     }
     if(ledger.entries.some(e=>e.category==='compensation-grant')){
      abort('Previously recorded compensation: refuse duplicate grant');return;
     }
     const balance=funds.balance+COMPENSATION_FUNDS_UNITS,total=ledger.totalIncome+COMPENSATION_FUNDS_UNITS;
     if(!Number.isSafeInteger(balance)||!Number.isSafeInteger(total)){
      abort('Monetary safe limit exceeded');return;
     }
     const claim={schema:1,claimedAt:now,expiresAt:now+COMPENSATION_DURATION,giftIssued:0};
     while(claim.giftIssued<2&&garage.vehicles.length<taxiFleetLimit()){
      if(!insertGiftTaxi(garage))break;
      claim.giftIssued++;
     }
     funds.balance=balance;ledger.totalIncome=total;
     ledger.entries.unshift({id:48,at:now,category:'compensation-grant',amount:COMPENSATION_FUNDS_UNITS});
     if(ledger.entries.length>FINANCE_HISTORY_LIMIT)ledger.entries.length=FINANCE_HISTORY_LIMIT;
     store.put(funds,FINANCE_KEY);store.put(garage,OWNED_KEY);
     store.put(ledger,LEDGER_KEY);store.put(claim,COMPENSATION_KEY);
     completed={claim,funds,garage,ledger};
    };
   }
   tx.oncomplete=()=>resolve(completed);
   tx.onerror=()=>reject(problem||tx.error||new Error('Reward transaction failed'));
   tx.onabort=()=>reject(problem||tx.error||new Error('Reward transaction aborted'));
  });
  if(!result||!validCompensation(result.claim)||!validCommonFunds(result.funds)||
     !validGarage(result.garage)||!validFinanceLedger(result.ledger))
   throw new Error('Compensation transaction verification failed');
  compensation=result.claim;commonFunds=result.funds;ownedGarage=result.garage;financeLedger=result.ledger;
  drawVehicles.selectKey=null;renderTaxiWaiting.signature=null;
  if(result.alreadyPaid){
   compensationModalOpen=true;
   compensationError='이미 다른 탭에서 수령한 보상입니다. 저장 자료 보호를 위해 이 탭을 새로고침해 주세요.';
   drawCompensation(now);ready=false;return;
  }
  compensationModalOpen=false;dirty=true;await save(now);
 }catch(error){
  console.error('MYON compensation claim blocked:',error);
  compensationError='지급이 완료되지 않았습니다. 기존 데이터를 보호했어요. 다시 확인해 주세요.';
 }finally{compensationBusy=false;draw(Math.floor(Date.now()/1000));}
}
$('compensation-notice-action').addEventListener('click',()=>{
 compensationModalOpen=true;drawCompensation(Math.floor(Date.now()/1000));
});
$('compensation-close').addEventListener('click',()=>{
 compensationModalOpen=false;compensationError='';drawCompensation(Math.floor(Date.now()/1000));
});
$('compensation-claim').addEventListener('click',claimCompensation);

// Shared funds use an isolated save record; legacy missions and progression remain untouched.
function validCommonFunds(value){
 return Boolean(value&&value.schema===1&&Number.isSafeInteger(value.balance)&&value.balance>=0);
}
async function startCommonFunds(){
 commonFunds={schema:1,balance:0};
 if(!IS_LIVE)return;
 try{
  const saved=await read(FINANCE_KEY);
  if(saved){if(!validCommonFunds(saved))throw new Error('Invalid saved funds; refuse overwrite');commonFunds=saved;return;}
  // Do not zero funds if the existing finance ledger says a player played.
  if(await read(LEDGER_KEY))throw new Error('Funds record missing while history exists; refusing zero balance');
  await putRecord(FINANCE_KEY,commonFunds);
 }catch(error){console.error('MYON common funds:',error);throw error;}
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


// v0.13.53 — Shared capacity (buying only) and per-world acceptance automation.
function drawWorldUpgrades(){
 if(!worldProgress||!taxiLevel||!truckGarage||!commonFunds)return;
 const cap=sharedFleetLimit(),fleet=$('world-fleet-buy');
 $('world-fleet-count').textContent='월드별 '+cap+' / 100대 · 해금 '+sharedFleetSteps()+'/5';
 fleet.textContent=cap>=100?'최대 100대 해금 완료':'차량 한도 +10대 · '+formatCommonFunds(SHARED_FLEET_PRICE);
 fleet.disabled=cap>=100||!ready||worldUpgradeBusy||worldSwitchBusy||autoUpdateReloadLock||commonFunds.balance<SHARED_FLEET_PRICE;
 const world=activeWorld(),section=$('world-auto-upgrade');section.hidden=world==='bus';
 if(world==='bus')return;
 const taxi=world==='taxi',steps=taxi?taxiAutoSteps():truckAutoSteps(),max=taxi?25:30;
 const seconds=taxi?taxiAutoSeconds():truckAutoSeconds();
 const active=taxi?levelNumber()>=2:truckLevelNumber()>=2;
 const rate=autoEarningsRate(taxi?40:truckRevenue(),steps);
 $('world-auto-count').textContent=seconds===0?'즉시 자동수락':(seconds/60)+'분 자동수락';
 $('world-auto-rate').textContent='자동 정산율 '+rate.toFixed(1)+'% · 수동 +50% · '+steps+'/'+max+'회';
 const button=$('world-auto-buy');
 button.textContent=steps>=max?'최대 해금 완료':!active?'LV.2부터 이용 가능':'자동수락 -1분 · '+formatCommonFunds(AUTO_MINUTE_PRICE);
 button.disabled=!active||steps>=max||!ready||worldUpgradeBusy||worldSwitchBusy||autoUpdateReloadLock||commonFunds.balance<AUTO_MINUTE_PRICE;
}
async function buyWorldUpgrade(kind){
 if(!ready||resetBusy||worldSwitchBusy||autoUpdateReloadLock||worldUpgradeBusy||
    !worldProgress||!taxiLevel||!truckGarage||!commonFunds)return;
 const world=activeWorld(),taxi=world==='taxi';
 const valid=kind==='fleet'?sharedFleetSteps()<5:
  kind==='auto'&&world!=='bus'&&(taxi?levelNumber()>=2&&taxiAutoSteps()<25:truckLevelNumber()>=2&&truckAutoSteps()<30);
 if(!valid)return;
 const price=kind==='fleet'?SHARED_FLEET_PRICE:AUTO_MINUTE_PRICE;
 if(commonFunds.balance<price)return;
 worldUpgradeBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advance(now);advanceBusWorld(now);
  if(commonFunds.balance<price)return;
  if(kind==='fleet')worldProgress.fleetUnlocks++;
  else if(taxi){
   taxiLevel.upgrades.autoMinutes++;
   taxiOffers.nextAutoAt=taxiNextAutoAt(now);
   taxiOffers.autoInterval=taxiAutoSeconds();offersDirty=true;
  }else{
   truckGarage.upgrades.autoMinutes++;
   truckOffers.nextAutoAt=now+truckAutoSeconds();
  }
  commonFunds.balance-=price;
  recordFinanceTransaction('ability-unlock',-price,now,kind==='fleet'?53:taxi?54:55);
  dirty=true;await save(now);
 }finally{worldUpgradeBusy=false;draw(Math.floor(Date.now()/1000));}
}
$('world-fleet-buy').addEventListener('click',()=>buyWorldUpgrade('fleet'));
$('world-auto-buy').addEventListener('click',()=>buyWorldUpgrade('auto'));

async function startBusWorld(now){
 busState=busEngine.initial(now);
 if(!IS_LIVE)return;
 const saved=await read(BUS_KEY);
 if(saved){if(!busEngine.valid(saved))throw Error('Invalid bus-world save; original record protected');busState=saved;}
 else dirty=true;
}
function advanceBusWorld(now){
 if(!busState||!worldProgress?.visited.bus||!commonFunds||!financeLedger)return;
 const result=busEngine.advance(busState,now);
 if(result.changed)dirty=true;
 for(const entry of result.settlements){
  if(entry.payout<=0)continue;
  if(!Number.isSafeInteger(commonFunds.balance+entry.payout)||!Number.isSafeInteger(financeLedger.totalIncome+entry.payout)){
   console.error('MYON bus settlement overflow: preserve previous saved state');ready=false;return;
  }
  commonFunds.balance+=entry.payout;
  recordFinanceTransaction('bus-operation',entry.payout,entry.at,entry.id);dirty=true;
 }
}
function drawBusWorld(){
 if(!busState||!commonFunds)return;
 busUi.draw(busState,{rate:busEngine.rate(busState),funds:commonFunds.balance,
  busy:busBusy||worldSwitchBusy||autoUpdateReloadLock,ready,format:formatCommonFunds,engine:busEngine,fleetLimit:sharedFleetLimit()});
}
async function toggleBusVehicle(id){
 if(!ready||busBusy||worldSwitchBusy||autoUpdateReloadLock||activeWorld()!=='bus')return;
 const v=busState.vehicles.find(x=>x.id===id);if(!v)return;
 busBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advanceBusWorld(now);
  v.enabled=!v.enabled;busState.lastAt=now;dirty=true;
  await save(now);busUi.refresh();
 }finally{busBusy=false;draw(Math.floor(Date.now()/1000));}
}
async function buyBusVehicle(){
 if(!ready||busBusy||worldSwitchBusy||autoUpdateReloadLock||activeWorld()!=='bus'||!busState||!commonFunds)return;
 if(busState.vehicles.length>=sharedFleetLimit()||commonFunds.balance<busEngine.PRICE)return;
 busBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advanceBusWorld(now);
  if(commonFunds.balance<busEngine.PRICE)return;
  const v=busEngine.addVehicle(busState,now,sharedFleetLimit());if(!v)return;
  v.purchasePrice=busEngine.PRICE;
  commonFunds.balance-=busEngine.PRICE;
  recordFinanceTransaction('vehicle-purchase',-busEngine.PRICE,now,v.id);
  dirty=true;await save(now);busUi.refresh();
 }finally{busBusy=false;draw(Math.floor(Date.now()/1000));}
}
async function buyBusRevenue(){
 if(!ready||busBusy||worldSwitchBusy||autoUpdateReloadLock||activeWorld()!=='bus'||!busState||!commonFunds)return;
 if(busEngine.rate(busState)>=100||commonFunds.balance<busEngine.REVENUE_UNLOCK_PRICE)return;
 busBusy=true;
 try{
  const now=Math.floor(Date.now()/1000);advanceBusWorld(now);
  if(busEngine.rate(busState)>=100||commonFunds.balance<busEngine.REVENUE_UNLOCK_PRICE)return;
  commonFunds.balance-=busEngine.REVENUE_UNLOCK_PRICE;busState.upgrades.revenue++;
  recordFinanceTransaction('ability-unlock',-busEngine.REVENUE_UNLOCK_PRICE,now,52);
  dirty=true;await save(now);
 }finally{busBusy=false;draw(Math.floor(Date.now()/1000));}
}
busUi.init({onToggle:toggleBusVehicle});
$('bus-purchase').addEventListener('click',buyBusVehicle);
$('bus-revenue-buy').addEventListener('click',buyBusRevenue);

function draw(now){
 const date=new Date(now*1000);
 ui.date.textContent=dateFmt.format(date).replace(/-/g,'.')+' ('+weekdayFmt.format(date)+')';
 ui.clock.textContent=timeFmt.format(date);
 drawCommonFunds();
 if(!ready)return;
 drawCompensation(now);
 renderWorldChrome();
  drawWorldUpgrades();
 if(activeWorld()==='bus'){
  $('board-accept-area').hidden=true;
  drawFinance(now);drawBusWorld();drawWorldAssets();drawWorldSwitchCard();
  drawAssistant(now);drawNotice(now);updateSettings(now);
  return;
 }
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
  if(slot.ownedNote)slot.ownedNote.textContent=v.kind==='truck'&&[1,2].includes(v.truckContractVersion)?truckMissionText(v):ownedTaxiMissionText(v);
  if(slot.bonusBadge){
   const earningTaxi=v.kind==='taxi'&&([2,3].includes(v.taxiContractVersion)&&v.contractType==='owned'||
    v.taxiContractVersion===1&&v.contractType==='outsource');
   const earningTruck=v.kind==='truck'&&(v.truckContractVersion===1||
    v.truckContractVersion===2&&v.stages.some(t=>t.phase==='unload'&&compensationActiveAt(t.end)));
   slot.bonusBadge.hidden=!(earningTaxi||earningTruck)||!compensationActiveAt(taskEnd(v))&&
    !(v.truckContractVersion===2&&earningTruck);
   if(!slot.bonusBadge.hidden)slot.bonusBadge.textContent='긴급보상 +200% · 기간 내 정산 시 추가 지급';
  }
  slot.status.textContent=info.status;
  slot.left.textContent=info.value;
  slot.right.textContent=countdown(v.end-now);
  slot.bar.style.width=(100*info.progress).toFixed(2)+'%';
 }
}
function tick(){
 const now=Math.floor(Date.now()/1000);
 if(ready&&!resetBusy&&!compensationBusy&&!autoUpdateReloadLock){advance(now);advanceBusWorld(now);deliverPendingCompensationCars();grantTaxiMasterReward(now);grantTruckMasterReward(now);if(activeWorld()==='taxi'){grantCityVehicles();grantEventVehicles();syncTaxiAutoCursor(now);advanceTaxiOffers(now);autoAcceptTaxiOffers(now);}
  else if(activeWorld()==='truck'){grantTruckEvent();grantTruckCity();fillTruckOffers();autoAcceptTruckOffers(now);}advanceProgression(now);advanceMenu(now);if((dirty||offersDirty)&&now-lastSave>=20)save(now);
  if(progressionDirty&&now-progressionLastSave>=2)saveProgression(now);
  if(menuDirty&&now-menuLastSave>=2)saveMenu(now);}
 draw(now);
}

/* Only this read-only verification bridge is exposed to the separate updater.
   A navigation is forbidden until every existing saved record matches memory. */
window.MYON_SAFE_UPDATE_CHECKPOINT=async function(){
 if(!IS_LIVE||!ready||autoUpdateReloadLock||resetBusy||compensationBusy||busBusy||
    fleetBusy||vehicleBusy||truckBuyBusy||truckAcceptBusy||worldSwitchBusy||worldUpgradeBusy||
    compensationModalOpen||document.hidden)return false;
 const focus=document.activeElement;
 if(focus&&/^(INPUT|TEXTAREA|SELECT)$/.test(focus.tagName||''))return false;
 autoUpdateReloadLock=true;
 try{
  const now=Math.floor(Date.now()/1000);
  advance(now);
  deliverPendingCompensationCars();
  await save(now);
  if(progressionDirty)saveProgression(now);
  if(menuDirty)saveMenu(now);
  await Promise.all([saveChain,progressionSaveChain,menuSaveChain,profileSaveChain]);
  if(!ready||dirty||offersDirty||progressionDirty||menuDirty||
     resetBusy||compensationBusy||fleetBusy||vehicleBusy||truckBuyBusy||
     truckAcceptBusy||worldSwitchBusy||worldUpgradeBusy)throw Error('Game save queue not clean');
  const records=[
   [KEY,state],[FINANCE_KEY,commonFunds],[LEDGER_KEY,financeLedger],
   [OWNED_KEY,ownedGarage],[TAXI_LEVEL_KEY,taxiLevel],[WORLD_KEY,worldProgress],
   [TRUCK_GARAGE_KEY,truckGarage],[TAXI_OFFERS_KEY,taxiOffers],[TRUCK_OFFERS_KEY,truckOffers],[BUS_KEY,busState],
   [ASSISTANT_KEY,assistant],[COMPENSATION_KEY,compensation],
   [PROGRESSION_KEY,progression],[MENU_KEY,menuStudy],[PROFILE_KEY,profile]
  ];
  for(const [key,expected] of records){
   if(expected==null)continue;
   const saved=await read(key);
   if(JSON.stringify(saved)!==JSON.stringify(expected))
    throw Error('Saved record differs from active game: '+key);
  }
  if(!ready||dirty||offersDirty||progressionDirty||menuDirty||
     compensationBusy||fleetBusy||vehicleBusy||truckBuyBusy||truckAcceptBusy||
     worldSwitchBusy||worldUpgradeBusy)throw Error('Game changed during save verification');
  // Keep the simulation paused only until parent navigation starts.
  return true;
 }catch(error){
  console.warn('MYON update save check failed. Original game remains open:',error);
  autoUpdateReloadLock=false;
  return false;
 }
};
window.MYON_CANCEL_UPDATE_LOCK=()=>{autoUpdateReloadLock=false;};

document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{const now=Math.floor(Date.now()/1000);if(ready&&!compensationBusy&&(dirty||offersDirty))save(now);if(ready&&progressionDirty)saveProgression(now);if(ready&&menuDirty)saveMenu(now);});
(async()=>{
 const now=Math.floor(Date.now()/1000);
 let saved=null,oldVehicles=null,oldConstruction=null;
 if(IS_LIVE){await preserveSaveRestorePoint(now);await preserveSaveRestorePoint(now,SAVE_RESTORE_POINT_48);await preserveSaveRestorePoint(now,SAVE_RESTORE_POINT_49);await preserveSaveRestorePoint(now,SAVE_RESTORE_POINT_52);}
 if(!IS_LIVE){state=initial(now);await startPlayerSettings();await startCommonFunds();await startFinanceLedger(now);await startOwnedGarage();await startTaxiOffers(now);await startAssistant(now,true);purgeNonTaxiMissions();await startTaxiLevel();await startWorldState();await startBusWorld(now);await startCompensation();await startProgression(now,true);await startMenu(now,true);ready=true;tick();setInterval(tick,1000);return;}
 try{
  saved=await read(KEY);
  if(!saved){oldVehicles=await read(OLD_VEHICLES);oldConstruction=await read(OLD_CONSTRUCTION);}
 }catch(e){console.error('MYON mission load:',e);throw e;}
 const firstVisit=!saved&&!oldVehicles&&!oldConstruction;
 if(firstVisit){
  // A vanished core mission key alongside other existing taxi saves must
  // never turn an established player into a brand-new game.
  const others=await Promise.all([read(FINANCE_KEY),read(OWNED_KEY),read(TAXI_LEVEL_KEY),read(WORLD_KEY),read(BUS_KEY)]);
  if(others.some(Boolean))throw new Error('Mission record missing although existing player data is present; original data protected');
 }
 if(saved&&!validWorld(saved))throw new Error('Existing mission save invalid; preserve and block writes');
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
 await startBusWorld(now);
 await startCompensation();
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
})().catch(error=>{
 console.error('MYON safe startup blocked:',error);
 const panel=$('board-accept-area'),note=$('taxi-offer-empty');
 if(panel)panel.hidden=false;
 if(note){note.hidden=false;note.textContent='기존 저장 자료 보호를 위해 로딩을 중단했습니다. 초기화하지 말고 오류를 확인해 주세요.';}
});
})();
