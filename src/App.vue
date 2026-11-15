<script setup>
import {onMounted,ref} from 'vue'
import {validReleases} from './core/myon-release-state.mjs'
import {LIVE_RELEASE,TEST_RELEASE,dbForServer,targetForServer,
 archiveUrl,verifyArchive,createEntryCheckpoint,readGameRecords} from './core/myon-server-entry.mjs'

const BASE=String(import.meta.env.BASE_URL)
const frameUrl=ref(''),gameFrame=ref(null),playing=ref(false),currentServer=ref('')
const entering=ref(false),leaving=ref(false),backupBusy=ref(false)
const entryStep=ref(''),message=ref(''),manualBackup=ref('')
const entryServer=ref(''),entryIndex=ref(0),entryCompleted=ref(0),entryFailed=ref(false)
const entryVersion=ref('—'),entryRevision=ref(''),entrySaveNote=ref('')
const ENTRY_CHECKS=[
 {title:'커밋 · 버전 확인',note:'서버에 적용될 정확한 배포 버전을 확인합니다.'},
 {title:'게임 파일 검사',note:'해당 버전의 실제 게임 파일을 확인합니다.'},
 {title:'세이브 안전 검증',note:'기존 세이브를 읽고 백업본을 다시 확인합니다.'},
 {title:'입장 준비 완료',note:'검사가 끝난 버전으로 게임에 접속합니다.'}
]
// Display completed checks long enough to read; never mark a check done before it resolves.
async function showVerifiedStep(index){
 entryCompleted.value=index+1
 await new Promise(resolve=>setTimeout(resolve,700))
}
function closeEntryResult(){if(!entering.value)entryFailed.value=false}
const latestRevision=ref(''),latestVersion=ref('—'),liveVersion=ref('v'+LIVE_RELEASE.version)
const testVersion=ref(TEST_RELEASE?'v'+TEST_RELEASE.version:'미승인')
const activeVersion=ref('—'),saveStatus=ref('기존 기록 확인은 입장 시 진행합니다.')
let releases=null

const SERVER_LABELS={live:'LIVE',test:'TEST',dev:'DEV'}
function serverTitle(server){return SERVER_LABELS[server]||server}
async function refreshReleases(){
 const response=await fetch(BASE+'myon-rollouts.json?at='+Date.now(),{cache:'no-store'})
 if(!response.ok)throw Error('최신 버전 목록을 받을 수 없습니다.')
 const manifest=await response.json()
 if(manifest?.schema!==1||!validReleases(manifest.releases))
  throw Error('배포 버전 목록을 검증하지 못했습니다.')
 releases=manifest.releases
 const current=targetForServer('dev',releases)
 latestRevision.value=current.revision
 latestVersion.value='v'+current.version
 return releases
}
async function enterServer(server){
 if(entering.value||playing.value)return
 if(server==='test'&&!TEST_RELEASE){message.value='TEST 승인 버전이 아직 없습니다.';return}
 entering.value=true;message.value=''
 entryServer.value=server;entryIndex.value=0;entryCompleted.value=0
 entryFailed.value=false;entryVersion.value='—';entryRevision.value='';entrySaveNote.value=''
 try{
  entryStep.value='배포 버전 확인 중'
  const available=server==='dev'?await refreshReleases():releases
  const target=targetForServer(server,available)
  if(!target)throw Error('입장 가능한 승인 버전이 없습니다.')
  entryVersion.value='v'+target.version
  entryRevision.value=target.revision.slice(0,8)
  await showVerifiedStep(0)
  entryIndex.value=1
  entryStep.value='게임 파일 확인 중'
  const url=await verifyArchive({base:BASE,server,revision:target.revision})
  await showVerifiedStep(1)
  entryIndex.value=2
  entryStep.value='세이브 읽기 및 백업 검증 중'
  const save=await createEntryCheckpoint({server,revision:target.revision})
  entrySaveNote.value=save.backup?
   save.records+'건 · 백업본 재검증 완료':'새 서버 · 기존 저장 기록 없음'
  saveStatus.value=save.backup?
   serverTitle(server)+' 세이브 '+save.records+'건 백업·검증 완료':
   serverTitle(server)+' 새 저장소 · 초기 기록 없음'
  await showVerifiedStep(2)
  entryIndex.value=3
  entryStep.value='검사 완료 · 서버 입장 준비 중'
  // Only after the exact immutable file and save round-trip both succeed.
  window.MYON_ROLLOUT_HOST_ACTIVE=true
  window.MYON_ACTIVE_GAME_VERSION='v'+target.version
  currentServer.value=server
  await showVerifiedStep(3)
  entryStep.value=''
  frameUrl.value=url
  playing.value=true
  document.title='MYON '+serverTitle(server)+' v'+target.version
 }catch(error){
  console.error('MYON server entry:',error)
  message.value=(error?.message||'입장 준비 실패')+' · 기존 세이브는 초기화하지 않았습니다.'
  entryFailed.value=true
  entryStep.value='입장 전 검사에 실패했습니다.'
 }finally{entering.value=false}
}
function onGameLoad(){}
async function leaveServer(){
 if(leaving.value)return
 leaving.value=true;message.value=''
 try{
  const checkpoint=gameFrame.value?.contentWindow?.MYON_SAFE_UPDATE_CHECKPOINT
  if(typeof checkpoint==='function'&&!await checkpoint())
   throw Error('세이브 저장 확인 실패. 게임을 유지합니다.')
  if(typeof checkpoint!=='function')
   throw Error('저장 확인 함수가 아직 준비되지 않았습니다.')
  frameUrl.value='';playing.value=false;currentServer.value=''
  document.title='MYON WORLD · 서버 선택'
 }catch(error){message.value=error?.message||'종료 전 저장 확인 실패'}
 finally{leaving.value=false}
}
function backupServerName(){return playing.value?currentServer.value:'live'}
async function buildBackup(){
 const server=backupServerName()
 const records=await readGameRecords(globalThis.indexedDB,server)
 if(!records.length)throw Error('보관할 '+serverTitle(server)+' 기록이 없습니다.')
 return JSON.stringify({schema:1,server,database:dbForServer(server),exportedAt:new Date().toISOString(),records},null,2)
}
async function downloadSave(){
 if(backupBusy.value)return
 backupBusy.value=true;message.value=''
 try{
  const json=await buildBackup()
  const url=URL.createObjectURL(new Blob([json],{type:'application/json;charset=utf-8'}))
  const a=document.createElement('a')
  a.href=url;a.download='MYON-'+backupServerName()+'-save-'+new Date().toISOString().slice(0,10)+'.json'
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
   try{await navigator.clipboard.writeText(json);message.value='원본 JSON을 복사했습니다.';return}
   catch(error){console.warn('MYON clipboard:',error)}
  }
  manualBackup.value=json
  message.value='아래 JSON을 전체 선택하여 복사하세요.'
 }catch(error){message.value=error?.message||'원본 JSON을 읽을 수 없습니다.'}
 finally{backupBusy.value=false}
}
onMounted(async()=>{
 // Every visit always returns to the stable portal. Never start the old auto updater.
 window.MYON_ROLLOUT_HOST_ACTIVE=true
 document.title='MYON WORLD · 서버 선택'
 try{await refreshReleases()}
 catch(error){message.value='DEV 최신 목록 확인 실패: DEV 입장에서 재시도할 수 있습니다.';console.warn(error)}
})
</script>

<template>
 <main v-if="!playing" class="portal">
  <div class="wrap">
   <header class="heading">
    <div class="brand-mark">M</div>
    <div class="brand-copy"><div class="eyebrow">TRANSPORT SIMULATION</div><h1>MYON WORLD</h1><p>접속할 서버를 선택하세요.</p></div>
    <div class="status-pill"><span class="dot"></span> 통합 시작화면</div>
   </header>
   <div class="section-head"><span>SERVER SELECT</span><span>입장할 때 업데이트 · 플레이 중 버전 고정</span></div>
   <div class="servers">
    <button type="button" class="server-row live" :disabled="entering" @click="enterServer('live')">
     <div class="server-main"><div class="server-icon">L</div><div class="server-copy"><strong>LIVE <small>정식 서비스</small></strong><span>승인된 버전 고정 · 기존 유저 기록 유지</span></div></div>
     <div class="server-side"><span class="server-ver">{{ liveVersion }}</span><span class="entry-text">정식 서버 입장 ›</span></div>
    </button>
    <div class="server-row unavailable" aria-disabled="true">
     <div class="server-main"><div class="server-icon">T</div><div class="server-copy"><strong>TEST <small>테스트 서버</small></strong><span>검증 완료 버전 지정 후 개방 · 저장소 분리됨</span></div></div>
     <div class="server-side"><span class="server-ver">{{ testVersion }}</span><span class="locked">승인 대기</span></div>
    </div>
    <button type="button" class="server-row dev" :disabled="entering" @click="enterServer('dev')">
     <div class="server-main"><div class="server-icon">D</div><div class="server-copy"><strong>DEV <small>개발 서버</small></strong><span>main의 최신 배포본 · DEV 전용 저장소</span></div></div>
     <div class="server-side"><span class="server-ver">{{ latestVersion }}</span><span class="entry-text">개발 서버 입장 ›</span></div>
    </button>
   </div>
   <div class="details">
    <section class="panel">
     <div class="panel-head"><h2>입장 안정화</h2><span class="tag">공통 규칙</span></div>
     <div class="kv"><span>LIVE 승인 버전</span><strong>{{ liveVersion }}</strong></div>
     <div class="kv"><span>DEV 최신 배포 버전</span><strong>{{ latestVersion }}</strong></div>
     <p class="hint">{{ saveStatus }}</p>
     <p class="hint">입장을 누르면 버전 파일 확인 → 세이브 읽기 → 별도 백업 및 재검증 → 게임 실행. 진행 중 새 커밋이 올라와도 강제 전환하지 않습니다.</p>
    </section>
    <section class="panel">
     <div class="panel-head"><h2>세이브 자료 보관</h2><span class="tag">원본 읽기 전용</span></div>
     <p class="hint">LIVE · TEST · DEV의 게임 저장소는 독립적입니다. 입장 전 백업은 이 브라우저의 별도 백업 저장소에 기록합니다. 다른 기기로 옮길 때는 JSON 다운로드가 필요합니다.</p>
     <div class="backup-actions">
      <button type="button" :disabled="backupBusy||entering" @click="downloadSave">LIVE 원본 JSON 다운로드</button>
      <button type="button" :disabled="backupBusy||entering" @click="copySave">LIVE 원본 JSON 복사</button>
      <a :href="BASE+'myon-recovery.html'" target="_blank" rel="noopener">LIVE 상세 진단</a>
     </div>
    </section>
   </div>
   <div v-if="message&&!entryFailed" class="notice" role="status">{{ message }}</div>
   <div v-if="manualBackup" class="manual-area"><label for="manual-json">원본 JSON · 전체 선택 후 복사</label><textarea id="manual-json" :value="manualBackup" readonly rows="7"></textarea></div>
   <footer>MYON WORLD · 공통 입장 절차 · 자동 업데이트 및 강제 재접속 중지</footer>
  </div>
  <div v-if="entering||entryFailed" class="entry-overlay" role="dialog" aria-modal="true" aria-label="서버 입장 검사 진행 상황">
   <section class="entry-panel" aria-live="polite">
    <div class="entry-overline">MYON SECURE ENTRY</div>
    <h2>{{ serverTitle(entryServer) }} 서버 입장 검사</h2>
    <p class="entry-subtitle">완료된 항목만 확인 표시됩니다. 검사가 실패하면 게임을 실행하지 않습니다.</p>
    <div class="entry-version-pair"><span>대상 버전 <strong>{{ entryVersion }}</strong></span><span v-if="entryRevision">커밋 <code>{{ entryRevision }}</code></span></div>
    <div class="entry-progress-head"><strong>{{ entryFailed?'검사 중단':entryCompleted===ENTRY_CHECKS.length?'전체 검사 완료':entryStep }}</strong><strong>{{ Math.round(entryCompleted/ENTRY_CHECKS.length*100) }}%</strong></div>
    <div class="entry-progress-track" role="progressbar" :aria-valuenow="Math.round(entryCompleted/ENTRY_CHECKS.length*100)" aria-valuemin="0" aria-valuemax="100"><div class="entry-progress-fill" :style="{width:(entryCompleted/ENTRY_CHECKS.length*100)+'%'}"></div></div>
    <ol class="entry-checks">
     <li v-for="(step,i) in ENTRY_CHECKS" :key="step.title" :class="{complete:i<entryCompleted,active:i===entryIndex&&!entryFailed&&i>=entryCompleted,failed:i===entryIndex&&entryFailed}">
      <span class="entry-check-icon">{{ i<entryCompleted?'✓':i===entryIndex&&entryFailed?'!':i===entryIndex?'…':i+1 }}</span>
      <span class="entry-check-copy"><strong>{{ step.title }}</strong><small>{{ step.note }}</small></span>
      <span class="entry-check-state">{{ i<entryCompleted?'완료':i===entryIndex&&entryFailed?'실패':i===entryIndex?'확인 중':'대기' }}</span>
     </li>
    </ol>
    <div v-if="entrySaveNote" class="entry-save-note">{{ entrySaveNote }}</div>
    <p v-if="entryFailed" class="entry-error" role="alert">{{ message }}</p>
    <button v-if="entryFailed" type="button" class="entry-dismiss" @click="closeEntryResult">시작화면으로 돌아가기</button>
   </section>
  </div>
 </main>
 <section v-else class="live-session">
  <iframe v-if="frameUrl" ref="gameFrame" class="game-frame" :src="frameUrl" :title="'MYON '+serverTitle(currentServer)+' 게임'" @load="onGameLoad"></iframe>
  <div class="game-controls"><button type="button" :disabled="leaving" @click="leaveServer">{{ leaving?'저장 확인 중':'← 시작화면' }}</button><span v-if="message" class="game-message" role="status">{{ message }}</span></div>
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
button.server-row.dev{border-color:#6080a0;background:linear-gradient(100deg,#243748,#1b2a38)}
button.server-row.dev:hover:not(:disabled){border-color:#8cbbdb;filter:brightness(1.1)}
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
.entry-overlay{position:fixed;z-index:50;inset:0;display:grid;place-items:center;background:#08120feE;padding:15px;overflow:auto}
.entry-panel{width:100%;max-width:500px;padding:25px 22px;border:1px solid #447a63;border-radius:19px;background:#172b25;box-shadow:0 20px 70px #000b}
.entry-overline{font-size:10px;letter-spacing:.2em;font-weight:700;color:#89d6ad}
.entry-panel h2{font-size:21px;margin:7px 0}.entry-subtitle{font-size:12px;line-height:1.6;color:#adc5ba;margin:0 0 18px}
.entry-version-pair{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:12px;color:#b9d4c4;padding:10px 12px;background:#213e32;border-radius:9px}
.entry-version-pair strong,.entry-version-pair code{font-weight:700;color:#e3ffed}
.entry-progress-head{display:flex;justify-content:space-between;gap:12px;font-size:12px;margin:20px 0 9px;color:#e5f8ea}
.entry-progress-track{height:7px;border-radius:99px;overflow:hidden;background:#34463e}
.entry-progress-fill{height:100%;border-radius:99px;background:#78d6ac;transition:width .45s ease}
.entry-checks{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:8px}
.entry-checks li{display:flex;align-items:center;gap:11px;padding:11px;border:1px solid #30473e;border-radius:11px;color:#8ca69a;background:#1a3028}
.entry-checks li.complete{border-color:#396f55;color:#d9f4e4}
.entry-checks li.active{border-color:#79b79b;background:#264336;color:#f0fff4}
.entry-checks li.failed{border-color:#ac5858;color:#ffe1de}
.entry-check-icon{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:50%;background:#354a41;color:#aec5b5;font-size:13px;font-weight:800}
.entry-checks .complete .entry-check-icon{background:#347450;color:#f3fff8}
.entry-checks .active .entry-check-icon{background:#547966;color:#fff}
.entry-check-copy{display:grid;gap:3px;min-width:0;flex:1}
.entry-check-copy strong{font-size:13px}
.entry-check-copy small{font-size:11px;color:#8fac9e;line-height:1.4}
.entry-check-state{font-size:11px;white-space:nowrap}
.entry-save-note{font-size:12px;color:#b9e7c9;margin-top:15px}
.entry-error{color:#ffd8d3;font-size:12px;line-height:1.6}
.entry-dismiss{margin-top:10px;border:1px solid #87c6a2;background:#2b5b44;color:#fff;padding:11px 15px;border-radius:9px;cursor:pointer}
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
