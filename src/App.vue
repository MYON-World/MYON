<script setup>
import {onMounted,ref} from 'vue'
import {ROLLOUT_KEY,LEGACY_ROLLOUT_KEY,validRevision,validReleases,
  validStoredState,reconcileState,migrateLegacy,initialState} from './core/myon-release-state.mjs'

const BASE=String(import.meta.env.BASE_URL)
const DB='myon-v00804-progress',STORE='game'
const frameUrl=ref(''),gameFrame=ref(null),playing=ref(false)
const working=ref(true),entering=ref(false),leaving=ref(false),backupBusy=ref(false)
// Emergency direct entry: independent of browser rollout records and manifest requests.
const FALLBACK_GAME='819714e6a633c1af012f7e4d2d56ec3f78581acc'
const latestRevision=ref(FALLBACK_GAME)
const activeRevision=ref(''),activeVersion=ref('—'),latestVersion=ref('v0.13.61')
const saveStatus=ref('저장자료 확인 중'),message=ref(''),manualBackup=ref('')
const canEnter=ref(true)

function fromStorage(key){
 try{return JSON.parse(localStorage.getItem(key)||'null')}
 catch(error){console.warn('MYON version record:',error);return null}
}
function existingGameMarkers(){
 const unknown={existing:true,bus:false,passes:false}
 if(!window.indexedDB||typeof indexedDB.databases!=='function')return Promise.resolve(unknown)
 return indexedDB.databases().then(list=>{
  if(!Array.isArray(list))return unknown
  if(!list.some(x=>x.name===DB))return {existing:false,bus:false,passes:false}
  return new Promise(resolve=>{
   const req=indexedDB.open(DB)
   req.onupgradeneeded=()=>req.transaction.abort()
   req.onerror=()=>resolve(unknown)
   req.onsuccess=()=>{
    const db=req.result
    if(!db.objectStoreNames.contains(STORE)){db.close();resolve(unknown);return}
    try{
     const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE)
     const bus=store.get('v01352-bus-world'),passes=store.get('v01354-special-passes')
     tx.oncomplete=()=>{db.close();resolve({existing:true,bus:!!bus.result,passes:!!passes.result})}
     tx.onerror=()=>{db.close();resolve(unknown)}
     tx.onabort=()=>{db.close();resolve(unknown)}
    }catch(error){db.close();resolve(unknown)}
   }
  })
 }).catch(()=>unknown)
}
function openPinned(sha,version){
 frameUrl.value=BASE+'releases/'+sha+'/myon.html?build='+encodeURIComponent(sha)
 document.title=version?'MYON v'+version:'MYON WORLD'
}
function enterLive(){
 if(entering.value)return
 // Do not consult the installed pin. Bypass the broken updater for every player.
 // Archived game scripts defer to this parent, so no FIFO timer starts.
 window.MYON_ROLLOUT_HOST_ACTIVE=true
 message.value=''
 entering.value=true
 openPinned(latestRevision.value,latestVersion.value.replace(/^v/,''))
 playing.value=true
}
function onGameLoad(){entering.value=false}
async function leaveLive(){
 if(leaving.value)return
 leaving.value=true;message.value=''
 try{
  // A failing checkpoint must never trap a player inside the game.
  // The game pagehide handler will attempt its normal save when we unmount it.
  const verify=gameFrame.value?.contentWindow?.MYON_SAFE_UPDATE_CHECKPOINT
  if(typeof verify==='function'&&!await verify())
   console.warn('MYON: save checkpoint unavailable; returning to launcher without resetting game records')
 }catch(error){console.warn('MYON exit checkpoint:',error)}
 playing.value=false
 frameUrl.value=''
 document.title='MYON WORLD · 서버 선택'
 leaving.value=false
}
// This launcher NEVER writes the legacy game database. Backup reads use readonly only.
function readOriginalSave(){
 return new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(Error('이 브라우저는 저장자료를 읽을 수 없습니다.'));return}
  let req
  try{req=indexedDB.open(DB)}catch(error){reject(error);return}
  req.onupgradeneeded=()=>req.transaction.abort()
  req.onerror=()=>reject(Error('기존 게임 저장소가 없거나 열 수 없습니다.'))
  req.onsuccess=()=>{
   const db=req.result
   if(!db.objectStoreNames.contains(STORE)){db.close();reject(Error('게임 저장자료가 없습니다.'));return}
   try{
    const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE)
    const keys=store.getAllKeys(),values=store.getAll()
    tx.oncomplete=()=>{
     db.close()
     const records={}
     keys.result.forEach((key,i)=>{records[String(key)]=values.result[i]})
     resolve({exportedAt:new Date().toISOString(),database:DB,store:STORE,records})
    }
    tx.onabort=()=>{db.close();reject(Error('저장자료 읽기가 중단되었습니다.'))}
    tx.onerror=()=>{db.close();reject(Error('저장자료 읽기에 실패했습니다.'))}
   }catch(error){db.close();reject(error)}
  }
 })
}
async function buildBackup(){
 const data=await readOriginalSave()
 if(!Object.keys(data.records).length)throw Error('보관할 게임 기록이 없습니다.')
 return JSON.stringify(data,null,2)
}
async function downloadSave(){
 if(backupBusy.value)return
 backupBusy.value=true;message.value=''
 try{
  const json=await buildBackup()
  const url=URL.createObjectURL(new Blob([json],{type:'application/json;charset=utf-8'}))
  const a=document.createElement('a')
  a.href=url;a.download='MYON-original-save-'+new Date().toISOString().slice(0,10)+'.json'
  document.body.appendChild(a);a.click();a.remove()
  setTimeout(()=>URL.revokeObjectURL(url),30000)
  message.value='원본 JSON 다운로드를 요청했습니다. 파일이 없다면 JSON 복사를 사용하세요.'
 }catch(error){message.value=error?.message||'백업을 만들 수 없습니다.'}
 finally{backupBusy.value=false}
}
async function copySave(){
 if(backupBusy.value)return
 backupBusy.value=true;message.value=''
 try{
  const json=await buildBackup()
  manualBackup.value=''
  if(navigator.clipboard?.writeText){
   try{await navigator.clipboard.writeText(json);message.value='원본 JSON을 복사했습니다. 안전한 곳에 보관하세요.';return}
   catch(error){console.warn('MYON clipboard:',error)}
  }
  manualBackup.value=json
  message.value='자동 복사가 지원되지 않아 아래에 JSON을 표시했습니다. 전체 선택하여 복사하세요.'
 }catch(error){message.value=error?.message||'백업을 읽을 수 없습니다.'}
 finally{backupBusy.value=false}
}
onMounted(async()=>{
 // Set BEFORE creating the game iframe, and never initialize the old rollout host.
 window.MYON_ROLLOUT_HOST_ACTIVE=true
 document.title='MYON WORLD · 서버 선택'
 const saved=fromStorage(ROLLOUT_KEY),legacy=fromStorage(LEGACY_ROLLOUT_KEY)
 try{
  const markers=await existingGameMarkers()
  saveStatus.value=markers.existing?'기존 저장자료 감지 또는 확인 필요':'현재 브라우저에 기존 세이브 없음'
  const response=await fetch(BASE+'myon-rollouts.json?portal='+Date.now(),{cache:'no-store'})
  if(!response.ok)throw Error('배포된 버전 목록을 받을 수 없습니다.')
  const manifest=await response.json(),releases=manifest?.releases
  if(manifest?.schema!==1||!validReleases(releases))throw Error('배포 버전 목록이 올바르지 않습니다.')
  latestRevision.value=releases[releases.length-1].revision
  latestVersion.value='v'+releases[releases.length-1].version
  const now=Date.now()
  // Invalid or absent per-user rollout state never prevents launching the latest game.
  const state=reconcileState(saved,releases,now)||migrateLegacy(legacy,releases,now)||
   initialState(releases,markers)
  const pinned=releases.find(v=>v.revision===state.installed)
  if(!pinned)throw Error('접속 가능한 게임 버전을 찾지 못했습니다.')
  activeRevision.value=pinned.revision
  activeVersion.value=pinned.version
  // Do not advance the saved version or touch its previous countdown.
 }catch(error){
  console.warn('MYON portal metadata unavailable; LIVE direct entry remains enabled:',error)
  message.value='버전 기록 확인에 실패했지만 LIVE 바로 입장은 가능합니다.'
  if(validStoredState(saved)&&validRevision(saved.installed)){
   activeRevision.value=saved.installed;activeVersion.value='마지막 저장 기록'
  }
 }finally{working.value=false}
})
</script>

<template>
 <main v-if="!playing" class="portal">
  <div class="wrap">
   <header class="heading">
    <div class="brand-mark">M</div>
    <div class="brand-copy"><div class="eyebrow">TRANSPORT SIMULATION</div><h1>MYON WORLD</h1><p>접속할 월드를 선택하세요.</p></div>
    <div class="status-pill"><span class="dot"></span> 통합 시작화면</div>
   </header>
   <div class="section-head"><span>SERVER SELECT</span><span>서버별 독립 운영 준비</span></div>
   <div class="servers">
    <button type="button" class="server-row live" :disabled="entering" @click="enterLive">
     <div class="server-main"><div class="server-icon">L</div><div class="server-copy"><strong>LIVE <small>정식 서비스</small></strong><span>최신 게임 바로 실행 · 기존 버전 대기열 우회</span></div></div>
     <div class="server-side"><span class="server-ver">{{ latestVersion }}</span><span class="entry-text">게임 바로 입장 ›</span></div>
    </button>
    <div class="server-row unavailable" aria-disabled="true">
     <div class="server-main"><div class="server-icon">T</div><div class="server-copy"><strong>TEST <small>테스트 서버</small></strong><span>독립 저장소 구성 후 개방</span></div></div>
     <div class="server-side"><span class="server-ver">미배포</span><span class="locked">준비 중</span></div>
    </div>
    <div class="server-row unavailable" aria-disabled="true">
     <div class="server-main"><div class="server-icon">D</div><div class="server-copy"><strong>DEV <small>개발 서버</small></strong><span>기존 유저 데이터를 보호하기 위해 접속 잠금</span></div></div>
     <div class="server-side"><span class="server-ver">미배포</span><span class="locked">준비 중</span></div>
    </div>
   </div>
   <div class="details">
    <section class="panel">
     <div class="panel-head"><h2>내 접속 기록</h2><span class="tag">기존 세이브 유지</span></div>
     <div class="kv"><span>마지막 플레이 버전</span><strong>{{ activeVersion==='—'?'확인 중':'v'+activeVersion }}</strong></div>
     <div class="kv"><span>LIVE 배포 최신 버전</span><strong>{{ latestVersion }}</strong></div>
     <p class="hint">{{ saveStatus }}</p>
     <p class="hint">LIVE 입장은 마지막 버전 대기열을 통과하지 않고 최신 게임을 즉시 실행합니다. 기존 저장 기록은 초기화하지 않습니다.</p>
    </section>
    <section class="panel">
     <div class="panel-head"><h2>세이브 자료 보관</h2><span class="tag">읽기 전용</span></div>
     <p class="hint">기존 브라우저의 원본 IndexedDB를 읽어 보관합니다. 저장 데이터를 삭제하거나 덮어쓰지 않습니다.</p>
     <div class="backup-actions">
      <button type="button" :disabled="backupBusy" @click="downloadSave">원본 JSON 다운로드</button>
      <button type="button" :disabled="backupBusy" @click="copySave">원본 JSON 복사</button>
      <a :href="BASE+'myon-recovery.html'" target="_blank" rel="noopener">상세 진단 보기</a>
     </div>
    </section>
   </div>
   <div v-if="message" class="notice" role="status">{{ message }}</div>
   <div v-if="manualBackup" class="manual-area"><label for="manual-json">원본 JSON · 전체 선택 후 복사</label><textarea id="manual-json" :value="manualBackup" readonly rows="7"></textarea></div>
   <footer>MYON WORLD · 게임 바로 입장 · 자동 업데이트 일시 중단</footer>
  </div>
 </main>
 <section v-else class="live-session">
  <iframe v-if="frameUrl" ref="gameFrame" class="game-frame" :src="frameUrl" title="MYON LIVE 게임" @load="onGameLoad"></iframe>
  <div class="game-controls"><button type="button" :disabled="leaving" @click="leaveLive">{{ leaving?'저장 확인 중':'← 시작화면' }}</button><span v-if="message" class="game-message" role="status">{{ message }}</span></div>
 </section>
</template>

<style scoped>
.portal{height:100vh;height:100dvh;overflow-y:auto;background:radial-gradient(ellipse at 80% -12%,#244f49 0%,transparent 48%),#0e171b;color:#eff8f3}
.wrap{max-width:920px;margin:0 auto;padding:32px 19px 64px}
.heading{display:flex;align-items:center;gap:16px;margin-bottom:38px}
.brand-mark{width:54px;height:54px;flex:none;display:grid;place-items:center;border-radius:16px;background:linear-gradient(145deg,#79e4bb,#276e63);color:#09251f;font-size:33px;font-weight:900}
.brand-copy{flex:1;min-width:0}.brand-copy h1{margin:2px 0 3px;letter-spacing:.06em;font-size:26px;line-height:1.12}.brand-copy p{color:#9eb6af;font-size:12px;margin:0}
.eyebrow,.section-head{color:#80bda7;font-weight:700;letter-spacing:.16em;font-size:10px}
.status-pill{font-size:11px;color:#b3dacb;background:#213c37;padding:10px 12px;border-radius:999px;white-space:nowrap}
.dot{display:inline-block;width:7px;height:7px;background:#7ce1a9;border-radius:100%;margin-right:4px}
.section-head{display:flex;justify-content:space-between;margin-bottom:12px}.section-head span:last-child{letter-spacing:0;color:#78998e;font-weight:400}
.servers{display:grid;gap:10px}
.server-row{width:100%;min-height:104px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 20px;border-radius:16px;border:1px solid #345149;background:#182b29;color:#f1faf6;text-align:left;font:inherit}
button.server-row{cursor:pointer}
button.server-row.live{border-color:#4b9b7d;background:linear-gradient(100deg,#20453a,#1a3733);box-shadow:0 6px 28px #0002}
button.server-row.live:hover:not(:disabled){border-color:#91e2bb;filter:brightness(1.1)}
button.server-row:disabled{cursor:not-allowed;opacity:.65}
.server-row.unavailable{opacity:.75}
.server-main{display:flex;align-items:center;gap:14px;min-width:0}
.server-icon{width:50px;height:50px;display:grid;place-items:center;flex:none;background:#2c4a42;color:#98dfbe;font-size:22px;font-weight:800;border-radius:13px}
.server-copy{min-width:0;display:grid;gap:7px}
.server-copy strong{font-size:19px;letter-spacing:.03em}.server-copy small{font-size:12px;margin-left:7px;font-weight:500;color:#aac9bf;letter-spacing:0}
.server-copy span{color:#91afa5;font-size:12px;line-height:1.45}
.server-side{display:grid;gap:8px;text-align:right;flex:none}
.server-ver{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.entry-text{font-size:12px;color:#9eebc7;font-weight:700}.locked{font-size:11px;color:#829d94}
.details{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px}
.panel{background:#172622;border:1px solid #30473f;padding:19px;border-radius:16px;min-width:0}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:15px}
.panel-head h2{font-size:15px;margin:0}.tag{font-size:10px;color:#9cdbbe;border:1px solid #4b755f;padding:5px 8px;border-radius:20px;white-space:nowrap}
.kv{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0;font-size:12px;color:#a5b9b1}.kv strong{color:#e6fff2;font-size:14px}
.hint{color:#a3b8af;font-size:12px;line-height:1.65;margin:10px 0 0}
.backup-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:17px}.backup-actions button,.backup-actions a{background:#29473c;color:#e5fff1;border:1px solid #4c8067;padding:10px 12px;border-radius:9px;font-size:11px;text-decoration:none;cursor:pointer}.backup-actions button:disabled{opacity:.5;cursor:not-allowed}
.notice{margin-top:16px;padding:13px 15px;border-radius:10px;background:#263832;color:#d9f4e4;font-size:12px;line-height:1.5}
.manual-area{margin-top:14px}.manual-area label{display:block;font-size:12px;margin-bottom:8px}.manual-area textarea{width:100%;resize:vertical;border:1px solid #4a6d5b;border-radius:10px;background:#111e1b;color:#e3f7e9;padding:12px}
footer{margin-top:27px;color:#638278;font-size:11px;text-align:center}
.live-session{position:relative;width:100%;height:100vh;height:100dvh;background:#0e171b}
.game-frame{display:block;width:100%;height:100%;border:0;background:#0e171b}
.game-controls{position:absolute;z-index:10;bottom:13px;left:12px;display:flex;gap:8px;align-items:center;max-width:calc(100% - 24px)}
.game-controls button{background:#213c35eF;color:#dbf9e8;border:1px solid #64a68a;border-radius:100px;padding:9px 13px;font-size:11px;cursor:pointer;box-shadow:0 4px 16px #0008}
.game-controls button:disabled{opacity:.5}.game-message{background:#3b2524;color:#ffe5d7;border-radius:8px;padding:8px;font-size:11px}
@media(max-width:590px){
 .wrap{padding:22px 13px 50px}.heading{gap:10px;margin-bottom:30px}.brand-mark{width:46px;height:46px;font-size:27px;border-radius:12px}
 .brand-copy h1{font-size:21px}.brand-copy p{font-size:11px}.status-pill{font-size:9px;padding:8px}
 .server-row{min-height:98px;padding:14px 12px;border-radius:13px;gap:8px}
 .server-main{gap:10px}.server-icon{width:40px;height:40px;font-size:19px;border-radius:10px}
 .server-copy strong{font-size:16px}.server-copy small{font-size:11px;margin-left:3px}.server-copy span{font-size:10px}
 .server-ver{font-size:12px}.server-side{gap:7px}.entry-text{font-size:10px}
 .details{grid-template-columns:1fr}.panel{padding:17px}
}
</style>
