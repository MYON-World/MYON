import {ROLLOUT_KEY,validReleases,reconcileState,following,validStoredState} from './myon-release-state.mjs';

// A single parent-owned coordinator. Archived iframe copies NEVER advance
// commits or navigate the host: they only expose MYON_SAFE_UPDATE_CHECKPOINT.
const HOUR=3600000,RETRY=30000;
export function createRolloutHost({base,win,doc,storage,initialReleases,getFrame,setFrame,onVersion,
 now=()=>Date.now(),request=(...args)=>fetch(...args),schedule=(fn,ms)=>setInterval(fn,ms)}){
 let releases=initialReleases,checking=false,applying=false,transitioning=false,started=false;
 let retryAt=0,note='',errorMessage='';
 const read=()=>{try{const s=JSON.parse(storage.getItem(ROLLOUT_KEY)||'null');return validStoredState(s)?s:null;}catch(e){return null;}};
 const write=s=>storage.setItem(ROLLOUT_KEY,JSON.stringify(s));
 const version=sha=>releases.find(v=>v.revision===sha)?.version||'?';
 function buildInFrame(){
  const frame=getFrame();if(!frame)return null;
  try{
   const u=new URL(frame.contentWindow?.location?.href||frame.src||'',win.location.href);
   const match=u.pathname.match(/\/releases\/([a-f0-9]{40})\/myon\.html$/i);
   return match&&u.searchParams.get('build')===match[1]?match[1]:null;
  }catch(e){return null;}
 }
 function draw(){
  const page=getFrame()?.contentDocument, state=read();
  const banner=page?.getElementById('auto-update-banner');
  if(!banner)return;
  const next=state?.phase==='rollout'?releases.find(x=>x.revision===state.target):
   state?following(releases,state.installed):null;
  const codeBuild=buildInFrame();
  if(state&&state.installed===codeBuild){
   const versionLabel=page.getElementById('home-version');
   if(versionLabel)versionLabel.textContent='v'+version(state.installed);
  }
  const shown=Boolean(state&&next&&state.phase!=='idle'&&state.installed===codeBuild);
  banner.hidden=!shown;if(!shown)return;
  const cooling=state.phase==='cooldown';
  const remain=Math.max(0,HOUR-(now()-state.startedAt));
  const pct=cooling?0:Math.min(100,Math.floor((1-remain/HOUR)*100));
  const seconds=Math.ceil(remain/1000);
  const set=(id,v)=>{const e=page.getElementById(id);if(e)e.textContent=v;};
  set('auto-update-title',cooling?'다음 커밋 대기 중':applying?'세이브 저장 확인 중':'신규 업데이트 적용 중');
  set('auto-update-version-from','v'+version(state.installed));
  set('auto-update-version-to','v'+version(next.revision));
  set('auto-update-percent',pct+'%');
  set('auto-update-remaining',String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'));
  set('auto-update-detail',note||errorMessage||(cooling?'1시간 대기 · 다음 커밋 타이머는 아직 시작되지 않음':'1시간 적용 타이머 · 현재 버전 유지'));
  const fill=page.getElementById('auto-update-fill');if(fill)fill.style.width=pct+'%';
  const progress=page.getElementById('auto-update-progress');if(progress)progress.setAttribute('aria-valuenow',String(pct));
 }
 async function getManifest(){
  const res=await request(base+'myon-rollouts.json?check='+now(),{cache:'no-store'});
  if(!res.ok)throw Error('Manifest unavailable');
  const doc=await res.json();
  if(doc.schema!==1||!validReleases(doc.releases))throw Error('Invalid manifest');
  return doc.releases;
 }
 async function poll(){
  if(checking||transitioning)return false;
  checking=true;
  try{
   const list=await getManifest();
   if(releases.some((item,i)=>list[i]?.revision!==item.revision))
    throw Error('Release order changed: old snapshot removed or reordered');
   const existing=read();
   if(!existing||!list.some(x=>x.revision===existing.installed))throw Error('Pinned revision missing');
   releases=list;
   const next=reconcileState(existing,releases,now());
   if(!next)throw Error('Pinned revision invalid');
   if(next.phase==='cooldown'&&now()>=next.startedAt+HOUR){
    next.phase='idle';next.target='';next.startedAt=0;
   }
   if(next.phase==='idle'){
    const followingCommit=following(releases,next.installed);
    if(followingCommit){
     next.phase='rollout';next.target=followingCommit.revision;next.startedAt=now();
    }
   }
   if(JSON.stringify(next)!==JSON.stringify(existing))write(next);
   note='';errorMessage='';draw();return true;
  }catch(error){
   errorMessage='배포 버전 검증 실패 · 현재 버전 유지';
   win.console?.warn('MYON rollout kept pinned:',error);
   draw();return false;
  }finally{checking=false;}
 }
 const identical=(a,b)=>Boolean(a&&b&&a.installed===b.installed&&a.phase===b.phase&&a.target===b.target&&a.startedAt===b.startedAt);
 async function checkFile(sha){
  const res=await request(base+'releases/'+sha+'/myon.html?verify='+now(),{method:'HEAD',cache:'no-store'});
  return res.ok;
 }
 async function checkpoint(){
  try{
   const fn=getFrame()?.contentWindow?.MYON_SAFE_UPDATE_CHECKPOINT;
   return typeof fn==='function'&&await fn();
  }catch(error){win.console?.warn('MYON checkpoint:',error);return false;}
 }
 async function apply(){
  if(applying||transitioning||checking||doc.hidden||now()<retryAt)return false;
  const s=read();
  if(!s||s.phase!=='rollout'||now()<s.startedAt+HOUR||s.installed!==buildInFrame())return false;
  applying=true;note='다음 커밋 파일 확인 및 세이브 검증 중';draw();
  let locked=false;
  try{
   if(!await poll()||!identical(read(),s))throw Error('Pending revision changed');
   if(following(releases,s.installed)?.revision!==s.target||!await checkFile(s.target))
    throw Error('Next immutable snapshot unavailable');
   locked=await checkpoint();if(!locked)throw Error('Save checkpoint denied');
   if(!await poll()||!identical(read(),s)||
    following(releases,s.installed)?.revision!==s.target||!await checkFile(s.target))
    throw Error('Pending commit changed during save');
   const installed={schema:2,installed:s.target,phase:'cooldown',target:'',startedAt:now()};
   if(!identical(read(),s))throw Error('Another tab changed the state');
   write(installed);
   transitioning=true;
   onVersion?.(version(installed.installed));
   setFrame(base+'releases/'+installed.installed+'/myon.html?build='+installed.installed);
   return true;
  }catch(error){
   win.console?.warn('MYON safe application deferred:',error);
   note='세이브 보호 · 기존 버전 계속 실행';retryAt=now()+RETRY;
   if(locked)getFrame()?.contentWindow?.MYON_CANCEL_UPDATE_LOCK?.();
   return false;
  }finally{applying=false;draw();}
 }
 async function syncOtherTab(){
  if(applying||transitioning||doc.hidden||now()<retryAt)return;
  const s=read(),frame=buildInFrame();
  if(!s||!frame||s.installed===frame)return;
  applying=true;let locked=false;
  try{
   locked=await checkpoint();if(!locked)throw Error('Uncommitted save in another tab');
   if(!await checkFile(s.installed))throw Error('Snapshot unavailable');
   transitioning=true;onVersion?.(version(s.installed));
   setFrame(base+'releases/'+s.installed+'/myon.html?build='+s.installed);
  }catch(error){
   retryAt=now()+RETRY;note='다른 탭 버전 확인 중 · 안전 저장 대기';
   if(locked)getFrame()?.contentWindow?.MYON_CANCEL_UPDATE_LOCK?.();
  }finally{applying=false;draw();}
 }
 function tick(){
  if(!started)return;
  const s=read();
  if(!s){errorMessage='업데이트 기록 없음 · 자동 적용 중단';draw();return;}
  const frame=buildInFrame();
  if(s.installed!==frame){if(frame)void syncOtherTab();draw();return;}
  draw();
  if(!checking&&!applying&&!transitioning){
   if(s.phase==='cooldown'&&now()>=s.startedAt+HOUR)void poll();
   else if(s.phase==='rollout'&&now()>=s.startedAt+HOUR)void apply();
  }
 }
 function onLoad(){
  const sha=buildInFrame(),state=read();
  if(sha&&sha===state?.installed){
   transitioning=false;onVersion?.(version(sha));note='';draw();void poll();
  }else if(sha)void syncOtherTab();
 }
 function start(){
  if(started)return;started=true;
  win.MYON_ROLLOUT_HOST_ACTIVE=true;
  schedule(()=>{void poll()},60000);schedule(tick,1000);
  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden){void poll();tick();}});
  win.addEventListener('online',()=>{void poll();tick();});
  win.addEventListener('storage',e=>{if(e.key===ROLLOUT_KEY)tick();});
  void poll();tick();
 }
 return {start,onLoad,poll,tick,apply,read,draw};
}
