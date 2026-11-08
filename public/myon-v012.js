// MYON v0.12.02 — automatically cycling distance-based taxi with a 10-minute cooldown.
// Preserve the v01200-taxi save key and all earlier game save records.
(function () {
'use strict';
const DB='myon-v00804-progress', STORE='game', KEY='v01200-taxi';
const COOLDOWN=10*60*1000, SPEED=250, MAX_LEVEL=10;
const tree=[{name:'교통',children:[{name:'택시',kind:'taxi'}]}];
const root={name:'운영',children:tree};
const el=id=>document.getElementById(id);
const ui={
  date:el('clock-date'),clock:el('clock-time'),balance:el('balance'),
  mission:el('mission-view'),operation:el('operation-view'),
  missionTab:el('tab-mission'),operationTab:el('tab-operation'),
  slot:el('taxi-slot'),level:el('taxi-level'),upgrade:el('taxi-upgrade'),
  status:el('taxi-status'),metrics:el('taxi-details'),waiting:el('taxi-waiting'),
  distance:el('taxi-distance'),fare:el('taxi-fare'),progress:el('taxi-progress'),
  feedback:el('mission-feedback'),back:el('operation-back'),crumb:el('operation-crumb'),
  title:el('operation-title'),list:el('operation-list')
};
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const won=n=>'₩'+n.toLocaleString('ko-KR');
const mmss=seconds=>String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
const baseFee=level=>level*1000;
const priceFor=level=>level*100000;
const meter=(meters,level)=>baseFee(level)+100*Math.max(0,Math.ceil((meters-1600)/131-1e-9));
const initial=()=>({schema:2,level:1,balance:0,completed:0,trip:null,waitingUntil:0,legacy:null});
const validMoney=n=>Number.isSafeInteger(n)&&n>=0;
function validLegacySave(s){
  if(!s||s.schema!==1||!Number.isSafeInteger(s.level)||s.level<1||s.level>100000||!validMoney(s.balance)||!validMoney(s.completed))return false;
  const j=s.running;
  return j===null||!!(j&&Number.isSafeInteger(j.startedAt)&&j.startedAt>0&&Number.isSafeInteger(j.endsAt)&&j.endsAt===j.startedAt+15000&&Number.isSafeInteger(j.reward)&&j.reward>0);
}
function validSave(s){
  if(!s||s.schema!==2||!Number.isSafeInteger(s.level)||s.level<1||s.level>MAX_LEVEL||!validMoney(s.balance)||!validMoney(s.completed)||!Number.isSafeInteger(s.waitingUntil)||s.waitingUntil<0)return false;
  if(s.trip!==null){
    const j=s.trip;
    if(!j||!Number.isSafeInteger(j.distance)||j.distance<3000||j.distance>10000||j.distance%100!==0||!Number.isSafeInteger(j.level)||j.level<1||j.level>MAX_LEVEL||!Number.isSafeInteger(j.startedAt)||j.startedAt<=0||j.endsAt!==j.startedAt+j.distance*4)return false;
  }
  if(s.legacy!==null){
    const j=s.legacy;
    if(!j||!Number.isSafeInteger(j.endsAt)||j.endsAt<=0||!Number.isSafeInteger(j.reward)||j.reward<=0)return false;
  }
  return !(s.trip&&s.legacy)&&!(s.waitingUntil&&(s.trip||s.legacy));
}
function migrate(s){
  const next=initial();
  next.level=Math.min(MAX_LEVEL,s.level);
  next.balance=s.balance;
  next.completed=s.completed;
  if(s.running)next.legacy={endsAt:s.running.endsAt,reward:s.running.reward};
  return next;
}
let state=initial(),ready=false,dbPromise=null,saveQueue=Promise.resolve(),feedbackTimeout=null;
let path=[root],currentTab='mission';
function openDb(){
  if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
    const req=window.indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
  }).catch(err=>{dbPromise=null;throw err;});
  return dbPromise;
}
async function load(){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,'readonly').objectStore(STORE).get(KEY);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error||new Error('MYON save read failed'));
  });
}
function save(){
  if(!ready)return;
  const snapshot=JSON.parse(JSON.stringify(state));
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(snapshot,KEY);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('MYON save failed'));
      tx.onabort=()=>reject(tx.error||new Error('MYON save aborted'));
    });
  }).catch(err=>console.error('MYON save:',err));
}
function feedback(message){
  if(feedbackTimeout!==null){clearTimeout(feedbackTimeout);feedbackTimeout=null;}
  ui.feedback.textContent=message;
  if(message)feedbackTimeout=setTimeout(()=>{ui.feedback.textContent='';feedbackTimeout=null;},3500);
}
function startTrip(at){
  const distance=(30+Math.floor(Math.random()*71))*100;
  state.trip={distance,level:state.level,startedAt:at,endsAt:at+distance*4};
  state.waitingUntil=0;
}
function advance(now){
  let changed=false;
  // The saved end time defines every transition, so delayed/hidden tabs and
  // offline sessions get the same 10-minute pause between completed trips.
  for(let n=0;n<100000;n++){
    if(state.legacy){
      if(now<state.legacy.endsAt)break;
      state.balance+=state.legacy.reward;
      state.completed++;
      state.waitingUntil=state.legacy.endsAt+COOLDOWN;
      state.legacy=null;
      changed=true;
      continue;
    }
    if(state.trip){
      if(now<state.trip.endsAt)break;
      state.balance+=meter(state.trip.distance,state.trip.level);
      state.completed++;
      state.waitingUntil=state.trip.endsAt+COOLDOWN;
      state.trip=null;
      changed=true;
      continue;
    }
    if(state.waitingUntil>now)break;
    startTrip(state.waitingUntil||now);
    changed=true;
  }
  if(changed)save();
  return changed;
}
function drawTaxi(now){
  ui.balance.textContent=won(state.balance);
  ui.level.textContent='Lv.'+state.level;
  const running=!!state.trip||!!state.legacy;
  ui.status.style.display=running?'inline-block':'none';
  ui.upgrade.style.display=running?'none':'inline-block';
  ui.upgrade.disabled=state.level>=MAX_LEVEL;
  ui.upgrade.textContent=state.level>=MAX_LEVEL?'MAX':'업글 '+won(priceFor(state.level));
  ui.metrics.style.display=running?'flex':'none';
  ui.waiting.style.display=running?'none':'block';
  if(state.trip){
    const j=state.trip;
    const traveled=Math.min(j.distance,Math.max(0,(now-j.startedAt)/4));
    ui.distance.textContent=((j.distance-traveled)/1000).toFixed(2)+'km';
    ui.fare.textContent=won(meter(traveled,j.level));
    ui.progress.style.width=(traveled/j.distance*100)+'%';
  }else if(state.legacy){
    // Preserve the payout of an in-flight v0.12.01 trip without fabricating a distance.
    ui.distance.textContent='—km';
    ui.fare.textContent=won(state.legacy.reward);
    ui.progress.style.width='0%';
  }else{
    ui.waiting.textContent='대기 '+mmss(Math.max(0,Math.ceil((state.waitingUntil-now)/1000)));
    ui.progress.style.width='0%';
  }
}
function drawClock(now){
  const date=new Date(now);
  ui.date.textContent=dateFmt.format(date).replace(/-/g,'.');
  ui.clock.textContent=timeFmt.format(date);
}
function tick(){
  const now=Date.now();
  drawClock(now);
  if(!ready)return;
  if(advance(now)&&currentTab==='operation'&&path.length===3)drawOperations();
  drawTaxi(now);
}
function upgradeTaxi(){
  if(!ready||state.trip||state.legacy||state.waitingUntil<=Date.now()||state.level>=MAX_LEVEL)return;
  const cost=priceFor(state.level);
  if(state.balance<cost){feedback('업글 비용 '+won(cost)+' · '+won(cost-state.balance)+' 부족');return;}
  state.balance-=cost;
  state.level++;
  feedback('Lv.'+state.level+' 업그레이드 완료');
  save();drawTaxi(Date.now());
}
const create=(tag,className,text)=>{
  const e=document.createElement(tag);
  if(className)e.className=className;
  if(text!==undefined)e.textContent=text;
  return e;
};
function drawOperations(){
  const page=path[path.length-1];
  ui.back.hidden=path.length===1;
  ui.title.textContent=page.name;
  ui.crumb.textContent=path.length===1?'도시 활동':path.slice(0,-1).map(p=>p.name).join(' › ');
  ui.list.replaceChildren();
  if(page.children){
    for(const item of page.children){
      const btn=create('button','operation-button');
      btn.type='button';
      btn.append(create('span','',item.name),create('span','operation-chevron','›'));
      btn.addEventListener('click',()=>{path.push(item);drawOperations();});
      ui.list.appendChild(btn);
    }
    return;
  }
  const card=create('div','operation-detail');
  const heading=create('strong','','택시 운영 현황');
  const level=create('p','','레벨 '+state.level+' · 완료 운행 '+state.completed+'회');
  const income=create('p','','기본요금 '+won(baseFee(state.level))+' · 다음 업글 '+(state.level===MAX_LEVEL?'MAX':won(priceFor(state.level))));
  const hint=create('div','muted','운행은 자동 진행 중입니다.');
  card.append(heading,level,income,hint);
  ui.list.appendChild(card);
}
function setTab(tab){
  currentTab=tab;
  ui.mission.hidden=tab!=='mission';
  ui.operation.hidden=tab!=='operation';
  ui.missionTab.setAttribute('aria-selected',String(tab==='mission'));
  ui.operationTab.setAttribute('aria-selected',String(tab==='operation'));
  if(tab==='operation'){path=[root];drawOperations();}
}
ui.upgrade.addEventListener('click',upgradeTaxi);
ui.missionTab.addEventListener('click',()=>setTab('mission'));
ui.operationTab.addEventListener('click',()=>setTab('operation'));
ui.back.addEventListener('click',()=>{if(path.length>1){path.pop();drawOperations();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{if(ready)save();});
(async()=>{
  let stored=null;
  try{stored=await load();}catch(err){console.error('MYON load:',err);}
  const isCurrent=validSave(stored),isOld=validLegacySave(stored);
  state=isCurrent?stored:isOld?migrate(stored):initial();
  ready=true;
  if(!isCurrent)save();
  drawOperations();
  tick();
  setInterval(tick,100);
})();
})();