(function(){
'use strict';
const MAX_RUNNING=10,ARRIVAL_MIN=4000,ARRIVAL_MAX=8500,EXPIRY_MIN=17000,EXPIRY_MAX=33000;
const FINISH_MIN=120000,FINISH_MAX=360000,RESEARCH_MIN=8000,RESEARCH_MAX=25000;
const SAVE_DURATION=3600000,TIME_DURATION=86400000;
const NAMES=['지역 전력 공급','생활 물자 운송','노후 시설 보수','공공시설 점검',
'상가 물품 공급','생활용수 확보','산업 설비 정비','도로 안전 점검',
'지역 환경 정비','긴급 물자 확보','주거시설 보수','공장 자재 운송',
'노후 배관 교체','지역 의료 물품 확보','통신 시설 점검','산업단지 설비 보수',
'배수시설 정비','지역 식료품 확보','학교 시설 보수','정수시설 점검',
'물류 창고 정비','주거지역 전기 점검','하천 시설 복구','상업시설 안전 점검',
'복지시설 물품 공급','공원 시설 정비','가로등 정비','정류장 시설 보수',
'폐기물 처리 지원','지역 통신망 보수','공공 급식 공급','산업 폐수 정비'];
const list=document.getElementById('missions'),clock=document.getElementById('clock');
const jobs=new Map(),random=(a,b)=>a+Math.floor(Math.random()*(b-a+1)),pad=x=>String(x).padStart(2,'0');
const remain=(ms,long)=>{
 const n=Math.max(0,Math.ceil(ms/1000));
 return long?pad(Math.floor(n/3600))+':'+pad(Math.floor(n%3600/60))+':'+pad(n%60):pad(Math.floor(n/60))+':'+pad(n%60);
};
const clockFormat=now=>{
 const d=new Date(now+32400000);
 return d.getUTCFullYear()+'.'+pad(d.getUTCMonth()+1)+'.'+pad(d.getUTCDate())+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());
};
let id=1,clockUnlocked=false,saveUnlocked=false;
let timeStudy=null,saveStudy=null,promoting=false;
let nextJob=0,nextTimeStudy=0,nextSaveStudy=0,dbPromise=null,storageWarned=false,pausedAt=null;
function openDb(){
 if(!dbPromise){
   dbPromise=new Promise((resolve,reject)=>{
     if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
     const req=window.indexedDB.open('myon-v008-progress',1);
     req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('game'))req.result.createObjectStore('game');};
     req.onsuccess=()=>resolve(req.result);
     req.onerror=()=>reject(req.error||new Error('Database error'));
   }).catch(err=>{dbPromise=null;throw err;});
 }
 return dbPromise;
}
async function load(){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
   const tx=db.transaction('game','readonly'),req=tx.objectStore('game').get('main');
   req.onsuccess=()=>resolve(req.result||null);
   req.onerror=()=>reject(req.error||new Error('Read failed'));
   tx.onerror=()=>reject(tx.error||new Error('Read transaction failed'));
 });
}
async function store(value){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
   const tx=db.transaction('game','readwrite');
   tx.objectStore('game').put(value,'main');
   tx.oncomplete=()=>resolve();
   tx.onerror=()=>reject(tx.error||new Error('Save failed'));
   tx.onabort=()=>reject(tx.error||new Error('Save aborted'));
 });
}
function warn(){
 if(storageWarned)return;
 storageWarned=true;
 window.alert('브라우저 저장에 실패했습니다. 저장 설정과 용량을 확인해주세요.');
}
function snapshot(){
 return {schema:1,kind:'full',savedAt:pausedAt===null?Date.now():pausedAt,saveUnlocked:true,clockUnlocked,id,
   nextJob,nextTimeStudy,
   jobs:Array.from(jobs.values(),j=>({id:j.id,name:j.name,expires:j.expires,started:j.started,ends:j.ends})),
   timeStudy:timeStudy?{expires:timeStudy.expires,started:timeStudy.started,ends:timeStudy.ends}:null};
}
function persist(){
 if(saveUnlocked)store(snapshot()).catch(warn);
 else if(saveStudy&&saveStudy.started!==null){
   store({schema:1,kind:'research',started:saveStudy.started,ends:saveStudy.ends,
     savedAt:pausedAt===null?Date.now():pausedAt}).catch(warn);
 }
}
function card(title){
 const box=document.createElement('article');box.className='mission-card';
 const name=document.createElement('span');name.className='mission-name';name.textContent=title;name.title=title;
 const countdown=document.createElement('span');countdown.className='countdown';countdown.hidden=true;
 const status=document.createElement('span');status.className='mission-status';status.hidden=true;
 const start=document.createElement('button');start.type='button';start.className='mission-start';start.textContent='시작';
 box.append(name,countdown,status,start);
 list.append(box);
 return {box,countdown,status,start};
}
function note(ui,message){
 if(ui.box.querySelector('.warning'))return;
 const el=document.createElement('span');el.className='warning';el.textContent=message;ui.box.append(el);
 window.setTimeout(()=>el.remove(),2500);
}
function drawJob(j,now){
 const u=j.ui;
 if(j.started===null){
   u.start.hidden=false;u.status.hidden=true;u.countdown.hidden=!clockUnlocked;
   if(clockUnlocked){u.countdown.className='countdown expiry';u.countdown.textContent='폐기 '+remain(j.expires-now,false);}
 }else{
   u.start.hidden=true;u.status.hidden=clockUnlocked;u.countdown.hidden=!clockUnlocked;
   if(clockUnlocked){u.countdown.className='countdown';u.countdown.textContent=remain(j.ends-now,true);}
   else u.status.textContent='임무 진행중';
 }
}
function active(){
 let count=0;
 for(const j of jobs.values())if(j.started!==null)count++;
 if(timeStudy&&timeStudy.started!==null)count++;
 if(saveStudy&&(saveStudy.started!==null||saveStudy.pending))count++;
 return count;
}
function removeJob(j){jobs.delete(j.id);j.ui.box.remove();persist();}
function putJob(data,now){
 const j={...data,ui:card(data.name)};
 jobs.set(j.id,j);
 j.ui.start.addEventListener('click',()=>{
   if(!jobs.has(j.id)||j.started!==null)return;
   const at=Date.now();
   if(j.expires<=at){removeJob(j);return;}
   if(active()>=MAX_RUNNING){note(j.ui,'시작 불가');return;}
   j.started=at;j.ends=at+random(FINISH_MIN,FINISH_MAX);drawJob(j,at);persist();
 });
 drawJob(j,now);
}
function spawnJob(now){
 const taken=new Set(Array.from(jobs.values(),j=>j.name));
 const choices=NAMES.filter(n=>!taken.has(n));
 if(!choices.length)return;
 putJob({id:id++,name:choices[random(0,choices.length-1)],expires:now+random(EXPIRY_MIN,EXPIRY_MAX),started:null,ends:null},now);
 persist();
}
function study(kind){return kind==='save'?saveStudy:timeStudy;}
function setStudy(kind,value){if(kind==='save')saveStudy=value;else timeStudy=value;}
function drawStudy(s,now){
 if(s.started!==null){
   s.ui.start.hidden=true;s.ui.countdown.hidden=true;s.ui.status.hidden=false;
   s.ui.status.textContent='연구 진행중';
 }else{
   s.ui.start.hidden=false;s.ui.status.hidden=true;s.ui.countdown.hidden=!clockUnlocked;
   if(clockUnlocked){s.ui.countdown.className='countdown expiry';s.ui.countdown.textContent='폐기 '+remain(s.expires-now,false);}
 }
}
function clearStudy(kind,now){
 const s=study(kind);if(s){s.ui.box.remove();setStudy(kind,null);}
 if(kind==='save')nextSaveStudy=now+random(RESEARCH_MIN,RESEARCH_MAX);
 else nextTimeStudy=now+random(RESEARCH_MIN,RESEARCH_MAX);
 persist();
}
async function beginSave(s){
 if(saveStudy!==s||s.started!==null||s.pending)return;
 if(active()>=MAX_RUNNING){note(s.ui,'시작 불가');return;}
 const at=Date.now();
 if(at>=s.expires){clearStudy('save',at);return;}
 s.pending=true;s.ui.start.disabled=true;
 try{
   await store({schema:1,kind:'research',started:at,ends:at+SAVE_DURATION,savedAt:at});
   if(saveStudy!==s)return;
   s.started=at;s.ends=at+SAVE_DURATION;drawStudy(s,Date.now());
 }catch(e){s.pending=false;s.ui.start.disabled=false;note(s.ui,'저장 불가');warn();}
}
function beginTime(s){
 if(timeStudy!==s||s.started!==null)return;
 if(active()>=MAX_RUNNING){note(s.ui,'시작 불가');return;}
 const at=Date.now();
 if(at>=s.expires){clearStudy('time',at);return;}
 s.started=at;s.ends=at+TIME_DURATION;drawStudy(s,at);persist();
}
function putStudy(kind,data,now){
 const s={...data,pending:false,ui:card(kind==='save'?'임시 저장 연구':'시간 연구')};
 setStudy(kind,s);
 s.ui.start.addEventListener('click',()=>kind==='save'?void beginSave(s):beginTime(s));
 drawStudy(s,now);
}
function spawnStudy(kind,now){
 if(study(kind)||(kind==='save'?saveUnlocked:clockUnlocked))return;
 putStudy(kind,{expires:now+random(EXPIRY_MIN,EXPIRY_MAX),started:null,ends:null},now);
 persist();
}
function unlockClock(now){
 clockUnlocked=true;clock.hidden=false;
 if(timeStudy){timeStudy.ui.box.remove();timeStudy=null;}
 clock.textContent=clockFormat(now);
 for(const j of jobs.values())drawJob(j,now);
 persist();
}
async function unlockSave(){
 if(saveUnlocked||promoting||!saveStudy||saveStudy.started===null)return;
 promoting=true;
 try{
   await store(snapshot());
   saveUnlocked=true;
   if(saveStudy){saveStudy.ui.box.remove();saveStudy=null;}
   persist();
 }catch(e){warn();}
 finally{promoting=false;}
}
function tick(){
 if(pausedAt!==null||document.hidden)return;
 const now=Date.now();
 if(saveStudy){
   if(saveStudy.started===null&&!saveStudy.pending&&now>=saveStudy.expires)clearStudy('save',now);
   else if(saveStudy.started!==null&&now>=saveStudy.ends)void unlockSave();
 }else if(!saveUnlocked&&now>=nextSaveStudy)spawnStudy('save',now);
 if(timeStudy){
   if(timeStudy.started===null&&now>=timeStudy.expires)clearStudy('time',now);
   else if(timeStudy.started!==null&&now>=timeStudy.ends)unlockClock(now);
   else if(clockUnlocked)drawStudy(timeStudy,now);
 }else if(!clockUnlocked&&now>=nextTimeStudy)spawnStudy('time',now);
 for(const j of jobs.values()){
   if(j.started===null&&now>=j.expires)removeJob(j);
   else if(j.started!==null&&now>=j.ends)removeJob(j);
   else if(clockUnlocked)drawJob(j,now);
 }
 if(now>=nextJob){
   spawnJob(now);nextJob=now+random(ARRIVAL_MIN,ARRIVAL_MAX);persist();
 }
 if(clockUnlocked)clock.textContent=clockFormat(now);
}

// Both formats preserve time remaining; elapsed offline wall time is never credited.
// This also migrates existing v0.08.03 snapshots that lack savedAt metadata.
function timestamp(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0;}
function shiftTimerFields(obj,fields,offset){
 if(!obj||offset<=0)return;
 for(const field of fields)if(timestamp(obj[field]))obj[field]+=offset;
}
function shiftState(offset){
 if(offset<=0)return;
 nextJob+=offset;
 nextSaveStudy+=offset;
 nextTimeStudy+=offset;
 for(const j of jobs.values())shiftTimerFields(j,['expires','started','ends'],offset);
 for(const s of [saveStudy,timeStudy])shiftTimerFields(s,['expires','started','ends'],offset);
}
function rebaseLoaded(save,now){
 const result={...save};
 let savedAt;
 if(timestamp(save.savedAt))savedAt=save.savedAt;
 else if(save.kind==='research'){
   // Older research records only contained their original start/finish time.
   // Without a last-seen timestamp, preserve the full initial study duration.
   savedAt=timestamp(save.started)?save.started:now;
 }else{
   // Older full records lack savedAt; nextJob was normally scheduled 4-8.5s ahead.
   savedAt=timestamp(save.nextJob)?Math.max(0,save.nextJob-ARRIVAL_MIN):now;
 }
 const offset=Math.max(0,now-savedAt);
 if(save.kind==='research'){
   shiftTimerFields(result,['started','ends'],offset);
 }else if(save.kind==='full'){
   shiftTimerFields(result,['nextJob','nextTimeStudy'],offset);
   if(Array.isArray(save.jobs)){
     result.jobs=save.jobs.map(j=>{
       const copy={...j};shiftTimerFields(copy,['expires','started','ends'],offset);return copy;
     });
   }
   if(save.timeStudy){
     result.timeStudy={...save.timeStudy};
     shiftTimerFields(result.timeStudy,['expires','started','ends'],offset);
   }
 }
 result.savedAt=now;
 return result;
}
function pause(){
 if(pausedAt!==null)return;
 pausedAt=Date.now();
 persist();
}
function resume(){
 if(pausedAt===null)return;
 const elapsed=Math.max(0,Date.now()-pausedAt);
 shiftState(elapsed);
 pausedAt=null;
 tick();
 persist();
}

const timeValue=timestamp;
function recoverFull(s,now){
 saveUnlocked=true;clockUnlocked=s.clockUnlocked===true;clock.hidden=!clockUnlocked;
 id=Number.isSafeInteger(s.id)&&s.id>0?s.id:1;
 nextJob=timeValue(s.nextJob)?s.nextJob:now+random(ARRIVAL_MIN,ARRIVAL_MAX);
 nextTimeStudy=timeValue(s.nextTimeStudy)?s.nextTimeStudy:now+random(RESEARCH_MIN,RESEARCH_MAX);
 const names=new Set();
 if(Array.isArray(s.jobs)){
   for(const j of s.jobs.slice(0,100)){
     if(!j||!Number.isSafeInteger(j.id)||j.id<=0||!NAMES.includes(j.name)||names.has(j.name)||!timeValue(j.expires))continue;
     const started=timeValue(j.started)?j.started:null,ends=timeValue(j.ends)?j.ends:null;
     if(started!==null&&ends===null)continue;
     if(started===null&&j.expires<=now||started!==null&&ends<=now)continue;
     id=Math.max(id,j.id+1);names.add(j.name);
     putJob({id:j.id,name:j.name,expires:j.expires,started,ends},now);
   }
 }
 const r=s.timeStudy;
 if(!clockUnlocked&&r&&timeValue(r.expires)){
   const started=timeValue(r.started)?r.started:null,ends=timeValue(r.ends)?r.ends:null;
   if(started===null&&r.expires>now||started!==null&&ends!==null)putStudy('time',{expires:r.expires,started,ends},now);
 }
 if(clockUnlocked)clock.textContent=clockFormat(now);
}
async function init(){
 let now=Date.now();
 nextJob=now+random(ARRIVAL_MIN,ARRIVAL_MAX);
 nextTimeStudy=now+random(RESEARCH_MIN,RESEARCH_MAX);
 nextSaveStudy=now+random(RESEARCH_MIN,RESEARCH_MAX);
 let data=null;try{data=await load();}catch(e){/* Start without a save; explain error when attempting research. */}
 now=Date.now();
 if(data&&data.schema===1&&data.kind==='full'&&data.saveUnlocked===true){
   recoverFull(rebaseLoaded(data,now),now);
 }else{
   for(let i=0;i<3;i++)spawnJob(now);
   if(data&&data.schema===1&&data.kind==='research'&&timeValue(data.started)&&timeValue(data.ends)&&data.ends>data.started){
     const restored=rebaseLoaded(data,now);
     putStudy('save',{expires:restored.ends,started:restored.started,ends:restored.ends},now);
   }
 }
 tick();
 let lastPeriodicSave=Date.now();
 window.setInterval(()=>{
   tick();
   if(pausedAt===null&&!document.hidden&&Date.now()-lastPeriodicSave>=5000){
     lastPeriodicSave=Date.now();
     persist();
   }
 },1000);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else resume();});
 window.addEventListener('pagehide',pause);
 window.addEventListener('pageshow',resume);
}
void init();
})();