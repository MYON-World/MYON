<script setup>
import {onMounted,onUnmounted,computed,ref} from 'vue'
import {validReleases} from './core/myon-release-state.mjs'
import {validDevSunset,parseServerDate,syncedNow,remainingDevMs,formatDevCountdown} from './core/myon-dev-retirement.mjs'
import {prepareDevVersion} from './core/myon-dev-version.mjs'
import {visibleVersionHistory} from './core/myon-version-history.mjs'
import {validSunset,readTestRetirement,retireTestOnce} from './core/myon-test-retirement.mjs'
import {TEST_RELEASE,dbForServer,targetForServer,
 archiveUrl,verifyArchive,createEntryCheckpoint,readGameRecords,readMissionRecords} from './core/myon-server-entry.mjs'

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
// Completed checks alone advance the ring; never animate progress before verification.
const ENTRY_RING_CIRCUMFERENCE=2*Math.PI*67
const entryVisualPercent=ref(0)
let entryProgressFrame=0
function animateEntryProgress(target){
 if(entryProgressFrame)cancelAnimationFrame(entryProgressFrame)
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
 if(reduced){entryVisualPercent.value=target;entryProgressFrame=0;return}
 const from=entryVisualPercent.value
 const start=performance.now()
 const duration=620
 function frame(now){
  const t=Math.min(1,(now-start)/duration)
  const eased=1-Math.pow(1-t,3)
  entryVisualPercent.value=Math.round(from+(target-from)*eased)
  if(t<1)entryProgressFrame=requestAnimationFrame(frame)
  else entryProgressFrame=0
 }
 entryProgressFrame=requestAnimationFrame(frame)
}
async function showVerifiedStep(index){
 entryCompleted.value=index+1
 animateEntryProgress(Math.round(entryCompleted.value/ENTRY_CHECKS.length*100))
 await new Promise(resolve=>setTimeout(resolve,700))
}
function closeEntryResult(){if(!entering.value)entryFailed.value=false}
const latestRevision=ref(''),latestVersion=ref('—'),liveVersion=ref('—')
const testVersion=ref(TEST_RELEASE?'v'+TEST_RELEASE.version:'미승인')
const activeVersion=ref('—'),saveStatus=ref('기존 기록 확인은 입장 시 진행합니다.')
const changes=ref([])
let releases=null

// DEV access is blocked immediately; the seven-day notice uses the server Date header.
const devDeadline=ref(0),devNow=ref(0),devClockKnown=ref(false),devClockError=ref('')
let devAtMonotonic=0,devServerEpoch=0,devSyncBusy=false,devSyncTimer=0
const devRemaining=computed(()=>remainingDevMs(devDeadline.value,devNow.value))
const showDevEntry=computed(()=>!devClockKnown.value||devRemaining.value>0)
const showDevSunset=computed(()=>devClockKnown.value&&devRemaining.value>0)
const devExpired=computed(()=>devClockKnown.value&&devRemaining.value===0)
const devCountdown=computed(()=>formatDevCountdown(devRemaining.value))
function tickDevClock(){
 if(devClockKnown.value)devNow.value=syncedNow(devServerEpoch,devAtMonotonic,performance.now())
}
async function syncDevSunset(){
 if(devSyncBusy)return
 devSyncBusy=true
 try{
  const startedAt=performance.now()
  const response=await fetch(BASE+'myon-dev-sunset.json?nonce='+Math.random().toString(36).slice(2),{cache:'no-store'})
  if(!response.ok)throw Error('개발 서버 종료 공지를 확인할 수 없습니다.')
  const serverHeader=response.headers?.get('date')
  const data=await response.json()
  if(!validDevSunset(data))throw Error('개발 서버 종료 시각을 검증하지 못했습니다.')
  const completedAt=performance.now()
  const serverNow=parseServerDate(serverHeader)+(completedAt-startedAt)/2
  const previous=devClockKnown.value?devNow.value:0
  devServerEpoch=Math.max(serverNow,previous)
  devAtMonotonic=completedAt
  devDeadline.value=data.endsAt
  devClockKnown.value=true
  devClockError.value=''
  tickDevClock()
 }catch(error){
  devClockError.value=error?.message||'서버 표준시 동기화에 실패했습니다.'
  // Do not fall back to the visitor's clock. DEV remains blocked regardless.
 }finally{devSyncBusy=false}
}
function onDevVisibility(){if(!document.hidden)void syncDevSunset()}
const testDeadline=ref(0),testClock=ref(Date.now()),testVerified=ref(false)
const testReceipt=ref(null),testBusy=ref(false),testMessage=ref('')
let testTimer=0
const testRemaining=computed(()=>Math.max(0,testDeadline.value-testClock.value))
const showTestSunset=computed(()=>testVerified.value&&testRemaining.value>0)
const testCountdown=computed(()=>{
 const n=Math.ceil(testRemaining.value/1000),f=x=>String(x).padStart(2,'0')
 return Math.floor(n/86400)+'일 '+f(Math.floor(n%86400/3600))+':'+
  f(Math.floor(n%3600/60))+':'+f(n%60)
})
const testClaimed=computed(()=>!!testReceipt.value)
const testTransferLabel=computed(()=>testBusy.value?'확인 중':
 testReceipt.value?.phase==='complete'?'이전 완료':
 testReceipt.value?.phase==='pending'?'이전 복구':'마지막 1회 접속')
async function loadTestSunset(){
 const response=await fetch(BASE+'myon-test-sunset.json?at='+Date.now(),{cache:'no-store'})
 if(!response.ok)throw Error('가속 서버 종료 시각을 확인할 수 없습니다.')
 const data=await response.json()
 if(!validSunset(data))throw Error('종료 시각 자료가 올바르지 않습니다.')
 testDeadline.value=data.endsAt
 testVerified.value=true
}
async function transferTestFunds(){
 if(testBusy.value||!testVerified.value||(!showTestSunset.value&&!testReceipt.value))return
 testBusy.value=true;testMessage.value=''
 try{
  const receipt=await retireTestOnce({deadline:testDeadline.value})
  testReceipt.value=receipt
  testMessage.value='자금 이전 완료 · 임무 '+receipt.missionCash.toLocaleString('ko-KR')+
   ' M · 공용 '+(receipt.fundsUnits/10000).toLocaleString('ko-KR')+' M'
 }catch(error){
  testMessage.value=error?.message||'이전 오류 · 기존 저장 기록은 보존됩니다.'
  try{testReceipt.value=readTestRetirement()}catch{}
 }finally{testBusy.value=false}
}

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
 const live=targetForServer('live',releases)
 latestRevision.value=current.revision
 latestVersion.value='v'+current.version
 liveVersion.value='v'+live.version
 changes.value=visibleVersionHistory(releases,{live,test:TEST_RELEASE,dev:current})
 return releases
}
async function enterServer(server){
 if(server==='dev'){message.value='개발 서버 접속이 종료되었습니다. 정식 LIVE를 이용해 주세요.';return}
 if(entering.value||playing.value)return
 if(server==='test'&&!TEST_RELEASE){message.value='TEST 승인 버전이 아직 없습니다.';return}
 entering.value=true;message.value=''
 entryServer.value=server;entryIndex.value=0;entryCompleted.value=0
 if(entryProgressFrame)cancelAnimationFrame(entryProgressFrame)
 entryProgressFrame=0;entryVisualPercent.value=0
 entryFailed.value=false;entryVersion.value='—';entryRevision.value='';entrySaveNote.value=''
 try{
  entryStep.value='배포 버전 확인 중'
  // Validate the current deployed manifest even when an older portal stays open.
  const available=server==='live'||server==='dev'?await refreshReleases():releases
  const target=targetForServer(server,available)
  if(!target)throw Error('입장 가능한 승인 버전이 없습니다.')
  entryVersion.value='v'+target.version
  entryRevision.value=target.revision.slice(0,8)
  await showVerifiedStep(0)
  entryIndex.value=1
  entryStep.value='게임 파일 확인 중'
  const url=await verifyArchive({base:BASE,server,revision:target.revision})
  // The LIVE file is the stable, isolated official game at the newest main revision.
  // DEV and TEST pages remain unchanged until server retirement is separately approved.
  const gamePage=server==='live'?'myon-live-ui.html':'myon-next.html'
  const gameUrl=url.replace('/myon.html?','/'+gamePage+'?')
  const nextFile=await fetch(gameUrl,{method:'HEAD',cache:'no-store'})
  if(!nextFile.ok)throw Error('MYON 게임 화면을 확인할 수 없습니다. 기존 세이브는 유지됩니다.')
  await showVerifiedStep(1)
  entryIndex.value=2
  entryStep.value='세이브 읽기 및 백업 검증 중'
  // Only DEV resets on a new version; never reset LIVE's original saves.
  let newDevVersion=false
  if(server==='dev'){
   entryStep.value='개발 버전별 저장 확인 중'
   newDevVersion=(await prepareDevVersion({version:target.version})).reset
  }
  const save=await createEntryCheckpoint({server,revision:target.revision})
  entrySaveNote.value=newDevVersion?'새 버전 · DEV 진행 기록 초기화 완료':save.backup?
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
  frameUrl.value=gameUrl+(server==='dev'?'&dev_version='+encodeURIComponent(target.version):'')
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
 const records=[...await readGameRecords(globalThis.indexedDB,server),...readMissionRecords(globalThis.localStorage,server)]
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
 testTimer=setInterval(()=>{testClock.value=Date.now();tickDevClock()},1000)
 devSyncTimer=setInterval(()=>{void syncDevSunset()},5*60*1000)
 document.addEventListener('visibilitychange',onDevVisibility)
 void syncDevSunset()
 try{testReceipt.value=readTestRetirement()}catch(error){testMessage.value=error.message}
 try{await loadTestSunset()}catch(error){testMessage.value=error.message}
 if(testVerified.value&&testReceipt.value?.phase==='pending')await transferTestFunds()
 // Every visit always returns to the stable portal. Never start the old auto updater.
 window.MYON_ROLLOUT_HOST_ACTIVE=true
 document.title='MYON WORLD · 서버 선택'
 try{await refreshReleases()}
 catch(error){message.value='최신 배포 목록 확인 실패: 입장할 때 다시 검사합니다.';console.warn(error)}
})
onUnmounted(()=>{if(testTimer)clearInterval(testTimer);if(devSyncTimer)clearInterval(devSyncTimer);document.removeEventListener('visibilitychange',onDevVisibility)})
</script>

<template>

 <main v-if="!playing" class="portal">
  <div class="wrap">
   <header class="heading">
    <div class="micro-brand">
     <span class="brand-mark">M</span>
     <div class="brand-name"><strong>MYON</strong><small>WORLD · FIRST ERA</small></div>
    </div>
    <div class="top-side"><span><i class="dot"></i>월드 게이트</span></div>
   </header>
   <section class="hero">
    <div class="hero-kicker">THE WORLD OF MYON</div>
    <h1>MYON</h1><div class="hero-word">WORLD</div>
    <p class="portal-subtitle">시작할 세계를 선택하세요</p>
   </section>
   <section class="gateway" aria-label="서버 선택">
    <div class="servers">
     <button type="button" class="server-row live" :disabled="entering" @click="enterServer('live')">
      <span class="server-main"><span class="server-icon">L</span><span class="server-copy"><strong>LIVE <small>정식 서버</small></strong><span>{{ liveVersion }} · 표준 운행</span></span></span>
      <span class="server-side"><span class="entry-text" aria-hidden="true">›</span></span>
     </button>
     <button v-if="showDevEntry" type="button" class="server-row dev" disabled aria-disabled="true">
      <span class="server-main"><span class="server-icon">D</span><span class="server-copy"><strong>DEV <small>개발 서버</small></strong><span>종료 예정 · 접속 차단</span></span></span>
      <span class="server-side"><span class="dev-entry-locked">접속 불가</span></span>
     </button>
    </div>
    <section v-if="showDevSunset" class="sunset dev-sunset" aria-label="개발 서버 종료 공지">
     <div class="sunset-head"><strong>개발 서버 종료</strong><strong class="sunset-time">{{ devCountdown }}</strong></div>
     <div class="sunset-bottom"><span>DEV 접속 종료 · 남은 기간 후 메뉴에서 제거됩니다</span><span class="dev-closed-tag">접속 차단 중</span></div>
     <p class="dev-timezone">공통 종료 시각 · 대한민국 표준시(KST, UTC+09:00)</p>
     <p class="dev-deadline">종료 예정: <strong>2026.12.02 (수) 06:00 KST</strong></p>
    </section>
    <p v-if="!devClockKnown" class="portal-info" role="status">개발 서버 접속 차단 중 · {{ devClockError||'표준시 확인 중' }}</p>
    <p v-if="devExpired" class="dev-after">개발 서버 종료 완료. 서버 목록에서 DEV가 제거되었으며, 정식 LIVE만 이용할 수 있습니다.</p>
    <section v-if="showTestSunset" class="sunset" aria-label="정식 가속 서버 종료">
     <div class="sunset-head"><strong>가속 서버 종료</strong><strong class="sunset-time">{{ testCountdown }}</strong></div>
     <div class="sunset-bottom">
      <span>{{ testClaimed?'1회 접속 사용 완료 · 재접속 차단':'보유 자금 이전 · 마지막 1회 접속' }}</span>
      <button type="button" :disabled="testBusy||testReceipt?.phase==='complete'" @click="transferTestFunds">{{ testTransferLabel }}</button>
     </div>
    </section>
    <p v-if="testMessage" class="notice" role="status">{{ testMessage }}</p>
    <p v-else-if="!testVerified" class="portal-info">가속 서버 종료 시각 확인 중 · 확인 실패 시 이전 불가</p>
    <p v-else-if="!showTestSunset&&testReceipt?.phase==='pending'" class="notice">종료 후 이전 복구 확인 중</p>
    <p v-if="message&&!entryFailed" class="notice" role="status">{{ message }}</p>
    <footer>© MYON WORLD <span>LIVE · OFFICIAL</span></footer>
   </section>
  </div>
  <div v-if="entering||entryFailed" class="entry-overlay" role="dialog" aria-modal="true" aria-labelledby="world-entry-title">
   <section class="entry-panel">
    <div class="entry-topline">
     <div class="entry-sign"><span class="entry-emblem">M</span><span class="entry-brand"><strong>MYON WORLD</strong><small>WORLD ACCESS PROTOCOL</small></span></div>
     <span class="entry-server-token" :class="'entry-server-'+entryServer"><i class="entry-signal"></i>{{ serverTitle(entryServer) }}</span>
    </div>
    <div class="entry-intro">
     <div class="entry-overline">SECURE CONNECTION / 001</div>
     <h2 id="world-entry-title">{{ entryFailed?'입장 검사가 중단되었습니다':'마이온에 연결하는 중' }}</h2>
     <p class="entry-subtitle">플레이어의 기록을 보호하고 안전하게 세계를 준비하고 있습니다.</p>
    </div>
    <div class="entry-version-pair">
     <span>접속 대상 <strong>{{ serverTitle(entryServer) }} · {{ entryServer==='live'?'정식버전':entryServer==='test'?'정식 가속버전':'개발 세계' }}</strong></span>
     <span>월드 버전 <strong>{{ entryVersion }}</strong></span>
     <span v-if="entryRevision">커밋 <code>{{ entryRevision }}</code></span>
    </div>
    <div class="entry-progress-layout">
     <div class="entry-orbit">
      <div class="entry-progress-circle" role="progressbar" :aria-valuenow="Math.round(entryCompleted/ENTRY_CHECKS.length*100)" aria-valuemin="0" aria-valuemax="100" :aria-label="'입장 검사 '+entryCompleted+' / '+ENTRY_CHECKS.length+'단계 완료'">
       <svg class="entry-ring-svg" viewBox="0 0 160 160" aria-hidden="true">
        <circle class="entry-ring-back" cx="80" cy="80" r="67"></circle>
        <circle class="entry-ring-fill" :class="{error:entryFailed}" cx="80" cy="80" r="67" :stroke-dasharray="ENTRY_RING_CIRCUMFERENCE" :style="{strokeDashoffset:ENTRY_RING_CIRCUMFERENCE*(1-entryCompleted/ENTRY_CHECKS.length)}"></circle>
       </svg>
       <div class="entry-ring-center">
        <strong>{{ entryVisualPercent }}<small>%</small></strong>
        <span>{{ entryFailed?'검사 중단':entryCompleted===ENTRY_CHECKS.length?'검사 완료':'확인 완료' }}</span>
       </div>
      </div>
      <p class="entry-current" aria-live="polite"><i class="entry-current-dot"></i>{{ entryFailed?'검사 중단':entryCompleted===ENTRY_CHECKS.length?'전체 검사 완료':entryStep }}</p>
     </div>
     <ol class="entry-checks">
      <li v-for="(step,i) in ENTRY_CHECKS" :key="step.title" :class="{complete:i<entryCompleted,active:i===entryIndex&&!entryFailed&&i>=entryCompleted,failed:i===entryIndex&&entryFailed}">
       <span class="entry-check-icon">{{ i<entryCompleted?'✓':i===entryIndex&&entryFailed?'!':i===entryIndex?'…':String(i+1).padStart(2,'0') }}</span>
       <span class="entry-check-copy"><strong>{{ step.title }}</strong><small>{{ step.note }}</small></span>
       <span class="entry-check-state">{{ i<entryCompleted?'완료':i===entryIndex&&entryFailed?'실패':i===entryIndex?'확인 중':'대기' }}</span>
      </li>
     </ol>
    </div>
    <div v-if="entrySaveNote" class="entry-save-note">{{ entrySaveNote }}</div>
    <div class="entry-footnote"><span class="entry-shield" aria-hidden="true">◇</span><span>기존 세이브는 초기화하지 않습니다.<small>검증이 완료된 후에만 게임을 실행합니다.</small></span></div>
    <p v-if="entryFailed" class="entry-error" role="alert">{{ message }}</p>
    <button v-if="entryFailed" type="button" class="entry-dismiss" @click="closeEntryResult">시작화면으로 돌아가기</button>
   </section>
  </div>
 </main>
 <section v-else class="live-session">
  <iframe v-if="frameUrl" ref="gameFrame" class="game-frame" :src="frameUrl" :title="'MYON '+serverTitle(currentServer)+' 게임'" @load="onGameLoad"></iframe>
  <div class="game-controls dev-controls"><button type="button" :disabled="leaving" @click="leaveServer">{{ leaving?'저장 확인 중':'← 시작화면' }}</button><span v-if="message" class="game-message" role="status">{{ message }}</span></div>
 </section>
</template>

<style scoped>

.portal{height:100vh;height:100dvh;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;background:#020a15;color:#e8f5ff;position:relative;isolation:isolate}
.portal::-webkit-scrollbar{display:none;width:0;height:0}
.planet-backdrop{position:fixed;inset:0;z-index:0;pointer-events:none;background-size:cover;background-position:center center;background-repeat:no-repeat}
.planet-shade{position:fixed;inset:0;z-index:0;pointer-events:none;background:linear-gradient(90deg,rgba(2,9,23,.98) 0%,rgba(3,13,29,.94) 22%,rgba(4,14,32,.73) 36%,rgba(2,11,27,.31) 61%,rgba(3,10,20,.12) 100%),linear-gradient(0deg,rgba(2,7,15,.68) 0%,transparent 30%,rgba(1,5,17,.27) 100%)}
.wrap{position:relative;z-index:1;max-width:1560px;margin:0 auto;padding:31px clamp(22px,4.4vw,74px) 40px;min-height:100%}
.heading{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:40px}
.micro-brand{display:flex;align-items:center;gap:12px}
.brand-mark{width:31px;height:31px;border:1px solid rgba(176,225,255,.67);border-radius:50%;display:grid;place-items:center;position:relative;box-shadow:0 0 24px rgba(62,176,255,.13);font:700 17px Georgia,serif;color:#d4f6ff}
.brand-mark:before{content:'';position:absolute;inset:10px -6px;border-top:1px solid rgba(117,218,255,.8);transform:rotate(-29deg)}
.brand-name strong{font-size:13px;letter-spacing:.27em;font-weight:750}
.brand-name small{display:block;font-size:8px;color:#8db8d1;letter-spacing:.33em;margin-top:3px}
.top-side{display:flex;align-items:center;gap:17px;font-size:10px;letter-spacing:.14em;color:#c4dcf3}
.top-side .sep{width:1px;height:16px;background:#7294ad60}
.dot{display:inline-block;width:6px;height:6px;margin-right:8px;border-radius:50%;background:#74dacc;box-shadow:0 0 10px #6adfd1}
.hero{width:min(100%,550px);padding-top:clamp(56px,8.6vh,100px)}
.hero-kicker{font-size:11px;font-weight:650;letter-spacing:.31em;color:#a6d5ee;display:flex;align-items:center;gap:10px}
.hero-kicker:before{content:'';width:26px;height:1px;background:#a4ddff}
.hero h1{margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:clamp(78px,9.2vw,137px);font-weight:400;line-height:.96;letter-spacing:.055em;background:linear-gradient(115deg,#fff 14%,#bddffa 56%,#81b7e8 95%);background-clip:text;-webkit-background-clip:text;color:transparent;text-shadow:0 5px 35px rgba(105,177,233,.12)}
.hero-word{margin-left:7px;font-size:12px;color:#bed5e7;letter-spacing:.72em;margin-top:15px;font-weight:650}
.hero-subtitle{font-size:clamp(19px,2.4vw,26px);font-weight:650;line-height:1.53;letter-spacing:-.035em;margin:29px 0 10px;text-shadow:0 2px 18px #010915}
.hero-desc{font-size:13px;line-height:1.8;color:#b1c6d6;margin:0;max-width:440px;text-shadow:0 2px 10px #030c19}
.gateway{max-width:550px;margin-top:34px}
.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:13px}
.section-overline{font-size:9px;font-weight:800;letter-spacing:.25em;color:#82cbea}
.section-head h2{margin:5px 0 0;font-size:16px;font-weight:650;letter-spacing:-.02em}
.section-note{font-size:10px;color:#88a3ba;text-align:right}
.servers{display:grid;gap:9px}
.server-row{width:100%;min-height:75px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:11px;border:1px solid rgba(186,215,255,.19);background:rgba(7,21,38,.61);box-shadow:0 6px 28px rgba(0,0,0,.16);backdrop-filter:blur(13px);-webkit-backdrop-filter:blur(13px);color:#eff8ff;text-align:left;padding:11px 15px;font:inherit}
button.server-row{cursor:pointer;transition:background .18s,border-color .18s,transform .18s}
button.server-row:hover:not(:disabled){border-color:#bbdeffb0;background:rgba(26,57,88,.77);transform:translateX(3px)}
button.server-row:focus-visible,.backup-actions button:focus-visible,.backup-actions a:focus-visible{outline:2px solid #a4ddff;outline-offset:3px}
button.server-row:disabled{cursor:not-allowed;opacity:.7}
.server-row.live{border-color:rgba(104,220,199,.6);background:linear-gradient(90deg,rgba(12,67,67,.68),rgba(11,33,51,.67))}
.server-row.dev{border-color:rgba(107,159,232,.48);background:linear-gradient(90deg,rgba(22,43,75,.74),rgba(10,26,45,.65))}
.server-row.unavailable{opacity:.68}
.server-row.dev:disabled{opacity:.66;background:linear-gradient(90deg,#15283bd8,#0c1929c7);border-color:#536c8470}
.dev-entry-locked{border:1px solid #69839c70;border-radius:5px;padding:5px 7px;font-size:10px;font-weight:600;color:#c2d1de}
.portal .sunset.dev-sunset{background:linear-gradient(125deg,#122e43d6,#0a1c2ec9);border-color:#56779198}
.portal .dev-sunset .sunset-head strong{font-size:13px;color:#d9f2ff}
.portal .dev-sunset .sunset-head .sunset-time{font-size:18px;color:#d9f2ff;white-space:nowrap}
.portal .dev-sunset .sunset-bottom{border-top:1px solid #88afc029;padding-top:11px;flex-wrap:wrap}
.portal .dev-sunset .sunset-bottom span{color:#9cbbcf}
.portal .dev-sunset .sunset-bottom .dev-closed-tag{font-size:10px;color:#c9d8e4;border:1px solid #5f7d92;border-radius:6px;padding:7px 9px;background:#142f44}
.dev-timezone{margin:12px 0 0;font-size:10px;color:#9dc4d5;line-height:1.7}
.dev-deadline{margin:5px 0 0;font-size:10px;color:#9ab2c4;line-height:1.6}
.dev-after{padding:15px;border-radius:9px;border:1px solid #36546a;color:#a8c3d3;font-size:11px;line-height:1.65;background:#12233380;margin-top:13px}
.server-main{display:flex;align-items:center;min-width:0;gap:13px}
.server-icon{width:39px;height:39px;border-radius:9px;border:1px solid rgba(146,209,238,.28);display:grid;place-items:center;flex:none;background:rgba(80,132,169,.13);color:#c6e6f9;font-size:19px;font-weight:700;font-family:Georgia,serif}
.server-row.live .server-icon{color:#aaf2de;border-color:#74d1b670;background:#0b55516b}
.server-copy{display:flex;flex-direction:column;min-width:0;gap:3px}
.server-copy strong{font-weight:700;letter-spacing:.05em;font-size:15px}
.server-copy small{font-size:10px;letter-spacing:0;font-weight:450;color:#b8ccdc;margin-left:7px}
.server-copy>span{font-size:10px;color:#a4b6c6;line-height:1.4}
.server-side{display:flex;align-items:center;gap:13px;white-space:nowrap;flex:none}
.server-ver{font-size:11px;color:#a9bdce;letter-spacing:.02em;font-weight:600;font-variant-numeric:tabular-nums}
.entry-text{font-size:20px;color:#9bdeea;line-height:1}
.locked{font-size:11px;color:#c3cbd3}
.version-history{margin-top:10px;background:rgba(5,15,28,.42);border:1px solid rgba(146,205,241,.18);border-radius:11px;backdrop-filter:blur(10px);overflow:hidden}
.version-history-summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;gap:12px}
.version-history-summary::-webkit-details-marker{display:none}
.version-history-summary:focus-visible{outline:2px solid #8cccee;outline-offset:-3px}
.version-history-heading{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
.version-history-heading strong{font-size:12px;font-weight:700}
.version-history-heading small{font-size:10px;color:#a3b6c5}
.version-history-expand{color:#9bc9e6;font-size:11px;white-space:nowrap}
.version-history-expand span{display:inline-block;transition:transform .2s}
.version-history[open] .version-history-expand span{transform:rotate(180deg)}
.version-history-body{border-top:1px solid #b3d8ed2b;padding:2px 16px 14px}
.version-history-item{padding:13px 1px}
.version-history-item+.version-history-item{border-top:1px solid #b3d8ed1c}
.version-history-line{display:flex;align-items:center;flex-wrap:wrap;gap:7px}
.version-history-line>strong{font-size:13px;color:#d8f3ff}
.version-history-badge{border:1px solid #6489a5;background:#1b3a4c;color:#c4e2f7;border-radius:6px;padding:3px 7px;font-size:10px;font-weight:700}
.version-history-badge.tag-live{border-color:#55b4a6;color:#b8f1e6}
.version-history-badge.tag-dev{border-color:#618eb6;color:#c0dcf5;background:#283e50}
.version-history-badge.tag-test{border-color:#b89862;color:#f7deab;background:#51432c}
.version-history-boundary{font-size:10px;color:#9caeba}
.version-history-title{font-size:12px;color:#deeff9;margin-top:8px}
.version-history-notes{padding-left:18px;margin:7px 0 0;color:#9fb9c9;font-size:11px;line-height:1.7}
.version-history-empty,.version-history-footnote{font-size:11px;color:#9eb7c8;line-height:1.65}
.version-history-footnote{border-top:1px solid #b3d8ed1c;margin:0;padding-top:13px}
.details{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
.panel{min-width:0;border:1px solid rgba(183,219,238,.18);border-radius:10px;padding:15px;background:rgba(4,15,28,.58);backdrop-filter:blur(10px)}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
.panel-head h2{font-size:12px;margin:0}
.tag{font-size:10px;color:#9dcfe8;border:1px solid #6b94a77d;padding:4px 7px;border-radius:20px;white-space:nowrap}
.kv{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:9px 0;font-size:11px;color:#adc1ce}
.kv strong{color:#e2f5ff;font-size:12px}
.hint{font-size:10px;line-height:1.65;color:#adc1ce;margin:9px 0 0}
.backup-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.backup-actions button,.backup-actions a{color:#cdeafa;background:#183e56b7;border:1px solid #6b94a77d;font:inherit;font-size:10px;padding:8px;border-radius:6px;cursor:pointer;text-decoration:none}
.backup-actions button:disabled{opacity:.55;cursor:not-allowed}
.notice{margin-top:14px;padding:13px 15px;border-radius:10px;border:1px solid #729cb37a;background:#142b3df0;color:#d9f0ff;font-size:12px;line-height:1.5}
.manual-area{margin-top:14px}.manual-area label{display:block;font-size:12px;margin-bottom:8px}
.manual-area textarea{width:100%;resize:vertical;border:1px solid #4d7b99;border-radius:10px;background:#071727;color:#e3f5ff;padding:12px}
footer{margin-top:20px;display:flex;justify-content:space-between;gap:12px;font-size:10px;color:#90adbd;letter-spacing:.04em}
.planet-marker{position:fixed;right:clamp(24px,4.5vw,70px);bottom:48px;display:flex;align-items:center;gap:11px;color:rgba(236,246,255,.85);text-shadow:0 2px 15px #000;pointer-events:none}
.marker-line{width:44px;height:1px;background:#ffffff75}
.planet-marker strong{display:block;font-size:11px;letter-spacing:.26em}
.planet-marker small{display:block;color:#c5d6e2;font-size:10px;letter-spacing:.08em;margin-top:5px}
@media(max-width:700px){
 .planet-backdrop{background-position:61% top;background-size:auto 100vh;background-size:auto 100dvh}
 .planet-shade{background:linear-gradient(180deg,rgba(2,10,25,.78) 0%,rgba(3,11,24,.60) 17%,rgba(2,11,24,.83) 37%,rgba(2,10,22,.98) 68%,rgba(2,9,20,.99) 100%),linear-gradient(90deg,rgba(2,10,24,.47),transparent 95%)}
 .wrap{padding:21px 17px 32px;min-height:100%}
 .top-side{font-size:9px}.top-side .sep,.top-side>span:first-child{display:none}
 .hero{padding-top:71px}
 .hero h1{font-size:74px;letter-spacing:.045em}
 .hero-word{font-size:10px;letter-spacing:.66em;margin-top:10px}
 .hero-subtitle{font-size:19px;margin:22px 0 8px;line-height:1.5}
 .hero-desc{font-size:12px;line-height:1.65}
 .gateway{margin-top:29px}
 .section-note{font-size:9px;max-width:120px}
 .server-row{min-height:74px;padding:11px 12px}
 .server-main{gap:10px}
 .server-copy strong{font-size:14px}.server-copy small{font-size:9px;margin-left:5px}
 .server-copy>span{font-size:9px}
 .server-side{gap:9px}.server-ver{font-size:10px}.entry-text{font-size:17px}
 .version-history-heading small{display:none}
 .details{grid-template-columns:1fr}
 footer{font-size:9px;line-height:1.6}
 .planet-marker{position:relative;right:auto;bottom:auto;margin:25px 0 0;opacity:.7}
}
@media(max-width:385px){.hero h1{font-size:66px}.hero{padding-top:56px}.hero-subtitle{font-size:18px}.server-icon{width:35px;height:35px}.server-ver{font-size:9px}}
@media(prefers-reduced-motion:reduce){button.server-row{transition:none}.version-history-expand span{transition:none}}


.entry-overlay{position:fixed;z-index:50;inset:0;display:grid;place-items:center;padding:18px 12px;overflow-y:auto;background:rgba(1,6,17,.76);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#e9f6ff}
.entry-panel{width:100%;max-width:690px;box-sizing:border-box;position:relative;border:1px solid rgba(137,195,229,.36);border-radius:18px;padding:26px 28px 22px;background:linear-gradient(137deg,rgba(12,33,56,.97),rgba(5,15,31,.98));box-shadow:0 28px 85px rgba(0,0,0,.6),inset 0 1px rgba(255,255,255,.07);overflow:hidden}
.entry-panel:before{content:'';position:absolute;top:0;left:28px;right:28px;height:1px;background:linear-gradient(90deg,transparent,rgba(158,231,255,.7),transparent)}
.entry-topline{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-bottom:18px;border-bottom:1px solid rgba(159,199,224,.17)}
.entry-sign{display:flex;align-items:center;gap:12px}
.entry-emblem{width:34px;height:34px;border:1px solid rgba(174,222,251,.6);border-radius:50%;display:grid;place-items:center;flex:none;color:#d4f2ff;font:19px Georgia,serif}
.entry-brand{display:grid;gap:4px}
.entry-brand strong{font-size:12px;letter-spacing:.19em}
.entry-brand small{font-size:9px;letter-spacing:.13em;color:#88a9c2}
.entry-server-token{display:flex;align-items:center;gap:6px;border-radius:6px;border:1px solid #558d9f;padding:6px 10px;font-size:10px;letter-spacing:.1em;font-weight:800;background:#173b4b;color:#ade3f3}
.entry-server-live{border-color:#458f88;background:#123e41;color:#a7e8da}
.entry-server-dev{border-color:#4b7eae;background:#16334d;color:#bddaff}
.entry-signal{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 9px currentColor}
.entry-intro{text-align:center;padding:23px 8px 19px}
.entry-overline{color:#83c4e3;font-size:10px;letter-spacing:.2em;font-weight:750}
.entry-panel h2{margin:10px 0 8px;font-size:25px;font-weight:670;letter-spacing:-.04em;line-height:1.3}
.entry-subtitle{font-size:12px;line-height:1.6;color:#abc0d1;margin:0}
.entry-version-pair{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:9px 12px;padding:12px 14px;background:rgba(7,23,43,.77);border:1px solid rgba(140,190,229,.2);border-radius:8px;font-size:11px;color:#8eaac3}
.entry-version-pair strong,.entry-version-pair code{margin-left:5px;color:#e1f3ff;font-size:11px;font-weight:700}
.entry-progress-layout{display:grid;grid-template-columns:minmax(0,205px) minmax(0,1fr);align-items:center;gap:17px;padding:23px 0 18px}
.entry-orbit{display:grid;justify-items:center;align-items:center;gap:12px;min-width:0}
.entry-progress-circle{position:relative;width:182px;height:182px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(92,160,199,.2);background:radial-gradient(circle,rgba(39,99,140,.22),rgba(6,22,41,.07) 68%);box-shadow:0 0 40px rgba(26,146,215,.1)}
.entry-progress-circle:before{content:'';position:absolute;inset:9px;border:1px dashed rgba(101,164,205,.26);border-radius:50%}
.entry-ring-svg{width:172px;height:172px;transform:rotate(-90deg);overflow:visible}
.entry-ring-back,.entry-ring-fill{fill:none;stroke-width:4;stroke-linecap:round}
.entry-ring-back{stroke:rgba(149,198,234,.14)}
.entry-ring-fill{stroke:#79dafa;transition:stroke-dashoffset 620ms cubic-bezier(.16,1,.3,1),stroke .25s;filter:drop-shadow(0 0 5px rgba(99,210,255,.48))}
.entry-ring-fill.error{stroke:#ff9e9a;filter:drop-shadow(0 0 5px rgba(255,130,120,.35))}
.entry-ring-center{position:absolute;display:grid;justify-items:center;gap:3px}
.entry-ring-center strong{font-weight:350;letter-spacing:-.045em;font-size:43px;font-variant-numeric:tabular-nums;line-height:1}
.entry-ring-center strong small{font-size:17px;color:#83bbd6;margin-left:2px}
.entry-ring-center>span{font-size:10px;color:#83a9c1;letter-spacing:.08em}
.entry-current{display:flex;align-items:center;justify-content:center;gap:7px;margin:0;color:#aed9eb;font-size:11px;text-align:center;line-height:1.45}
.entry-current-dot{width:6px;height:6px;border-radius:50%;background:#68d1f1;box-shadow:0 0 8px rgba(106,210,241,.6);flex:none;animation:entryPulse 1.8s ease-in-out infinite}
@keyframes entryPulse{50%{opacity:.34}}
.entry-checks{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.entry-checks li{display:flex;align-items:center;gap:11px;min-width:0;padding:11px 10px;border-radius:9px;border:1px solid transparent;color:#839cad}
.entry-checks li.complete{color:#d6edfa}
.entry-checks li.active{background:rgba(41,88,123,.36);border-color:rgba(90,157,197,.54);color:#effaff}
.entry-checks li.failed{background:rgba(94,33,46,.31);border-color:rgba(218,112,118,.53);color:#ffe6e1}
.entry-check-icon{width:30px;height:30px;border-radius:50%;flex:none;display:grid;place-items:center;border:1px solid #536e83;color:#9fb8cc;font-size:10px}
.entry-checks li.complete .entry-check-icon{background:#16526a;border-color:#2d8492;color:#baf8fa;font-size:15px}
.entry-checks li.active .entry-check-icon{background:#235778;border-color:#6dbce5;color:#def8ff}
.entry-checks li.failed .entry-check-icon{background:#713741;border-color:#cc7777;color:#ffe1da}
.entry-check-copy{min-width:0;flex:1;display:grid;gap:4px}
.entry-check-copy strong{font-size:12px;font-weight:700}
.entry-check-copy small{font-size:10px;color:#8ba4b6;line-height:1.4}
.entry-checks li.active .entry-check-copy small{color:#b5cadd}
.entry-check-state{font-size:10px;white-space:nowrap;color:#87a0b6}
.entry-checks li.complete .entry-check-state{color:#74d0cc}
.entry-checks li.active .entry-check-state{color:#9bd9ff}
.entry-checks li.failed .entry-check-state{color:#ffc2b9}
.entry-save-note{font-size:11px;color:#a9e6dc;margin:0 0 11px;text-align:center}
.entry-footnote{display:flex;align-items:center;gap:12px;background:rgba(16,58,77,.57);border:1px solid rgba(74,144,163,.35);padding:12px 15px;border-radius:8px;color:#c9e9f3;font-size:11px;line-height:1.5}
.entry-shield{color:#88dfeb;font-size:25px}
.entry-footnote span:last-child{display:grid;gap:2px}
.entry-footnote small{display:block;color:#8cb0c1;font-size:10px}
.entry-error{font-size:12px;line-height:1.6;color:#ffd9d3;padding:10px 12px;background:rgba(96,35,43,.35);border:1px solid rgba(215,101,109,.44);border-radius:8px;margin:13px 0 0}
.entry-dismiss{border:1px solid #7bbbe0;background:#1a5270;color:#fff;border-radius:9px;padding:11px 15px;margin-top:12px;font:inherit;font-size:12px;cursor:pointer}
.entry-dismiss:focus-visible{outline:2px solid #b3e6ff;outline-offset:3px}
@media(max-width:580px){
 .entry-overlay{padding:12px 8px;align-items:safe center}
 .entry-panel{padding:18px 14px 15px;border-radius:15px}
 .entry-topline{padding-bottom:13px}
 .entry-intro{padding:18px 2px 13px}
 .entry-panel h2{font-size:20px}
 .entry-subtitle{font-size:11px}
 .entry-version-pair{padding:10px;font-size:10px}
 .entry-progress-layout{grid-template-columns:1fr;gap:13px;padding:15px 0}
 .entry-progress-circle{width:138px;height:138px}
 .entry-ring-svg{width:132px;height:132px}
 .entry-ring-center strong{font-size:34px}
 .entry-ring-center strong small{font-size:14px}
 .entry-orbit{gap:8px}
 .entry-checks li{padding:8px 9px}
 .entry-check-copy small{font-size:10px}
}
@media(prefers-reduced-motion:reduce){.entry-ring-fill{transition:none}.entry-current-dot{animation:none}}
.live-session{position:relative;width:100%;height:100vh;height:100dvh;background:#0e171b}
.game-frame{display:block;width:100%;height:100%;border:0;background:#0e171b}
.game-controls{position:absolute;z-index:10;bottom:13px;left:12px;display:flex;gap:8px;align-items:center;max-width:calc(100% - 24px)}
.game-controls button{background:#213c35eF;color:#dbf9e8;border:1px solid #64a68a;border-radius:100px;padding:9px 13px;font-size:11px;cursor:pointer;box-shadow:0 4px 16px #0008}

/* The citizen-world DEV keeps the portal-owned verified exit at the top, above the iframe. */
.game-controls.dev-controls{bottom:auto;top:83px;left:clamp(14px,3.6vw,38px)}
.game-controls.dev-controls button{background:#10283bdc;color:#c3e1f0;border-color:#456c83;border-radius:8px;padding:8px 11px;box-shadow:none}
@media(max-width:740px){.game-controls.dev-controls{top:72px;left:13px}.game-controls.dev-controls button{font-size:11px;padding:7px 10px}}
@media(max-height:520px){.game-controls.dev-controls{top:61px}.game-controls.dev-controls button{padding:4px 9px}}

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

/* Compact two-world portal: image-free, button-forward, faithful to existing MYON identity. */
.portal{background:radial-gradient(ellipse 70% 55% at 50% 0%,rgba(34,73,120,.28),transparent 77%),linear-gradient(180deg,#091523,#050a12);color:#e8f5ff}
.portal .wrap{max-width:1000px;padding:25px clamp(17px,5vw,40px) 35px}
.portal .top-side>span:first-child{display:block}
.portal .hero{text-align:center;width:100%;padding-top:clamp(48px,7vh,83px)}
.portal .hero-kicker{justify-content:center;font-size:10px;letter-spacing:.32em;color:#84b1cb}
.portal .hero-kicker:before{display:none}
.portal .hero h1{font-size:clamp(75px,12vw,107px);margin-top:12px;letter-spacing:.07em}
.portal .hero-word{margin:9px 0 0;padding-left:.65em;font-size:11px}
.portal-subtitle{color:#bbcee0;font-size:13px;margin:28px 0 0}
.portal .gateway{max-width:580px;margin:29px auto 0}
.portal .servers{gap:12px}
.portal .server-row{min-height:94px;border-radius:13px;padding:18px 18px 18px 15px;position:relative;overflow:hidden;box-shadow:inset 0 1px #ffffff0b,0 7px 28px #0004}
.portal .server-row:before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:4px;background:#48e0ca;box-shadow:0 0 16px #48e0ca}
.portal .server-row.live{border-color:#48e0ca84;background:linear-gradient(115deg,#11575d59,#0d1c2b 75%)}
.portal .server-row.dev{border-color:#5daeff86;background:linear-gradient(115deg,#1e3d7961,#0d1c2b 75%)}
.portal .server-row.dev:before{background:#5daeff;box-shadow:0 0 16px #5daeff}
.portal button.server-row:hover:not(:disabled){transform:translateY(-2px)}
.portal .server-icon{width:51px;height:51px;border-radius:10px;font-size:29px;border-color:#48e0ca;background:linear-gradient(150deg,#48e0ca2c,#04111de0);box-shadow:inset 0 0 16px #48e0ca25,0 0 16px #48e0ca25}
.portal .server-row.dev .server-icon{border-color:#5daeff;background:linear-gradient(150deg,#5daeff32,#04111de0);box-shadow:inset 0 0 16px #5daeff20,0 0 16px #5daeff20}
.portal .server-main{gap:16px}
.portal .server-copy strong{font-size:23px;letter-spacing:.02em}
.portal .server-copy small{font-size:11px;margin-left:9px}
.portal .server-copy>span{font-size:11px;margin-top:2px}
.portal .entry-text{width:37px;height:37px;display:grid;place-items:center;border-radius:50%;border:1px solid #48e0ca61;background:#48e0ca17;font-size:30px;color:#48e0ca}
.portal .server-row.dev .entry-text{color:#5daeff;border-color:#5daeff61;background:#5daeff17}
.portal .sunset{margin-top:17px;padding:15px 17px;background:linear-gradient(115deg,#3e301d9e,#19191c8c);border:1px solid #b5945b78;border-radius:12px}
.portal .sunset-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.portal .sunset-head strong{font-size:12px;color:#f2d6aa}
.portal .sunset-head .sunset-time{font-size:14px;font-variant-numeric:tabular-nums;color:#ffe2a2}
.portal .sunset-bottom{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}
.portal .sunset-bottom span{font-size:11px;line-height:1.5;color:#c4b7a7}
.portal .sunset-bottom button{font-size:11px;font-weight:750;color:#ffefd0;background:linear-gradient(180deg,#99784a,#594021);border:1px solid #e5c48a;border-radius:8px;padding:10px 14px;white-space:nowrap}
.portal .sunset-bottom button:disabled{opacity:.57;cursor:not-allowed}
.portal-info{font-size:10px;color:#a8b8c7;margin:13px 0}
.portal footer{max-width:580px;margin:22px auto 0}
.portal .notice{margin-top:12px}
@media(max-width:700px){
 .portal .wrap{padding:21px 14px 31px}
 .portal .hero{padding-top:62px}
 .portal .hero h1{font-size:74px}
 .portal .gateway{margin-top:30px}
 .portal .server-row{min-height:84px;padding:13px 12px}
 .portal .server-main{gap:11px}
 .portal .server-icon{width:45px;height:45px;font-size:25px;border-radius:10px}
 .portal .server-copy strong{font-size:20px}
 .portal .server-copy small{font-size:10px}
 .portal .entry-text{width:32px;height:32px;font-size:25px}
 .portal .sunset{padding:14px 12px}
 .portal .sunset-time{font-size:12px}
}

</style>
