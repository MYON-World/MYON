// MYON v0.13.50 — restart the full one-hour rollout for every newly deployed commit.
// Progress reflects deliberate waiting time, not simulated download/install work.
(function(){
'use strict';
if(/(?:^|\/)(?:test|dev)(?:\/|$)/.test(location.pathname))return;
const WAIT_MS=60*60*1000,CHECK_MS=60000,STORAGE_KEY='myon-commit-rollout-v1';
const CODE_VERSION='0.13.50';
const params=new URLSearchParams(location.search||'');
const buildId=params.get('build')||'';
const sourceId=buildId||'version:'+CODE_VERSION;
const $=id=>document.getElementById(id);
const banner=$('auto-update-banner');
if(!banner)return;
let pending=null,checking=false,applying=false,refreshIssued=false;
let retryAfter=0,note='';
function valid(x){
 return Boolean(x&&x.schema===1&&x.from===sourceId&&
  typeof x.target==='string'&&/^[a-f0-9]{40}$/i.test(x.target)&&
  Number.isSafeInteger(x.startedAt)&&x.startedAt>0&&x.startedAt<Date.now()+60000);
}
function stored(){
 try{
  const raw=window.localStorage&&window.localStorage.getItem(STORAGE_KEY);
  if(!raw)return null;
  const x=JSON.parse(raw);
  return valid(x)?x:null;
 }catch(error){console.warn('MYON rollout storage read:',error);return null;}
}
function persist(){
 try{
  if(!window.localStorage)return;
  if(pending)window.localStorage.setItem(STORAGE_KEY,JSON.stringify(pending));
  else if(stored())window.localStorage.removeItem(STORAGE_KEY);
 }catch(error){console.warn('MYON rollout storage write:',error);}
}
function versionGreater(candidate,base){
 const a=String(candidate).split('.').map(Number),b=String(base).split('.').map(Number);
 if(a.length!==3||b.length!==3||[...a,...b].some(n=>!Number.isSafeInteger(n)||n<0))return false;
 for(let i=0;i<3;i++){if(a[i]>b[i])return true;if(a[i]<b[i])return false;}
 return false;
}
function progress(now=Date.now()){
 if(!pending)return 0;
 return Math.max(0,Math.min(100,Math.floor((now-pending.startedAt)*100/WAIT_MS)));
}
function draw(now=Date.now()){
 banner.hidden=!pending;
 if(!pending)return;
 const remain=Math.max(0,Math.ceil((pending.startedAt+WAIT_MS-now)/1000)),pct=progress(now);
 const minutes=String(Math.floor(remain/60)).padStart(2,'0'),seconds=String(remain%60).padStart(2,'0');
 $('auto-update-title').textContent=refreshIssued?'새 버전 여는 중':
  applying?'데이터 저장 확인 중':pct>=100?'커밋 적용 준비 완료':'새 커밋 적용 중';
 $('auto-update-percent').textContent=pct+'%';
 $('auto-update-fill').style.width=pct+'%';
 $('auto-update-detail').textContent=note||(pct>=100?'저장 확인 후 자동 새로고침':'1시간 순차 적용 · 기존 세이브 유지');
 $('auto-update-remaining').textContent=remain?'남은 '+minutes+':'+seconds:(refreshIssued?'이동 중':'적용 대기');
}
async function check(){
 if(checking||refreshIssued||typeof fetch!=='function')return false;
 checking=true;
 try{
  const response=await fetch('myon-build.json?check='+Date.now(),{cache:'no-store'});
  if(!response.ok)return false;
  const latest=await response.json();
  if(!latest||typeof latest.revision!=='string'||!/^[a-f0-9]{40}$/i.test(latest.revision))return false;
  if(buildId?latest.revision===buildId:!versionGreater(latest.version,CODE_VERSION)){
   // Keep an already verified pending rollout if an edge cache answers with stale metadata.
   return true;
  }
  const old=stored()||pending;
  pending=old||{schema:1,from:sourceId,target:latest.revision,startedAt:Date.now()};
  if(pending.target!==latest.revision){
   // A newer deployed commit replaces the target AND starts a fresh full hour.
   pending.target=latest.revision;
   pending.startedAt=Date.now();
   retryAfter=0;
   note='새 커밋 확인 · 1시간 대기 다시 시작';
  }else note='';
  persist();draw();
  return true;
 }catch(error){console.warn('MYON rollout check:',error);return false;}
 finally{checking=false;}
}
async function apply(){
 if(!pending||applying||refreshIssued||Date.now()<retryAfter||progress()<100)return;
 if(document.hidden){note='화면 복귀 시 적용';draw();return;}
 if(checking){note='새 배포 최종 확인 중';draw();return;}
 applying=true;note='최신 배포와 저장 자료 확인 중';draw();
 let checkpointGranted=false;
 try{
  const target=pending.target,startedAt=pending.startedAt;
  const samePending=()=>pending&&pending.target===target&&pending.startedAt===startedAt&&progress()===100;
  // Even if the last poll was seconds ago, check before applying: a newer
  // deployment resets the timer instead of being silently included.
  if(!await check())throw Error('Deployment verification unavailable');
  if(!samePending())throw Error('NEW_COMMIT_RESTARTED_HOUR');
  const checkpoint=window.MYON_SAFE_UPDATE_CHECKPOINT;
  if(typeof checkpoint!=='function')throw Error('Save verification bridge unavailable');
  checkpointGranted=await checkpoint();
  if(!checkpointGranted)throw Error('Game or save is not safe for reload');
  // A newer release might land while IndexedDB is being checked.
  if(!await check())throw Error('Deployment changed or is unavailable');
  if(!samePending())throw Error('NEW_COMMIT_RESTARTED_HOUR');
  const parent=window.parent&&window.parent.location;
  if(!parent||typeof parent.replace!=='function'||typeof parent.href!=='string')
   throw Error('Parent refresh is unavailable');
  const next=new URL(parent.href);
  next.searchParams.set('myon_commit',target.slice(0,12));
  note='기존 세이브 확인 완료 · 최신 버전 적용';
  refreshIssued=true;draw();
  parent.replace(next.href); // Reload the Vue host, not just the stale iframe.
 }catch(error){
  console.warn('MYON update postponed without reload:',error);
  refreshIssued=false;
  if(error.message==='NEW_COMMIT_RESTARTED_HOUR'){
   note='새 커밋 확인 · 1시간 대기 다시 시작';
   retryAfter=0;
  }else{
   note='세이브 보호 · 안전 확인 후 자동 적용';
   retryAfter=Date.now()+30000;
  }
  if(checkpointGranted&&typeof window.MYON_CANCEL_UPDATE_LOCK==='function')
   window.MYON_CANCEL_UPDATE_LOCK();
 }finally{applying=false;draw();}
}
function syncSharedTimer(){
 // A second open MYON tab may detect the newer commit first.
 const shared=stored();
 if(shared&&(!pending||shared.target!==pending.target||shared.startedAt!==pending.startedAt)){
  pending=shared;retryAfter=0;note='새 커밋 확인 · 1시간 대기 다시 시작';
 }
}
function tick(){
 if(refreshIssued)return;
 syncSharedTimer();
 if(!pending)return;
 draw();
 if(progress()===100&&!applying)void apply();
}
pending=stored();
draw();
void check();
setInterval(check,CHECK_MS);
setInterval(tick,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){void check();tick();}});
window.addEventListener('online',()=>{void check();tick();});
})();