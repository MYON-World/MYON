(function(){
'use strict';
// v0.08.05: clock, IndexedDB autosave, and offline elapsed time are core systems.
const MAX_RUNNING=10;
const ARRIVAL_MIN=4000,ARRIVAL_MAX=8500;
const EXPIRY_MIN=17000,EXPIRY_MAX=33000;
const FINISH_MIN=120000,FINISH_MAX=360000;
const DB_NAME='myon-v00804-progress';
const STORE_NAME='game',SAVE_KEY='v00805-main',LEGACY_KEY='main';
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
let nextId=1,nextArrival=0,dbPromise=null,saveChain=Promise.resolve(),storageWarned=false;

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
   schema:2,kind:'game',savedAt:Date.now(),nextId,nextArrival,
   missions:Array.from(missions.values(),m=>({
     id:m.id,name:m.name,expiresAt:m.expiresAt,startedAt:m.startedAt,finishesAt:m.finishesAt
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
   if(countRunning()>=MAX_RUNNING){startWarning(m.ui);return;}
   m.startedAt=at;
   m.finishesAt=at+random(FINISH_MIN,FINISH_MAX);
   render(m,at);
   void persist();
 });
 render(m,now);
}
function spawn(now){
 const taken=new Set(Array.from(missions.values(),m=>m.name));
 const names=NAMES.filter(name=>!taken.has(name));
 if(!names.length)return false;
 const name=names[random(0,names.length-1)];
 mount({id:nextId++,name,expiresAt:now+random(EXPIRY_MIN,EXPIRY_MAX),startedAt:null,finishesAt:null},now);
 return true;
}
function restoreJobs(raw,now){
 if(!Array.isArray(raw))return;
 const taken=new Set();
 for(const data of raw.slice(0,100)){
   if(!data||!Number.isSafeInteger(data.id)||data.id<1||!NAMES.includes(data.name)||taken.has(data.name)||!timeValue(data.expiresAt))continue;
   const startedAt=timeValue(data.startedAt)?data.startedAt:null;
   const finishesAt=timeValue(data.finishesAt)?data.finishesAt:null;
   if(startedAt!==null&&!timeValue(finishesAt))continue;
   // Real-world elapsed time counts while the browser was closed.
   if(startedAt===null&&data.expiresAt<=now)continue;
   if(startedAt!==null&&finishesAt<=now)continue;
   taken.add(data.name);
   nextId=Math.max(nextId,data.id+1);
   mount({id:data.id,name:data.name,expiresAt:data.expiresAt,startedAt,finishesAt},now);
 }
}
function restoreCurrent(saved,now){
 nextId=Number.isSafeInteger(saved.nextId)&&saved.nextId>0?saved.nextId:1;
 nextArrival=timeValue(saved.nextArrival)?saved.nextArrival:now+random(ARRIVAL_MIN,ARRIVAL_MAX);
 restoreJobs(saved.missions,now);
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
     changed=remove(m)||changed;
   }else render(m,now);
 }
 if(now>=nextArrival){
   changed=spawn(now)||changed;
   // Skip backlogged random arrivals while away: spawn at most one on return.
   nextArrival=now+random(ARRIVAL_MIN,ARRIVAL_MAX);
   changed=true;
 }
 if(changed)void persist();
}
async function initialize(){
 updateClock(Date.now());
 const now=Date.now();
 nextArrival=now+random(ARRIVAL_MIN,ARRIVAL_MAX);
 let current=null,legacy=null,storageAvailable=true;
 try{
   current=await readRecord(SAVE_KEY);
   if(!current)legacy=await readRecord(LEGACY_KEY);
 }catch(e){storageAvailable=false;}
 const at=Date.now();
 if(current&&current.schema===2&&current.kind==='game'){
   restoreCurrent(current,at);
 }else if(!restoreLegacy(legacy,at)){
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