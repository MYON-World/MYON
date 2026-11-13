// MYON RPG taxi v1. One company-owned taxi, one automatic job at a time.
// This is independent of legacy missions, garage, common funds and player settings.
(function () {
'use strict';
const DB='myon-v00804-progress', STORE='game';
const RPG_KEY='myon-rpg-taxi-v1', ECONOMY_KEY='myon-economy-v1';
const LIMIT=1000; // bounded catch-up per IndexedDB transaction
const $=id=>document.getElementById(id);
const nowSeconds=()=>Math.floor(Date.now()/1000);
let current=null,personalBalance=0,active=false,busy=false;
const sample=(seed,index,min,max)=>min+(mix((seed+Math.imul((index+1)>>>0,0x9e3779b9))>>>0)%(max-min+1));
function mix(n){n=(n^(n>>>16))>>>0;n=Math.imul(n,0x7feb352d)>>>0;n=(n^(n>>>15))>>>0;n=Math.imul(n,0x846ca68b)>>>0;return (n^(n>>>16))>>>0;}
function randomSeed(){
 const values=new Uint32Array(1);
 if(globalThis.crypto&&crypto.getRandomValues)crypto.getRandomValues(values);
 else values[0]=(Math.random()*4294967296)>>>0;
 return values[0]||1;
}
function taxiFareUnits(distanceMeters){return 4800+Math.ceil(Math.max(0,distanceMeters-1600)/131)*100;}
// Same speed assumptions as the existing MYON taxi simulation: 15–25 km/h.
const speedCache=new Map();
function speedPrefix(seed){
 let p=speedCache.get(seed);
 if(p)return p;
 p=new Float64Array(257);
 for(let i=0;i<256;i++)p[i+1]=p[i]+sample(seed,i,15,25);
 if(speedCache.size>100)speedCache.clear();
 speedCache.set(seed,p);return p;
}
function speedUnits(seed,from,to){
 if(to<=from)return 0;
 const p=speedPrefix(seed),sum=t=>Math.floor(t/256)*p[256]+p[t%256];
 return sum(to)-sum(from);
}
function roadEnd(seed,from,distance){
 const target=Math.ceil(distance*18/5);
 let lo=from,hi=from+Math.ceil(distance*18/75)+3;
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if(speedUnits(seed,from,mid)>=target)hi=mid;else lo=mid+1;}
 return lo;
}
function waitSeconds(seed,seq){return sample(seed,seq*3,300,900);}
function tripDistance(seed,seq){return sample(seed,seq*3+1,30,100)*100;}
function tripSeed(seed,seq){return mix(seed^mix(seq));}
function initialRpg(){
 return {schema:1,introSeen:false,job:null,seed:0,seq:0,phase:null,
  phaseStartedAt:0,phaseEndsAt:0,distanceMeters:0,fareUnits:0,
  completed:0,earnedUnits:0,last:null};
}
function validRpg(s){
 return Boolean(s&&s.schema===1&&typeof s.introSeen==='boolean'&&
  (s.job===null||s.job==='taxi')&&Number.isInteger(s.seed)&&s.seed>=0&&s.seed<=0xffffffff&&
  Number.isSafeInteger(s.seq)&&s.seq>=0&&
  (s.phase===null||s.phase==='waiting'||s.phase==='driving')&&
  Number.isSafeInteger(s.phaseStartedAt)&&s.phaseStartedAt>=0&&
  Number.isSafeInteger(s.phaseEndsAt)&&s.phaseEndsAt>=0&&
  Number.isSafeInteger(s.distanceMeters)&&s.distanceMeters>=0&&
  Number.isSafeInteger(s.fareUnits)&&s.fareUnits>=0&&
  Number.isSafeInteger(s.completed)&&s.completed>=0&&
  Number.isSafeInteger(s.earnedUnits)&&s.earnedUnits>=0&&
  (s.last===null||(Number.isSafeInteger(s.last.settledAt)&&
    Number.isSafeInteger(s.last.distanceMeters)&&Number.isSafeInteger(s.last.fareUnits)&&
    Number.isSafeInteger(s.last.driverUnits)))&&
  (s.job==='taxi'?(s.introSeen&&s.seed>0&&s.phase!==null&&s.phaseEndsAt>s.phaseStartedAt):s.phase===null));
}
function initialEconomy(){return {schema:1,personal:{balance:0},businessCapital:{balance:0}};}
function validEconomy(s){
 return Boolean(s&&s.schema===1&&s.personal&&s.businessCapital&&
  Number.isSafeInteger(s.personal.balance)&&s.personal.balance>=0&&
  Number.isSafeInteger(s.businessCapital.balance)&&s.businessCapital.balance>=0);
}
function openDb(){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||new Error('RPG database unavailable'));
 });
}
// A single readwrite transaction advances RPG progress AND pays 40% to the
// shared personal wallet. Two tabs cannot pay the same completed trip twice.
async function update(action='inspect'){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
  const r=store.get(RPG_KEY),e=store.get(ECONOMY_KEY);
  let haveR=false,haveE=false,saved=null,economy=null,output=null,issue=null;
  tx.oncomplete=()=>{db.close();resolve(output);};
  tx.onabort=()=>{db.close();reject(issue||tx.error||new Error('RPG transaction aborted'));};
  tx.onerror=()=>{issue=issue||tx.error;};
  r.onsuccess=()=>{haveR=true;saved=r.result;apply();};
  e.onsuccess=()=>{haveE=true;economy=e.result;apply();};
  function apply(){
   if(!haveR||!haveE)return;
   try{
    if(saved!==undefined&&!validRpg(saved))throw new Error('Unsupported RPG save; existing data preserved');
    if(economy!==undefined&&!validEconomy(economy))throw new Error('Unsupported personal wallet; existing data preserved');
    const state=saved===undefined?initialRpg():saved;
    const wallet=economy===undefined?initialEconomy():economy;
    let changed=false,paid=false;
    const now=nowSeconds();
    if(action==='intro'&&!state.introSeen){state.introSeen=true;changed=true;}
    if(action==='taxi'&&state.introSeen&&state.job===null){
     state.job='taxi';state.seed=randomSeed();state.phase='waiting';
     state.phaseStartedAt=now;state.phaseEndsAt=now+waitSeconds(state.seed,0);
     changed=true;
    }
    if(state.job==='taxi'){
     let transitions=0;
     while(now>=state.phaseEndsAt&&transitions<LIMIT){
      transitions++;
      const at=state.phaseEndsAt;
      if(state.phase==='waiting'){
       state.distanceMeters=tripDistance(state.seed,state.seq);
       state.fareUnits=taxiFareUnits(state.distanceMeters);
       state.phase='driving';state.phaseStartedAt=at;
       state.phaseEndsAt=roadEnd(tripSeed(state.seed,state.seq),at,state.distanceMeters);
      }else{
       const driverUnits=state.fareUnits*40/100;
       const nextBalance=wallet.personal.balance+driverUnits;
       const nextEarned=state.earnedUnits+driverUnits;
       if(!Number.isSafeInteger(nextBalance)||!Number.isSafeInteger(nextEarned)||
          !Number.isSafeInteger(state.seq+1)||!Number.isSafeInteger(state.completed+1))
        throw new Error('RPG taxi income exceeds safe integer range');
       wallet.personal.balance=nextBalance;state.earnedUnits=nextEarned;
       state.completed++;state.seq++;
       state.last={settledAt:at,distanceMeters:state.distanceMeters,
        fareUnits:state.fareUnits,driverUnits};
       state.distanceMeters=0;state.fareUnits=0;state.phase='waiting';
       state.phaseStartedAt=at;
       state.phaseEndsAt=at+waitSeconds(state.seed,state.seq);
       paid=true;
      }
      changed=true;
     }
    }
    if(changed||saved===undefined&&action!=='inspect')store.put(state,RPG_KEY);
    if(paid)store.put(wallet,ECONOMY_KEY);
    output={state,wallet:wallet.personal.balance,more:state.job==='taxi'&&now>=state.phaseEndsAt};
   }catch(err){issue=err;tx.abort();}
  }
 });
}
const fmt=n=>(n/10000).toLocaleString('ko-KR',{maximumFractionDigits:4})+' M';
function show(id,visible){$(id).hidden=!visible;}
function render(){
 if(!current||!active)return;
 const intro=!current.introSeen,jobs=current.introSeen&&!current.job,taxi=current.job==='taxi';
 show('rpg-intro',intro);show('rpg-jobs',jobs);show('rpg-taxi',taxi);
 if(!taxi)return;
 const now=nowSeconds(),driving=current.phase==='driving';
 $('rpg-taxi-activity').textContent=driving?'승객 운송 중':'승객 대기';
 $('rpg-taxi-status').textContent=driving?'운행 중':'대기 중';
 $('rpg-personal-balance').textContent=fmt(personalBalance);
 $('rpg-taxi-task-title').textContent=driving?'🚕 택시 승객 운송':'🚕 승객 대기 중';
 $('rpg-taxi-task-amount').textContent=driving?fmt(current.fareUnits*40/100):'대기';
 $('rpg-taxi-trip').textContent=driving?'운행 거리 '+(current.distanceMeters/1000).toFixed(1)+'km':'주변에서 승객을 기다리고 있습니다.';
 $('rpg-taxi-task-detail').textContent=driving?'승객 탑승 완료 · 목적지까지 이동 중':'승객이 탑승하면 자동으로 운행합니다.';
 const denominator=current.phaseEndsAt-current.phaseStartedAt;
 const progress=Math.max(0,Math.min(100,(now-current.phaseStartedAt)*100/denominator));
 const bar=$('rpg-taxi-progress');
 bar.style.width=progress+'%';bar.style.background=driving?'#62b7ec':'#74b9c8';
 const recent=current.last;
 show('rpg-taxi-settlement',Boolean(recent));
 if(recent){
  $('rpg-taxi-settlement-distance').textContent=(recent.distanceMeters/1000).toFixed(1)+'km';
  $('rpg-taxi-settlement-fare').textContent=fmt(recent.fareUnits);
  $('rpg-taxi-settlement-company').textContent=fmt(recent.fareUnits-recent.driverUnits);
  $('rpg-taxi-settlement-driver').textContent='+'+fmt(recent.driverUnits);
 }
}
function errorNotice(error){
 console.error('MYON RPG taxi:',error);
 $('rpg-error').textContent='RPG 진행 상황을 불러오지 못했습니다. 기존 저장 데이터는 유지됩니다. 새로고침 후 다시 시도해 주세요.';
 $('rpg-error').hidden=false;
}
async function refresh(action='inspect'){
 if(busy)return;
 busy=true;
 try{
  // Catch up in bounded atomic batches. No duplicate credit on reload or in two tabs.
  let result=await update(action),rounds=0;
  while(result.more&&rounds++<100)result=await update('inspect');
  current=result.state;personalBalance=result.wallet;
  $('rpg-error').hidden=true;
  render();
 }catch(err){errorNotice(err);}
 finally{busy=false;}
}
function enter(){
 active=true;current=null;
 show('rpg-intro',false);show('rpg-jobs',false);show('rpg-taxi',false);
 $('rpg-error').hidden=true;
 void refresh();
}
function exit(){active=false;}
$('rpg-intro-start').addEventListener('click',()=>void refresh('intro'));
$('rpg-job-taxi').addEventListener('click',()=>void refresh('taxi'));
setInterval(()=>{
 if(!active||document.hidden||!current||current.job!=='taxi')return;
 if(nowSeconds()>=current.phaseEndsAt){void refresh();return;}
 render();
},1000);
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&active)void refresh();
});
window.MYON_RPG_TAXI=Object.freeze({enter,exit});
})();