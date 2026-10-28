(function(){
'use strict';
// v0.09.01 taxi operations: separate save key, existing mission data untouched.
const DB_NAME='myon-v00804-progress',STORE='game',KEY='v00901-taxi';
const DAY=86400000,MAX_VEHICLES=30,LEVEL_EXP=300,BASE_PRICE_M=25.95;
const TRIP_SPEED_KMH=30; // Temporary city-speed estimate; not a final balancing decision.
const list=document.getElementById('missions');
const elements={
 money:document.getElementById('common-balance'),
 level:document.getElementById('taxi-level'),
 exp:document.getElementById('taxi-exp'),
 expBar:document.getElementById('taxi-exp-bar'),
 levelInfo:document.getElementById('taxi-level-info'),
 levelButton:document.getElementById('taxi-level-button'),
 fleet:document.getElementById('taxi-fleet-count'),
 price:document.getElementById('taxi-purchase-price'),
 aid:document.getElementById('taxi-aid'),
 buyButton:document.getElementById('taxi-buy'),
 buyInfo:document.getElementById('taxi-buy-info'),
 owned:document.getElementById('taxi-owned'),
 fare:document.getElementById('taxi-skill-fare'),
 night:document.getElementById('taxi-skill-night'),
 support:document.getElementById('taxi-skill-support'),
 priceSkill:document.getElementById('taxi-skill-price')
};
const blank=()=>({
 schema:1, fundsM:0, level:1, exp:0, completed:0, levelUnlockAt:null,
 nextVehicleId:1, lastAcquiredAt:null, vehicles:[],
 supportStep:0, priceStep:1, nightUnlocked:false
});
let state=blank(),ready=false;
const cards=new Map(),moneyFormatter=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:6});
let dbPromise,saveQueue=Promise.resolve(),saveFailed=false;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const capInt=(v,min,max,fallback)=>Number.isSafeInteger(v)&&v>=min&&v<=max?v:fallback;
const cashM=n=>moneyFormatter.format(Math.round((n+Number.EPSILON)*1e6)/1e6)+' M';
const pad=n=>String(n).padStart(2,'0');
function duration(ms){
 const s=Math.max(0,Math.ceil(ms/1000));
 return pad(Math.floor(s/3600))+':'+pad(Math.floor(s%3600/60))+':'+pad(s%60);
}
function kstHour(now){return new Date(now+9*3600000).getUTCHours();}
function canDepart(now){const hour=kstHour(now);return state.nightUnlocked||hour>=4&&hour<22;}
function openDb(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
   if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
   const request=window.indexedDB.open(DB_NAME,1);
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error||new Error('DB unavailable'));
 }).catch(err=>{dbPromise=null;throw err;});
 return dbPromise;
}
async function read(){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
   const req=db.transaction(STORE,'readonly').objectStore(STORE).get(KEY);
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||new Error('Read failed'));
 });
}
async function write(data){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).put(data,KEY);
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||new Error('Save failed'));
   tx.onabort=()=>reject(tx.error||new Error('Save aborted'));
 });
}
function persist(){
 if(!ready)return;
 const data=JSON.parse(JSON.stringify(state));
 saveQueue=saveQueue.catch(()=>{}).then(()=>write(data));
 saveQueue.catch(()=>{
   if(!saveFailed){saveFailed=true;window.alert('택시 운영 데이터 자동저장에 실패했습니다.');}
 });
}
function restore(data){
 if(!data||data.schema!==1)return;
 state.fundsM=finite(data.fundsM)?data.fundsM:0;
 state.level=capInt(data.level,1,Number.MAX_SAFE_INTEGER,1);
 state.exp=capInt(data.exp,0,Number.MAX_SAFE_INTEGER,0);
 state.completed=capInt(data.completed,0,Number.MAX_SAFE_INTEGER,0);
 state.levelUnlockAt=finite(data.levelUnlockAt)?data.levelUnlockAt:null;
 state.nextVehicleId=capInt(data.nextVehicleId,1,Number.MAX_SAFE_INTEGER,1);
 state.lastAcquiredAt=finite(data.lastAcquiredAt)?data.lastAcquiredAt:null;
 state.supportStep=capInt(data.supportStep,0,10,0);
 state.priceStep=capInt(data.priceStep,1,10,1);
 state.nightUnlocked=data.nightUnlocked===true;
 const seen=new Set();
 if(Array.isArray(data.vehicles)){
   for(const v of data.vehicles.slice(0,MAX_VEHICLES)){
     if(!v||!Number.isSafeInteger(v.id)||v.id<1||seen.has(v.id))continue;
     seen.add(v.id);
     const trip=v.trip&&finite(v.trip.distanceKm)&&v.trip.distanceKm>=3&&v.trip.distanceKm<=10
       &&finite(v.trip.startedAt)&&finite(v.trip.finishesAt)
       &&v.trip.finishesAt>v.trip.startedAt
       ?{distanceKm:v.trip.distanceKm,startedAt:v.trip.startedAt,finishesAt:v.trip.finishesAt,
          payoutM:finite(v.trip.payoutM)?v.trip.payoutM:0}
       :null;
     state.vehicles.push({
       id:v.id,number:capInt(v.number,1,Number.MAX_SAFE_INTEGER,v.id),
       paidM:finite(v.paidM)?v.paidM:0,trip
     });
     state.nextVehicleId=Math.max(state.nextVehicleId,v.id+1);
   }
 }
}
function fareM(distanceKm){
 // Provisional proportion of Seoul's 1.6 km / 131 m tariff, adjusted by MYON base fare.
 const baseFareWon=Math.min(5000,1000*state.level);
 const extraSteps=Math.max(0,Math.ceil((distanceKm-1.6)/0.131));
 const fullFareWon=baseFareWon+extraSteps*(100*baseFareWon/4800);
 return fullFareWon/1000000;
}
function launch(vehicle,now){
 const distanceKm=(30+Math.floor(Math.random()*71))/10;
 vehicle.trip={
   distanceKm,startedAt:now,
   finishesAt:now+Math.round(distanceKm/TRIP_SPEED_KMH*3600000),
   payoutM:fareM(distanceKm)*(state.supportStep/10)
 };
}
function settle(vehicle){
 state.completed+=1;
 state.exp+=1;
 // Bonus is distinct from vehicle's own passenger-fare income.
 state.fundsM+=300*state.level+vehicle.trip.payoutM;
 vehicle.trip=null;
}
function makeCard(vehicle){
 const card=document.createElement('article');
 card.className='mission-card taxi-vehicle-card';
 const top=document.createElement('div'),bottom=document.createElement('div');
 top.className='taxi-card-row';bottom.className='taxi-card-row';
 const title=document.createElement('span'),time=document.createElement('span');
 const kms=document.createElement('span'),payout=document.createElement('span');
 title.className='mission-name';title.textContent='[택시] '+vehicle.number+'호차';
 time.className='countdown';
 kms.className='taxi-distance';payout.className='taxi-revenue';
 top.append(title,time);bottom.append(kms,payout);
 card.append(top,bottom);
 list.prepend(card);
 return {card,time,kms,payout};
}
function renderCards(now){
 const activeIds=new Set(state.vehicles.map(v=>v.id));
 for(const [id,ui] of cards)if(!activeIds.has(id)){ui.card.remove();cards.delete(id);}
 for(const [index,v] of state.vehicles.entries()){
   if(!cards.has(v.id))cards.set(v.id,makeCard(v));
   const ui=cards.get(v.id);
   ui.card.style.order=String(-10000+index);
   if(v.trip){
     const remain=Math.max(0,v.trip.finishesAt-now);
     const km=v.trip.distanceKm*(remain/(v.trip.finishesAt-v.trip.startedAt));
     ui.time.textContent=duration(remain);
     ui.kms.textContent='남은 '+km.toFixed(1)+' km';
     ui.payout.textContent=cashM(v.trip.payoutM);
   }else{
     ui.time.textContent='대기';
     ui.kms.textContent='남은 — km';
     ui.payout.textContent='0 M';
   }
 }
}
function currentPriceM(){return BASE_PRICE_M*state.priceStep/10;}
function share(){return state.supportStep/10;}
function purchaseCostM(){return currentPriceM()*share();}
function drawOwned(){
 elements.owned.replaceChildren();
 for(const v of state.vehicles){
   const row=document.createElement('div');
   row.className='taxi-owned-row';
   const label=document.createElement('span');
   label.textContent='택시 '+v.number+'호차';
   const caption=document.createElement('span');
   caption.className='taxi-owned-cost';
   caption.textContent='자부담 '+cashM(v.paidM);
   const btn=document.createElement('button');
   btn.type='button';btn.className='taxi-action taxi-sell';btn.textContent='판매';
   btn.addEventListener('click',()=>sell(v.id));
   row.append(label,caption,btn);
   elements.owned.append(row);
 }
}
function draw(now){
 elements.money.textContent=cashM(state.fundsM);
 elements.level.textContent='Lv.'+state.level.toLocaleString('ko-KR');
 elements.exp.textContent=Math.min(state.exp,LEVEL_EXP)+' / '+LEVEL_EXP+' EXP';
 elements.expBar.style.width=(100*Math.min(state.exp,LEVEL_EXP)/LEVEL_EXP)+'%';
 const waiting=state.levelUnlockAt!==null;
 elements.levelButton.hidden=waiting||state.exp<LEVEL_EXP;
 if(waiting){
   elements.levelInfo.textContent='레벨업 해금 중 · '+duration(state.levelUnlockAt-now);
 }else if(state.exp>=LEVEL_EXP){
   elements.levelInfo.textContent='레벨업 조건 충족 · 해금시간 24시간';
 }else{
   elements.levelInfo.textContent='운행 1회 +1 EXP · 레벨업 해금 24시간';
 }
 elements.fleet.textContent=state.vehicles.length+' / '+MAX_VEHICLES+'대';
 elements.price.textContent=cashM(currentPriceM());
 elements.aid.textContent='시 지원 '+(100-state.supportStep*10)+'% · 자부담 '+(state.supportStep*10)+'%';
 const cooldown=state.lastAcquiredAt===null?0:Math.max(0,state.lastAcquiredAt+DAY-now);
 const cost=purchaseCostM();
 const full=state.vehicles.length>=MAX_VEHICLES;
 elements.buyButton.disabled=full||cooldown>0||state.fundsM+1e-9<cost;
 elements.buyButton.textContent='차량 확보';
 elements.buyInfo.textContent=full?'전체 보유 한도 30대':cooldown>0
   ?'다음 확보까지 '+duration(cooldown)
   :'필요 자부담 '+cashM(cost);
 elements.fare.textContent='기본요금 '+Math.min(5000,1000*state.level).toLocaleString('ko-KR')+'원 · 최대 5,000원';
 elements.night.textContent=state.nightUnlocked?'해금 완료':'잠금 · 주간 04:00~22:00';
 elements.support.textContent='시 지원 '+(100-state.supportStep*10)+'% / 10단계';
 elements.priceSkill.textContent='실차 가격 '+(state.priceStep*10)+'% / 10단계';
 renderCards(now);
}
function buy(){
 const now=Date.now();
 if(state.vehicles.length>=MAX_VEHICLES||state.lastAcquiredAt!==null&&now<state.lastAcquiredAt+DAY)return;
 const paidM=purchaseCostM();
 if(state.fundsM+1e-9<paidM)return;
 const id=state.nextVehicleId++;
 state.fundsM=Math.max(0,state.fundsM-paidM);
 state.vehicles.push({id,number:id,paidM,trip:null});
 state.lastAcquiredAt=now;
 if(canDepart(now))launch(state.vehicles[state.vehicles.length-1],now);
 drawOwned();draw(now);persist();
}
function sell(id){
 const index=state.vehicles.findIndex(v=>v.id===id);
 if(index<0)return;
 const vehicle=state.vehicles[index];
 if(!window.confirm('택시 '+vehicle.number+'호차를 판매할까요? 구매 당시 자부담의 50%를 회수합니다.'))return;
 state.fundsM+=vehicle.paidM*0.5;
 state.vehicles.splice(index,1);
 // Selling never resets the 24-hour acquisition restriction.
 drawOwned();draw(Date.now());persist();
}
function beginLevel(){
 const now=Date.now();
 if(state.exp<LEVEL_EXP||state.levelUnlockAt!==null)return;
 state.levelUnlockAt=now+DAY;
 draw(now);persist();
}
function tick(){
 if(!ready||document.hidden)return;
 const now=Date.now();
 let changed=false;
 if(state.levelUnlockAt!==null&&now>=state.levelUnlockAt){
   state.level+=1;
   state.exp-=LEVEL_EXP;
   state.levelUnlockAt=null;
   changed=true;
 }
 for(const v of state.vehicles){
   if(v.trip&&now>=v.trip.finishesAt){settle(v);changed=true;}
   if(!v.trip&&canDepart(now)){launch(v,now);changed=true;}
 }
 draw(now);
 if(changed)persist();
}
async function initialize(){
 try{restore(await read());}
 catch(err){if(!saveFailed){saveFailed=true;window.alert('택시 저장자료를 읽지 못했습니다. 브라우저 저장 설정을 확인해주세요.');}}
 ready=true;
 elements.buyButton.addEventListener('click',buy);
 elements.levelButton.addEventListener('click',beginLevel);
 drawOwned();tick();draw(Date.now());persist();
 let backup=Date.now();
 window.setInterval(()=>{
   tick();
   if(!document.hidden&&Date.now()-backup>=15000){backup=Date.now();persist();}
 },1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();persist();});
 window.addEventListener('pagehide',persist);
 window.addEventListener('pageshow',tick);
}
void initialize();
})();