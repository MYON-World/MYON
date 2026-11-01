// MYON v0.10.00 — one-page city facilities; legacy saves untouched.
(function(){
'use strict';
const HOUR=3600000,MINUTE=60000;
const HOURS=[24,12,6,3,2,1],TIME_COST=[6,20,80,200,500],TIME_WAIT=[5,10,20,30,60];
const RATES=[1,2,5,10,20,50,100],INCOME_COST=[12,60,200,600,2400,6000],INCOME_WAIT=[5,10,20,30,60,120];
const DB_NAME='myon-v00804-progress',STORE='game',KEY='v01000-city';
const el=id=>document.getElementById(id);
const money=n=>Math.floor(n).toLocaleString('ko-KR')+' M';
const clock=ms=>{const s=Math.max(0,Math.ceil(ms/1000));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');};
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
function initial(now){return {schema:1,balance:0,timeStage:0,incomeStage:0,dueAt:now+24*HOUR,cyclePayout:24,pendingTime:null,pendingIncome:null};}
function goodPending(p,max,now){return p===null||!!p&&typeof p==='object'&&Number.isInteger(p.stage)&&p.stage>=1&&p.stage<=max&&Number.isSafeInteger(p.endsAt)&&p.endsAt>0&&p.endsAt<now+366*24*HOUR;}
function valid(s,now){return !!s&&s.schema===1&&Number.isSafeInteger(s.balance)&&s.balance>=0&&Number.isInteger(s.timeStage)&&s.timeStage>=0&&s.timeStage<HOURS.length&&Number.isInteger(s.incomeStage)&&s.incomeStage>=0&&s.incomeStage<RATES.length&&Number.isSafeInteger(s.dueAt)&&s.dueAt>0&&Number.isSafeInteger(s.cyclePayout)&&s.cyclePayout>=1&&goodPending(s.pendingTime,HOURS.length-1,now)&&goodPending(s.pendingIncome,RATES.length-1,now)&&(!s.pendingTime||s.pendingTime.stage===s.timeStage+1)&&(!s.pendingIncome||s.pendingIncome.stage===s.incomeStage+1);}
let state=null,dbPromise=null,saveQueue=Promise.resolve();
function openDb(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
 if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
 const req=window.indexedDB.open(DB_NAME,1);
 req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
}).catch(e=>{dbPromise=null;throw e;});return dbPromise;}
async function load(){const db=await openDb();return new Promise((resolve,reject)=>{
 const req=db.transaction(STORE,'readonly').objectStore(STORE).get(KEY);
 req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error('Read failed'));
});}
function save(){if(!state)return;const snapshot=JSON.parse(JSON.stringify(state));
 saveQueue=saveQueue.catch(()=>{}).then(async()=>{const db=await openDb();return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(snapshot,KEY);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Save failed'));tx.onabort=()=>reject(tx.error||new Error('Save aborted'));
 });}).catch(err=>console.error('MYON save:',err));
}
// A settlement already underway keeps its promised amount and end timestamp.
// Newly completed upgrades affect the *next* settlement cycle.
function settleThrough(target){
 if(state.dueAt>target)return false;
 state.balance+=state.cyclePayout;
 const duration=HOURS[state.timeStage]*HOUR;
 const amount=HOURS[state.timeStage]*RATES[state.incomeStage];
 const additional=Math.floor((target-state.dueAt)/duration);
 state.balance+=additional*amount;
 state.dueAt+=(additional+1)*duration;
 state.cyclePayout=amount;
 return true;
}
function advance(now){
 if(!state)return false;
 let changed=false;
 for(let i=0;i<3;i++){
  const deadlines=[state.pendingTime?.endsAt,state.pendingIncome?.endsAt].filter(Number.isFinite);
  const next=deadlines.length?Math.min(...deadlines):Infinity;
  changed=settleThrough(Math.min(now,next))||changed;
  if(next>now)break;
  if(state.pendingTime&&state.pendingTime.endsAt<=next){state.timeStage=state.pendingTime.stage;state.pendingTime=null;changed=true;}
  if(state.pendingIncome&&state.pendingIncome.endsAt<=next){state.incomeStage=state.pendingIncome.stage;state.pendingIncome=null;changed=true;}
 }
 return changed;
}
function drawUpgrade(type,now){
 const isTime=type==='time',stage=isTime?state.timeStage:state.incomeStage;
 const levels=isTime?HOURS:RATES,costs=isTime?TIME_COST:INCOME_COST;
 const pending=isTime?state.pendingTime:state.pendingIncome;
 const label=el(isTime?'time-detail':'income-detail'),button=el(isTime?'time-upgrade':'income-upgrade');
 if(stage===levels.length-1){label.textContent=isTime?'1시간 · 최종':'100 M/시간 · 최종';button.textContent='완료';button.disabled=true;return;}
 label.textContent=isTime?HOURS[stage]+'시간 → '+HOURS[stage+1]+'시간':RATES[stage]+' M/시간 → '+RATES[stage+1]+' M/시간';
 if(pending){button.textContent='진행 중 '+clock(pending.endsAt-now);button.disabled=true;return;}
 button.textContent=money(costs[stage])+' · 업그레이드';button.disabled=state.balance<costs[stage];
}
function draw(now){
 if(!state)return;
 el('clock-date').textContent=dateFmt.format(new Date(now)).replace(/-/g,'.');
 el('clock-time').textContent=timeFmt.format(new Date(now));
 el('balance').textContent=money(state.balance);
 el('settlement-clock').textContent=clock(state.dueAt-now);
 el('settlement-amount').textContent='정산 예정 '+money(state.cyclePayout);
 drawUpgrade('time',now);drawUpgrade('income',now);
}
function upgrade(type){
 if(!state)return;const now=Date.now();
 if(advance(now))save();
 const isTime=type==='time',stage=isTime?state.timeStage:state.incomeStage;
 const costs=isTime?TIME_COST:INCOME_COST,waits=isTime?TIME_WAIT:INCOME_WAIT;
 if(stage>=costs.length||(isTime?state.pendingTime:state.pendingIncome)||state.balance<costs[stage]){draw(now);return;}
 state.balance-=costs[stage];
 const pending={stage:stage+1,endsAt:now+waits[stage]*MINUTE};
 if(isTime)state.pendingTime=pending;else state.pendingIncome=pending;
 save();draw(now);
}
function tick(){if(!state)return;const now=Date.now();if(advance(now))save();draw(now);}
el('time-upgrade').addEventListener('click',()=>upgrade('time'));
el('income-upgrade').addEventListener('click',()=>upgrade('income'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{if(state)save();});
(async()=>{let saved=null;try{saved=await load();}catch(e){console.error('MYON load:',e);}
 const now=Date.now();state=valid(saved,now)?saved:initial(now);
 if(advance(now)||!saved)save();
 draw(now);setInterval(tick,1000);
})();
})();
