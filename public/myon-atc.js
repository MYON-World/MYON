// MYON v0.11.00 — observer-only small-airport ATC. Older save keys remain untouched.
(function () {
'use strict';
const MINUTE=60000, ARRIVAL=10*MINUTE, KEEP=90*MINUTE;
const DURATIONS=[15,3,4,12,2,4,3,2];
const LABELS=['접근 중','착륙 중','지상 이동','게이트','출발 허가','지상 이동','이륙 중','디파처 이관'];
const DB='myon-v00804-progress', STORE='game', KEY='v01100-atc';
const LETTERS='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function makeCallsign(used) {
  for(let retry=0;retry<100;retry++){
    let code='';
    for(let i=0;i<3;i++)code+=LETTERS[Math.floor(Math.random()*26)];
    for(let i=0;i<3;i++)code+=String(Math.floor(Math.random()*10));
    if(!used.has(code))return code;
  }
  // Extremely unlikely random collision exhaustion: deterministic fallback.
  for(let n=0;n<26*26*26*1000;n++){
    const abc=Math.floor(n/1000);
    const code=LETTERS[Math.floor(abc/676)]+LETTERS[Math.floor(abc/26)%26]+LETTERS[abc%26]+String(n%1000).padStart(3,'0');
    if(!used.has(code))return code;
  }
  throw new Error('No available callsign');
}
function spawn(s,when){
  const used=new Set(s.flights.map(f=>f.callsign));
  s.flights.push({id:s.nextId++,callsign:makeCallsign(used),stage:0,endsAt:when+DURATIONS[0]*MINUTE,waitingSince:null});
}
function initial(now){
  const s={schema:1,nextId:1,nextArrivalAt:now+ARRIVAL,flights:[]};
  spawn(s,now);return s;
}
function valid(s){
  if(!s||s.schema!==1||!Number.isSafeInteger(s.nextId)||s.nextId<1||!Number.isSafeInteger(s.nextArrivalAt)||s.nextArrivalAt<=0||!Array.isArray(s.flights)||s.flights.length>100)return false;
  const ids=new Set(),codes=new Set();
  for(const f of s.flights){
    if(!Number.isSafeInteger(f.id)||f.id<=0||ids.has(f.id)||typeof f.callsign!=='string'||!(/^[A-Z]{3}[0-9]{3}$/).test(f.callsign)||codes.has(f.callsign)||!Number.isInteger(f.stage)||f.stage< -2||f.stage>7)return false;
    if(f.stage<0?!(f.endsAt===null&&Number.isSafeInteger(f.waitingSince)):!Number.isSafeInteger(f.endsAt))return false;
    ids.add(f.id);codes.add(f.callsign);
  }
  return true;
}
function advance(s,target){
  let changed=false;
  // Completed flights older than 90 minutes have no active display or rewards.
  // Fast-forward long absences without generating thousands of stale aircraft.
  if(target-s.nextArrivalAt>KEEP){
    const cutoff=target-KEEP;
    const skipped=Math.max(0,Math.floor((cutoff-s.nextArrivalAt)/ARRIVAL)+1);
    s.nextArrivalAt+=skipped*ARRIVAL;
    s.nextId+=skipped;
    s.flights=[];
    changed=true;
  }
  for(let guard=0;guard<2000;guard++){
    let next=s.nextArrivalAt;
    for(const f of s.flights)if(f.endsAt!==null&&f.endsAt<next)next=f.endsAt;
    if(next>target)break;
    const due=s.flights.filter(f=>f.endsAt!==null&&f.endsAt<=next);
    for(const f of due){
      switch(f.stage){
        case 0:f.stage=-1;f.waitingSince=next;f.endsAt=null;break;
        case 1:f.stage=2;f.endsAt=next+4*MINUTE;break;
        case 2:f.stage=3;f.endsAt=next+12*MINUTE;break;
        case 3:f.stage=4;f.endsAt=next+2*MINUTE;break;
        case 4:f.stage=5;f.endsAt=next+4*MINUTE;break;
        case 5:f.stage=-2;f.waitingSince=next;f.endsAt=null;break;
        case 6:f.stage=7;f.endsAt=next+2*MINUTE;break;
        case 7:f.stage=8;break;
      }
    }
    s.flights=s.flights.filter(f=>f.stage!==8);
    if(s.nextArrivalAt<=next){
      spawn(s,next);
      s.nextArrivalAt+=ARRIVAL;
    }
    // A single shared runway, including aircraft waiting to land or depart.
    if(!s.flights.some(f=>f.stage===1||f.stage===6)){
      const queued=s.flights.filter(f=>f.stage===-1||f.stage===-2);
      queued.sort((a,b)=>a.waitingSince-b.waitingSince||a.id-b.id);
      if(queued.length){
        const f=queued[0];
        f.stage=f.stage===-1?1:6;
        f.waitingSince=null;
        f.endsAt=next+3*MINUTE;
      }
    }
    changed=true;
  }
  return changed;
}
function stageLabel(f){
  return f.stage===-1?'착륙 대기':f.stage===-2?'이륙 대기':LABELS[f.stage]||'';
}
// === UI ===
const el=id=>document.getElementById(id);
const list=el('flights'),date=el('clock-date'),clock=el('clock-time');
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
let state=null,dbPromise=null,saveQueue=Promise.resolve();
const nodes=new Map();
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
    req.onerror=()=>reject(req.error||new Error('ATC save read failed'));
  });
}
function save(){
  if(!state)return;
  const snapshot=JSON.parse(JSON.stringify(state));
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(snapshot,KEY);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('ATC save failed'));
      tx.onabort=()=>reject(tx.error||new Error('ATC save aborted'));
    });
  }).catch(err=>console.error('MYON ATC save:',err));
}
function draw(now){
  date.textContent=dateFmt.format(new Date(now)).replace(/-/g,'.');
  clock.textContent=timeFmt.format(new Date(now));
  if(!state)return;
  const active=new Set();
  for(const f of state.flights){
    active.add(f.id);
    let node=nodes.get(f.id);
    if(!node){
      node=document.createElement('article');
      node.className='flight';
      const name=document.createElement('strong');name.className='callsign';
      const status=document.createElement('span');status.className='status';
      node.append(name,status);
      nodes.set(f.id,node);
      list.append(node);
    }
    node.firstChild.textContent=f.callsign;
    node.lastChild.textContent=stageLabel(f);
  }
  for(const [id,node] of nodes)if(!active.has(id)){node.remove();nodes.delete(id);}
}
function tick(){
  if(!state)return;
  const now=Date.now();
  if(advance(state,now))save();
  draw(now);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('pagehide',()=>{if(state)save();});
(async()=>{
  let stored=null;
  try{stored=await load();}catch(err){console.error('MYON ATC load:',err);}
  const now=Date.now();
  state=valid(stored)?stored:initial(now);
  if(advance(state,now)||!valid(stored))save();
  draw(now);
  setInterval(tick,1000);
})();
})();
