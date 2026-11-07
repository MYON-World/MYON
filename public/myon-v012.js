// MYON v0.12.00 — two-tab city shell and one manual taxi slot.
// All pre-v0.12.00 IndexedDB records are retained and not read as current income.
(function () {
'use strict';
const DB='myon-v00804-progress', STORE='game', KEY='v01200-taxi';
const DURATION=15000;
const tree=[
  {name:'교통',children:[{name:'택시',kind:'taxi'},{name:'버스'},{name:'철도'},{name:'항공'}]},
  {name:'물류',children:[{name:'택배'},{name:'화물'}]},
  {name:'상업',children:[{name:'상점'},{name:'음식점'}]},
  {name:'도시환경',children:[{name:'쓰레기 수거'},{name:'공원 관리'}]},
  {name:'시설관리',children:[{name:'주차장'},{name:'건물 관리'}]},
  {name:'공공안전',children:[{name:'구급차'},{name:'소방'}]}
];
const root={name:'운영',children:tree};
const el=id=>document.getElementById(id);
const ui={
  date:el('clock-date'),clock:el('clock-time'),balance:el('balance'),
  mission:el('mission-view'),operation:el('operation-view'),
  missionTab:el('tab-mission'),operationTab:el('tab-operation'),
  slot:el('taxi-slot'),level:el('taxi-level'),start:el('taxi-start'),upgrade:el('taxi-upgrade'),
  elapsed:el('taxi-elapsed'),remaining:el('taxi-remaining'),percent:el('taxi-percent'),progress:el('taxi-progress'),
  feedback:el('mission-feedback'),back:el('operation-back'),crumb:el('operation-crumb'),
  title:el('operation-title'),list:el('operation-list')
};
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const won=n=>'₩'+n.toLocaleString('ko-KR');
const mmss=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const rewardFor=level=>500+(level-1)*100;
const priceFor=level=>500+(level-1)*250;
const initial=()=>({schema:1,level:1,balance:0,completed:0,running:null});
function valid(data){
  if(!data||data.schema!==1)return false;
  if(!Number.isSafeInteger(data.level)||data.level<1||data.level>100000)return false;
  if(!Number.isSafeInteger(data.balance)||data.balance<0||!Number.isSafeInteger(data.completed)||data.completed<0)return false;
  const job=data.running;
  return job===null||!!(job&&Number.isSafeInteger(job.startedAt)&&job.startedAt>0&&
    Number.isSafeInteger(job.endsAt)&&job.endsAt===job.startedAt+DURATION&&
    Number.isSafeInteger(job.reward)&&job.reward>0);
}
let state=initial(),ready=false,dbPromise=null,saveQueue=Promise.resolve(),notificationTimeout=null;
let currentTab='mission',path=[root];
function openDb(){
  if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
    const request=window.indexedDB.open(DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
  }).catch(error=>{dbPromise=null;throw error;});
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
      const transaction=db.transaction(STORE,'readwrite');
      transaction.objectStore(STORE).put(snapshot,KEY);
      transaction.oncomplete=resolve;
      transaction.onerror=()=>reject(transaction.error||new Error('MYON save failed'));
      transaction.onabort=()=>reject(transaction.error||new Error('MYON save aborted'));
    });
  }).catch(error=>console.error('MYON save:',error));
}
function feedback(message){
  if(notificationTimeout!==null){clearTimeout(notificationTimeout);notificationTimeout=null;}
  ui.feedback.textContent=message;
  if(message)notificationTimeout=setTimeout(()=>{ui.feedback.textContent='';notificationTimeout=null;},3500);
}
function advance(now){
  if(!state.running||now<state.running.endsAt)return false;
  // Exactly one manually-started trip is settled, even after a long offline absence.
  state.balance+=state.running.reward;
  state.completed++;
  const reward=state.running.reward;
  state.running=null;
  feedback('운행 완료 · '+won(reward)+' 정산');
  save();
  return true;
}
function drawTaxi(now){
  ui.balance.textContent=won(state.balance);
  ui.level.textContent='Lv.'+state.level;
  ui.upgrade.textContent='업글 '+won(priceFor(state.level));
  ui.upgrade.title='수익 '+won(rewardFor(state.level))+'/회 · 다음 업글 '+won(priceFor(state.level));
  const job=state.running;
  ui.slot.classList.toggle('is-running',!!job);
  if(!job){ui.progress.style.width='0%';return;}
  const passed=Math.max(0,Math.min(DURATION,now-job.startedAt));
  ui.elapsed.textContent=mmss(Math.floor(passed/1000));
  ui.remaining.textContent=mmss(Math.ceil((DURATION-passed)/1000));
  ui.percent.textContent=Math.round(passed/DURATION*100)+'%';
  ui.progress.style.width=(passed/DURATION*100)+'%';
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
  advance(now);
  drawTaxi(now);
}
function startTrip(){
  if(!ready||state.running)return;
  const now=Date.now();
  state.running={startedAt:now,endsAt:now+DURATION,reward:rewardFor(state.level)};
  feedback('');
  save();drawTaxi(now);
}
function upgradeTaxi(){
  if(!ready||state.running)return;
  const price=priceFor(state.level);
  if(state.level>=100000){feedback('최대 단계에 도달했어요.');return;}
  if(state.balance<price){feedback('업글 비용 '+won(price)+' · '+won(price-state.balance)+' 부족');return;}
  state.balance-=price;
  state.level++;
  feedback('Lv.'+state.level+' 업그레이드 완료 · 운행 수익 증가');
  save();drawTaxi(Date.now());
}
const create=(tag,className,text)=>{
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
};
function drawOperations(){
  const page=path[path.length-1];
  ui.back.hidden=path.length===1;
  ui.title.textContent=page.name;
  ui.crumb.textContent=path.length===1?'도시 활동':path.slice(0,-1).map(p=>p.name).join(' › ');
  ui.list.replaceChildren();
  if(page.children){
    for(const item of page.children){
      const button=create('button','operation-button');
      button.type='button';
      button.append(create('span','',item.name),create('span','operation-chevron','›'));
      button.addEventListener('click',()=>{path.push(item);drawOperations();});
      ui.list.appendChild(button);
    }
    return;
  }
  const card=create('div','operation-detail');
  if(page.kind==='taxi'){
    const heading=create('strong','','택시 운영 현황');
    const level=create('p','','레벨 '+state.level+' · 완료 운행 '+state.completed+'회');
    const income=create('p','','운행 수익 '+won(rewardFor(state.level))+'/회');
    const next=create('p','','다음 업글 '+won(priceFor(state.level)));
    const hint=create('div','muted','운행과 업글은 임무 탭에서 진행합니다.');
    card.append(heading,level,income,next,hint);
  }else{
    card.appendChild(create('p','',page.name+' 운영 설정은 이후 개발 예정입니다.'));
  }
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
ui.start.addEventListener('click',startTrip);
ui.upgrade.addEventListener('click',upgradeTaxi);
ui.missionTab.addEventListener('click',()=>setTab('mission'));
ui.operationTab.addEventListener('click',()=>setTab('operation'));
ui.back.addEventListener('click',()=>{if(path.length>1){path.pop();drawOperations();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{if(ready)save();});
(async()=>{
  let stored=null;
  try{stored=await load();}catch(error){console.error('MYON load:',error);}
  state=valid(stored)?stored:initial();
  ready=true;
  if(!valid(stored))save();
  advance(Date.now());
  drawOperations();
  tick();
  setInterval(tick,200);
})();
})();
