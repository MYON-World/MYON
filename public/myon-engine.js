(function(){
'use strict';
// v0.08.09: sequential ten-stage mission-time research; layout, saved missions and auto-accept preserved.
const MAX_RUNNING=10,MAX_CARDS=10;
const AUTO_MISSION='자동 임무 수락';
const AUTO_DURATION=86400000,AUTO_INTERVAL=600000,AUTO_COOLDOWN=60000;
const TIME_PERCENT=[10,15,20,30,40,50,60,70,80,90,100];
const TIME_RESEARCH_MIN=[0,5,15,30,60,120,180,360,540,720,1440];
const MAX_TIME_LEVEL=10;
const upgradeName=level=>'임무시간 업그레이드 '+level;
const ARRIVAL_MIN=4000,ARRIVAL_MAX=8500;
const EXPIRY_MIN=17000,EXPIRY_MAX=33000;
// Real-world baseline estimates for balancing, not guaranteed real-world averages.
// 90% shorter: 1 real hour becomes 6 game minutes. Applies only when starting a new normal mission.
const REAL_WORK_HOURS = {
 1: ["생활 물자 운송", "긴급 물자 확보", "지역 의료 물품 확보", "지역 식료품 확보", "복지시설 물품 공급", "공공 급식 공급"],
 2: ["공공시설 점검", "도로 안전 점검", "통신 시설 점검", "정수시설 점검", "주거지역 전기 점검", "상업시설 안전 점검"],
 4: ["지역 전력 공급", "상가 물품 공급", "생활용수 확보", "공장 자재 운송", "가로등 정비", "정류장 시설 보수"],
 6: ["지역 환경 정비", "배수시설 정비", "물류 창고 정비", "공원 시설 정비", "폐기물 처리 지원", "지역 통신망 보수"],
 8: ["노후 시설 보수", "산업 설비 정비", "주거시설 보수", "산업단지 설비 보수", "학교 시설 보수"],
 12: ["노후 배관 교체", "하천 시설 복구", "산업 폐수 정비"]
};
const NORMAL_DURATION_MS = Object.fromEntries(
 Object.entries(REAL_WORK_HOURS).flatMap(([hours,names])=>
   names.map(name=>[name,Number(hours)*360000])
 )
);
const DB_NAME='myon-v00804-progress';
const STORE_NAME='game',SAVE_KEY='v00806-main',PRIOR_KEY='v00805-main',LEGACY_KEY='main';
const NAMES=[
'지역 전력 공급','생활 물자 운송','노후 시설 보수','공공시설 점검',
'상가 물품 공급','생활용수 확보','산업 설비 정비','도로 안전 점검',
'지역 환경 정비','긴급 물자 확보','주거시설 보수','공장 자재 운송',
'노후 배관 교체','지역 의료 물품 확보','통신 시설 점검','산업단지 설비 보수',
'배수시설 정비','지역 식료품 확보','학교 시설 보수','정수시설 점검',
'물류 창고 정비','주거지역 전기 점검','하천 시설 복구','상업시설 안전 점검',
'복지시설 물품 공급','공원 시설 정비','가로등 정비','정류장 시설 보수',
'폐기물 처리 지원','지역 통신망 보수','공공 급식 공급','산업 폐수 정비'
];
const list=document.getElementById('missions');
const dateEl=document.getElementById('clock-date');
const timeEl=document.getElementById('clock-time');
const missions=new Map();
const random=(min,max)=>min+Math.floor(Math.random()*(max-min+1));
const pad=n=>String(n).padStart(2,'0');
const timeValue=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
let nextId=1,nextArrival=0,autoUnlocked=false,nextAutoAt=0,cooldownUntil=0,timeLevel=0;
let dbPromise=null,saveChain=Promise.resolve(),storageWarned=false;

function updateClock(now){
 const kst=new Date(now+9*3600000);
 dateEl.textContent=kst.getUTCFullYear()+'.'+pad(kst.getUTCMonth()+1)+'.'+pad(kst.getUTCDate());
 timeEl.textContent=pad(kst.getUTCHours())+':'+pad(kst.getUTCMinutes());
 timeEl.dateTime=new Date(now).toISOString();
}
function countdown(ms,withHours){
 const seconds=Math.max(0,Math.ceil(ms/1000));
 if(withHours)return pad(Math.floor(seconds/3600))+':'+pad(Math.floor(seconds%3600/60))+':'+pad(seconds%60);
 return pad(Math.floor(seconds/60))+':'+pad(seconds%60);
}
function openDb(){
 if(!dbPromise){
   dbPromise=new Promise((resolve,reject)=>{
     if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
     const req=window.indexedDB.open(DB_NAME,1);
     req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE_NAME))req.result.createObjectStore(STORE_NAME);};
     req.onsuccess=()=>resolve(req.result);
     req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
   }).catch(err=>{dbPromise=null;throw err;});
 }
 return dbPromise;
}
async function readRecord(key){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE_NAME,'readonly');
   const req=tx.objectStore(STORE_NAME).get(key);
   req.onsuccess=()=>resolve(req.result||null);
   req.onerror=()=>reject(req.error||new Error('Save read failed'));
   tx.onerror=()=>reject(tx.error||new Error('Save read transaction failed'));
 });
}
async function writeRecord(data,key){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE_NAME,'readwrite');
   tx.objectStore(STORE_NAME).put(data,key);
   tx.oncomplete=()=>resolve();
   tx.onerror=()=>reject(tx.error||new Error('Save failed'));
   tx.onabort=()=>reject(tx.error||new Error('Save aborted'));
 });
}
function storageWarning(){
 if(storageWarned)return;
 storageWarned=true;
 window.alert('자동저장에 실패했습니다. 브라우저 저장 설정을 확인해주세요.');
}
function snapshot(){
 return {
   schema:3,kind:'game',savedAt:Date.now(),nextId,nextArrival,autoUnlocked,nextAutoAt,cooldownUntil,timeLevel,
   missions:Array.from(missions.values(),m=>({
     id:m.id,name:m.name,kind:m.kind,level:m.level??null,expiresAt:m.expiresAt,startedAt:m.startedAt,finishesAt:m.finishesAt
   }))
 };
}
function persist(){
 const value=snapshot();
 // Queue saves so an older async transaction cannot overwrite a newer state.
 saveChain=saveChain.catch(()=>{}).then(()=>writeRecord(value,SAVE_KEY));
 saveChain.catch(storageWarning);
 return saveChain;
}
function countRunning(){
 let count=0;
 for(const m of missions.values())if(m.startedAt!==null)count++;
 return count;
}
function sortCards(){
 const sorted=Array.from(missions.values()).sort((a,b)=>{
   const aw=a.startedAt===null,bw=b.startedAt===null;
   if(aw!==bw)return aw?-1:1;
   const at=aw?a.expiresAt:a.finishesAt;
   const bt=bw?b.expiresAt:b.finishesAt;
   return at-bt||a.id-b.id;
 });
 // Keep every v0.08.05 card in its original DOM position.
 // CSS flex order sorts the view without re-appending nodes, which caused
 // scroll jumps/reflow during mission arrivals and automatic acceptance.
 sorted.forEach((m,index)=>{
   const value=String(index);
   if(m.ui.el.style.order!==value)m.ui.el.style.order=value;
 });
}
function enableAuto(at){
 if(autoUnlocked)return false;
 autoUnlocked=true;
 cooldownUntil=at+AUTO_COOLDOWN;
 nextAutoAt=cooldownUntil;
 return true;
}
function startMission(m,at){
 if(!missions.has(m.id)||m.startedAt!==null||at>=m.expiresAt||countRunning()>=MAX_RUNNING)return false;
 // Upgrades are sequential and only their exact next stage is startable.
 if(m.kind==='time-upgrade'&&(m.level!==timeLevel+1||!Number.isInteger(m.level)))return false;
 const duration=m.kind==='auto-unlock'
   ?AUTO_DURATION
   :m.kind==='time-upgrade'
     ?TIME_RESEARCH_MIN[m.level]*60000
     :NORMAL_DURATION_MS[m.name]*(TIME_PERCENT[timeLevel]/10);
 if(!Number.isFinite(duration)||duration<=0)return false;
 m.startedAt=at;
 m.finishesAt=at+duration;
 render(m,at);sortCards();
 return true;
}
function automaticAccept(now){
 if(!autoUnlocked||now<nextAutoAt||now<cooldownUntil||countRunning()>=MAX_RUNNING)return false;
 const candidate=Array.from(missions.values())
  .filter(m=>m.startedAt===null&&m.expiresAt>now&&m.kind==='normal')
  .sort((a,b)=>a.expiresAt-b.expiresAt||a.id-b.id)[0];
 if(!candidate||!startMission(candidate,now))return false;
 nextAutoAt=now+AUTO_INTERVAL;
 cooldownUntil=now+AUTO_COOLDOWN;
 return true;
}
function createCard(name){
 const el=document.createElement('article');
 el.className='mission-card';
 const title=document.createElement('span');
 title.className='mission-name';title.textContent=name;title.title=name;
 const countdownEl=document.createElement('span');
 countdownEl.className='countdown';
 const start=document.createElement('button');
 start.type='button';start.className='mission-start';start.textContent='시작';
 el.append(title,countdownEl,start);
 list.append(el);
 return {el,countdownEl,start};
}
function render(m,now){
 const {start,countdownEl}=m.ui;
 if(m.startedAt===null){
   start.hidden=false;
   countdownEl.className='countdown expiry';
   countdownEl.textContent='폐기 '+countdown(m.expiresAt-now,false);
 }else{
   start.hidden=true;
   countdownEl.className='countdown';
   countdownEl.textContent=countdown(m.finishesAt-now,true);
 }
}
function remove(m){
 if(!missions.has(m.id))return false;
 missions.delete(m.id);m.ui.el.remove();
 return true;
}
function startWarning(ui){
 if(ui.el.querySelector('.warning'))return;
 const warning=document.createElement('span');
 warning.className='warning';warning.textContent='시작 불가';
 ui.el.append(warning);
 window.setTimeout(()=>warning.remove(),2500);
}
function mount(data,now){
 const m={...data,ui:createCard(data.name)};
 missions.set(m.id,m);
 m.ui.start.addEventListener('click',()=>{
   if(!missions.has(m.id)||m.startedAt!==null)return;
   const at=Date.now();
   if(at>=m.expiresAt){remove(m);void persist();return;}
   if(!startMission(m,at)){startWarning(m.ui);return;}
   void persist();
 });
 render(m,now);
}
function spawn(now){
 if(missions.size>=MAX_CARDS)return false;
 const taken=new Set(Array.from(missions.values(),m=>m.name));
 const names=NAMES.filter(name=>!taken.has(name));
 const eligibleAuto=!autoUnlocked&&!taken.has(AUTO_MISSION);
 const level=timeLevel+1;
 const eligibleTime=level<=MAX_TIME_LEVEL&&!Array.from(missions.values()).some(m=>m.kind==='time-upgrade');
 const specials=[];
 if(eligibleAuto)specials.push({kind:'auto-unlock',name:AUTO_MISSION,level:null});
 if(eligibleTime)specials.push({kind:'time-upgrade',name:upgradeName(level),level});
 if(!names.length&&!specials.length)return false;
 // Like the existing auto-accept upgrade, the next time upgrade is a random mission.
 // With both unlocks available, special spawns share the 25% slot probability.
 const special=specials.length&&(!names.length||Math.random()<0.25)
   ?specials[random(0,specials.length-1)]
   :null;
 const name=special?special.name:names[random(0,names.length-1)];
 mount({id:nextId++,name,kind:special?special.kind:'normal',level:special?special.level:null,
   expiresAt:now+random(EXPIRY_MIN,EXPIRY_MAX),startedAt:null,finishesAt:null},now);
 sortCards();
 return true;
}
function restoreJobs(raw,now){
 if(!Array.isArray(raw))return;
 const taken=new Set();
 for(const data of raw.slice(0,100)){
   if(!data||!Number.isSafeInteger(data.id)||data.id<1||!timeValue(data.expiresAt))continue;
   const auto=data.kind==='auto-unlock'&&data.name===AUTO_MISSION;
   const upgrade=data.kind==='time-upgrade'&&Number.isInteger(data.level)
     &&data.level>=1&&data.level<=MAX_TIME_LEVEL&&data.name===upgradeName(data.level);
   if(!auto&&!upgrade&&!NAMES.includes(data.name))continue;
   if(taken.has(data.name)||missions.size>=MAX_CARDS)continue;
   const startedAt=timeValue(data.startedAt)?data.startedAt:null;
   const finishesAt=timeValue(data.finishesAt)?data.finishesAt:null;
   if(startedAt!==null&&!timeValue(finishesAt))continue;
   nextId=Math.max(nextId,data.id+1);
   if(auto&&startedAt!==null&&finishesAt<=now){enableAuto(finishesAt);continue;}
   if(auto&&autoUnlocked)continue;
   if(upgrade){
     if(data.level!==timeLevel+1)continue;
     // One upgrade may finish offline. Unlock exactly that level, not later levels.
     if(startedAt!==null&&finishesAt<=now){timeLevel=data.level;continue;}
     if(Array.from(missions.values()).some(m=>m.kind==='time-upgrade'))continue;
   }
   if(startedAt===null&&data.expiresAt<=now)continue;
   if(startedAt!==null&&finishesAt<=now)continue;
   taken.add(data.name);
   mount({id:data.id,name:data.name,kind:auto?'auto-unlock':upgrade?'time-upgrade':'normal',
     level:upgrade?data.level:null,expiresAt:data.expiresAt,startedAt,finishesAt},now);
 }
 sortCards();
}
function restoreCurrent(saved,now){
 nextId=Number.isSafeInteger(saved.nextId)&&saved.nextId>0?saved.nextId:1;
 nextArrival=timeValue(saved.nextArrival)?saved.nextArrival:now+random(ARRIVAL_MIN,ARRIVAL_MAX);
 autoUnlocked=saved.autoUnlocked===true;
 nextAutoAt=timeValue(saved.nextAutoAt)?saved.nextAutoAt:0;
 cooldownUntil=timeValue(saved.cooldownUntil)?saved.cooldownUntil:0;
 timeLevel=Number.isInteger(saved.timeLevel)&&saved.timeLevel>=0&&saved.timeLevel<=MAX_TIME_LEVEL?saved.timeLevel:0;
 restoreJobs(saved.missions,now);
}
function restorePrior(saved,now){
 if(!saved||saved.schema!==2||saved.kind!=='game')return false;
 nextId=Number.isSafeInteger(saved.nextId)&&saved.nextId>0?saved.nextId:1;
 nextArrival=timeValue(saved.nextArrival)?saved.nextArrival:now+random(ARRIVAL_MIN,ARRIVAL_MAX);
 restoreJobs(saved.missions,now);
 return true;
}
function restoreLegacy(saved,now){
 // v0.08.04 had two research unlocks. These are now built in from the first launch.
 // Only already-persisted missions are transferable; an old research-only save
 // never contained its unsaved missions, and is therefore started with fresh jobs.
 if(!saved||saved.schema!==1||saved.kind!=='full'||saved.saveUnlocked!==true)return false;
 nextId=Number.isSafeInteger(saved.id)&&saved.id>0?saved.id:1;
 nextArrival=timeValue(saved.nextJob)?saved.nextJob:now+random(ARRIVAL_MIN,ARRIVAL_MAX);
 const jobs=Array.isArray(saved.jobs)?saved.jobs.map(j=>({
   id:j.id,name:j.name,expiresAt:j.expires,startedAt:j.started,finishesAt:j.ends
 })):[];
 restoreJobs(jobs,now);
 return true;
}
function tick(){
 if(document.hidden)return;
 const now=Date.now();
 updateClock(now);
 let changed=false;
 for(const m of missions.values()){
   if(m.startedAt===null&&now>=m.expiresAt||m.startedAt!==null&&now>=m.finishesAt){
     if(m.kind==='auto-unlock'&&m.startedAt!==null)changed=enableAuto(m.finishesAt)||changed;
     if(m.kind==='time-upgrade'&&m.startedAt!==null&&m.level===timeLevel+1){
       timeLevel=m.level;changed=true;
     }
     changed=remove(m)||changed;
   }else render(m,now);
 }
 changed=automaticAccept(now)||changed;
 if(missions.size<MAX_CARDS&&now>=nextArrival){
   changed=spawn(now)||changed;
   // Skip backlogged random arrivals while away: spawn at most one on return.
   nextArrival=now+random(ARRIVAL_MIN,ARRIVAL_MAX);
   changed=true;
 }
 if(changed){sortCards();void persist();}
}
async function initialize(){
 updateClock(Date.now());
 const now=Date.now();
 nextArrival=now+random(ARRIVAL_MIN,ARRIVAL_MAX);
 let current=null,prior=null,legacy=null,storageAvailable=true;
 try{
   current=await readRecord(SAVE_KEY);
   if(!current||current.schema!==3){
     prior=await readRecord(PRIOR_KEY);
     if(!prior)legacy=await readRecord(LEGACY_KEY);
   }
 }catch(e){storageAvailable=false;}
 const at=Date.now();
 if(current&&current.schema===3&&current.kind==='game'){
   restoreCurrent(current,at);
 }else if(!restorePrior(prior,at)&&!restoreLegacy(legacy,at)){
   for(let i=0;i<3;i++)spawn(at);
 }
 tick();
 if(storageAvailable)void persist();
 else storageWarning();
 let lastBackup=at;
 window.setInterval(()=>{
   tick();
   if(!document.hidden&&Date.now()-lastBackup>=15000){
     lastBackup=Date.now();
     void persist();
   }
 },1000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();void persist();});
 window.addEventListener('pagehide',()=>{void persist();});
 window.addEventListener('pageshow',tick);
}
void initialize();
})();