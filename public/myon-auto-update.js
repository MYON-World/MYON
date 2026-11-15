// MYON sequential release coordinator. Each deployed commit is an immutable game snapshot.
// A commit gets 60 minutes of rollout; after application, the next waits 60 minutes.
(function(){
'use strict';
if(/(?:^|\/)(?:test|dev)(?:\/|$)/.test(location.pathname))return;
try{
 if(window.parent&&window.parent!==window&&window.parent.MYON_ROLLOUT_HOST_ACTIVE===true)
  return; // Official launcher owns the installed SHA, countdown and navigation.
}catch(error){
 console.warn('MYON launcher visibility check:',error);
}

const KEY='myon-release-state-v2',WAIT=3600000,CHECK=60000;
const build=new URLSearchParams(location.search||'').get('build')||'';
const manifestUrl=location.pathname.match(/\/releases\/[a-f0-9]{40}\//i)?
 '../../myon-rollouts.json':'myon-rollouts.json';
const $=id=>document.getElementById(id),banner=$('auto-update-banner');
if(!banner||!/^[a-f0-9]{40}$/i.test(build))return;
let releases=[],busy=false,applying=false,reloading=false,retryAt=0,note='';
function read(){
 try{
  const s=JSON.parse(localStorage.getItem(KEY)||'null');
  return s&&s.schema===2&&/^[a-f0-9]{40}$/i.test(s.installed)&&
   ['idle','rollout','cooldown'].includes(s.phase)&&
   Number.isSafeInteger(s.startedAt)&&s.startedAt>=0&&
   (s.target===''||/^[a-f0-9]{40}$/i.test(s.target))?s:null;
 }catch(e){console.warn('MYON release state:',e);return null;}
}
function save(s){localStorage.setItem(KEY,JSON.stringify(s));}
function label(sha){const v=releases.find(x=>x.revision===sha);return v?'v'+v.version:'commit '+sha.slice(0,8);}
function nextAfter(sha){
 const i=releases.findIndex(x=>x.revision===sha);
 return i<0||i===releases.length-1?null:releases[i+1];
}
function duration(s,now){return Math.max(0,WAIT-(now-s.startedAt));}
function draw(now=Date.now()){
 const s=read();
 if(!s||s.installed!==build){banner.hidden=true;return;}
 const next=s.phase==='rollout'?releases.find(v=>v.revision===s.target):nextAfter(build);
 banner.hidden=!(next&&s.phase!=='idle');
 if(banner.hidden)return;
 const isCool=s.phase==='cooldown',remain=duration(s,now),pct=isCool?0:Math.min(100,Math.floor((1-remain/WAIT)*100));
 const seconds=Math.ceil(remain/1000);
 $('auto-update-title').textContent=isCool?'다음 커밋 대기 중':reloading?'다음 버전 여는 중':applying?'세이브 보호 확인 중':'신규 업데이트 적용 중';
 $('auto-update-version-from').textContent=label(build);
 $('auto-update-version-to').textContent=label(next.revision);
 $('auto-update-percent').textContent=pct+'%';
 const fill=$('auto-update-fill');if(fill)fill.style.width=pct+'%';
 const bar=$('auto-update-progress');if(bar)bar.setAttribute('aria-valuenow',String(pct));
 $('auto-update-remaining').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
 const detail=$('auto-update-detail');if(detail)detail.textContent=note||(isCool?'다음 커밋 시작까지 1시간 대기':'현재 버전 유지 · 적용까지 1시간');
}
async function check(){
 if(busy||reloading)return false;
 busy=true;
 try{
  const response=await fetch(manifestUrl+'?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('Manifest unavailable');
  const doc=await response.json();
  if(!doc||doc.schema!==1||!Array.isArray(doc.releases)||!doc.releases.length||
   !doc.releases.every(v=>v&&/^[a-f0-9]{40}$/i.test(v.revision)&&/^\d+\.\d+\.\d+$/.test(v.version)))
   throw Error('Invalid release manifest');
  releases=doc.releases;
  const s=read();
  if(!s)return false;
  if(s.installed!==build){draw();return true;}
  // Migrate or repair a skipped target while preserving an already-running hour.
  // Only the immediately following immutable commit can be installed.
  if(s.phase==='rollout'){
   const expected=nextAfter(build);
   if(!expected){s.phase='idle';s.target='';s.startedAt=0;save(s);}
   else if(s.target!==expected.revision){
    s.target=expected.revision;
    if(s.startedAt<=0||s.startedAt>Date.now()+60000)s.startedAt=Date.now();
    save(s);
   }
  }
  if(s.phase==='cooldown'&&duration(s,Date.now())===0){
   s.phase='idle';s.startedAt=0;s.target='';save(s);
  }
  if(s.phase==='idle'){
   const next=nextAfter(build);
   if(next){s.phase='rollout';s.target=next.revision;s.startedAt=Date.now();save(s);}
  }
  // A new commit never changes the current rollout target or start time.
  note='';draw();return true;
 }catch(error){console.warn('MYON release manifest:',error);note='연결 확인 중 · 현재 버전 유지';draw();return false;}
 finally{busy=false;}
}
async function apply(){
 if(applying||reloading||document.hidden||Date.now()<retryAt)return;
 const s=read();if(!s||s.installed!==build||s.phase!=='rollout'||duration(s,Date.now())>0)return;
 applying=true;note='업데이트 파일 및 기존 세이브 확인 중';draw();
 let locked=false;
 try{
  if(!await check())throw Error('Manifest unavailable');
  const fresh=read(),expected=nextAfter(build);
  if(!fresh||fresh.installed!==build||fresh.target!==s.target||fresh.startedAt!==s.startedAt||
   !expected||expected.revision!==fresh.target)throw Error('Pending release changed');
  if(typeof window.MYON_SAFE_UPDATE_CHECKPOINT!=='function')throw Error('Safe checkpoint unavailable');
  locked=await window.MYON_SAFE_UPDATE_CHECKPOINT();
  if(!locked)throw Error('Save checkpoint rejected');
  if(!await check()||!releases.some(v=>v.revision===s.target))throw Error('Snapshot no longer available');
  const verified=read();
  if(!verified||verified.installed!==build||verified.target!==s.target)throw Error('Concurrent release change');
  const parent=window.parent&&window.parent.location;
  if(!parent||typeof parent.replace!=='function')throw Error('Parent navigation unavailable');
  const next=new URL(parent.href);next.searchParams.set('myon_commit',s.target.slice(0,12));
  save({schema:2,installed:s.target,phase:'cooldown',target:'',startedAt:Date.now()});
  reloading=true;note='세이브 확인 완료 · 다음 커밋 적용';draw();
  parent.replace(next.href);
 }catch(error){
  console.warn('MYON safe update deferred:',error);
  note='세이브 보호 · 30초 후 다시 확인';retryAt=Date.now()+30000;
  if(locked&&typeof window.MYON_CANCEL_UPDATE_LOCK==='function')window.MYON_CANCEL_UPDATE_LOCK();
 }finally{applying=false;draw();}
}
function tick(){
 if(reloading)return;
 const s=read();
 if(s&&s.installed!==build){
  // Another tab installed a new revision. Never run mismatched game code against its save.
  if(!applying&&typeof window.MYON_SAFE_UPDATE_CHECKPOINT==='function'&&!document.hidden){
   applying=true;
   Promise.resolve(window.MYON_SAFE_UPDATE_CHECKPOINT()).then(ok=>{
    if(ok){reloading=true;window.parent.location.replace(window.parent.location.href);}
    else applying=false;
   }).catch(()=>{applying=false;});
  }
  return;
 }
 if(s&&s.phase==='cooldown'&&duration(s,Date.now())===0)void check();
 draw();
 if(s&&s.phase==='rollout'&&duration(s,Date.now())===0)void apply();
}
draw();void check();
setInterval(()=>{void check();},CHECK);
setInterval(tick,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){void check();tick();}});
window.addEventListener('online',()=>{void check();tick();});
window.addEventListener('storage',e=>{if(e.key===KEY)tick();});
})();