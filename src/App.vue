<script setup>
import {computed,onMounted,onBeforeUnmount,ref} from 'vue'
import {GAME_VERSION,MAX_ACTIVE_MISSIONS,createInitialGame,isValidGame,normalizeImport,
 startGame,establishCompany,acceptMission,advanceWorld,renameCompany} from './gameEngine.js'
import {loadFromIndexedDB,saveToIndexedDB,loadFallback,saveFallback,makePlainSnapshot,
 downloadSaveJson,parseSaveJson} from './storage.js'
import {CHANGELOG} from './changelog.js'

const game=ref(createInitialGame())
const ready=ref(false),blocked=ref(false),now=ref(Date.now()),saved=ref('준비 중')
const path=ref(['home']),message=ref(''),backupInput=ref(null),companyName=ref(''),cityName=ref('')
const offlineMessage=ref('')
const company=computed(()=>game.value.company)
const balance=computed(()=>game.value.economy.balance)
const screen=computed(()=>path.value.at(-1))
const money=n=>`${(n||0).toLocaleString('ko-KR')} M`
const clock=t=>{const d=new Date(t),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`}
const duration=seconds=>{
 const s=Math.max(0,Math.ceil(seconds)),d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60)
 if(d)return `${d}일 ${h}시간 ${m}분`
 if(h)return `${h}시간 ${m}분`
 return `${m}분 ${String(s%60).padStart(2,'0')}초`
}
const remaining=stamp=>duration((stamp-now.value)/1000)
const progress=m=>Math.min(100,Math.max(0,(now.value-m.startedAt)/(m.endsAt-m.startedAt)*100))
const acceptLabel=m=>game.value.missions.active.length>=MAX_ACTIVE_MISSIONS?'수락 한도':balance.value<m.companyCost?'자금 부족':'수락'
const screenLabels={home:'처음',company:'회사 현황',guide:'게임 안내',changelog:'변경 기록',data:'저장 관리',rename:'회사 이름'}
let interval=null,saveQueue=Promise.resolve(),lastToast=0
function toast(text){message.value=text;lastToast=Date.now()}
function open(key){if(!company.value&&!['company','guide','changelog','data'].includes(key)){
 path.value=['home','company'];toast('회사 이름을 먼저 정해 주세요.');return}
 path.value.push(key)
}
function back(){if(path.value.length>1)path.value.pop()}
function home(){path.value=['home']}
function commit(next){
 if(blocked.value||!isValidGame(next)){toast('저장 데이터 검증에 실패했습니다.');return false}
 const snapshot=makePlainSnapshot(next);game.value=snapshot
 try{saveFallback(snapshot)}catch(err){console.warn('Fallback save:',err)}
 saved.value='저장 중'
 saveQueue=saveQueue.catch(()=>{}).then(()=>saveToIndexedDB(snapshot)).then(()=>{saved.value='자동 저장됨'}).catch(err=>{
  console.error(err);saved.value='저장 오류 · JSON 백업 권장'
 })
 return true
}
function catchUp(silent=false){
 if(!ready.value||blocked.value)return
 now.value=Date.now()
 const result=advanceWorld(game.value,now.value)
 if(result.changed){
  commit(result.game)
  if(result.completed.length){
   const text=`임무 ${result.completed.length}건 완료 · 회사 수익 +${money(result.earned)}`
   if(!silent)toast(text);else offlineMessage.value=text
  }
 }
}
function act(fn){
 catchUp(false)
 try{const next=fn(game.value,Date.now());return commit(next)}catch(err){toast(err.message);return false}
}
function makeCity(){
 if(act((g,at)=>startGame(g,cityName.value,at)))path.value=['home','company']
}
function createCompany(){
 if(act((g,at)=>establishCompany(g,companyName.value,at)))companyName.value=game.value.company.name
}
function takeMission(id){if(act((g,at)=>acceptMission(g,id,at)))toast('임무를 수락했습니다.')}
function changeName(){if(act((g,at)=>renameCompany(g,companyName.value,at)))toast('회사 이름을 변경했습니다.')}
function exportJson(){catchUp(true);try{downloadSaveJson(game.value);toast('save.json을 저장했습니다.')}catch(err){toast(err.message)}}
async function importJson(e){
 const file=e.target.files?.[0]
 if(!file)return
 try{
  const incoming=parseSaveJson(await file.text(),Date.now())
  if(!window.confirm('현재 게임 진행을 save.json 데이터로 교체할까요?'))return
  const restored=advanceWorld(incoming,Date.now()).game
  if(commit(restored)){
   companyName.value=restored.company?.name||'';cityName.value=restored.city.name
   offlineMessage.value='';home();toast('save.json을 불러왔습니다.')
  }
 }catch(err){toast(`불러오기 실패: ${err.message}`)}finally{e.target.value=''}
}
async function hydrate(){
 let raw=null
 try{raw=await loadFromIndexedDB()}catch(err){console.warn('IndexedDB:',err)}
 let fromDb=null
 try{if(raw)fromDb=normalizeImport(raw,Date.now())}catch(err){console.warn('Save migration:',err)}
 const backup=loadFallback()
 if(raw&&!fromDb&&!backup){
  blocked.value=true;ready.value=true;saved.value='손상된 저장 데이터 · 덮어쓰기 방지'
  toast('기존 저장 데이터가 손상되어 자동 저장을 중단했습니다.');return
 }
 // If both exist, prefer the one last updated by the user (not the migration time).
 const rawTime=raw?.updatedAt||0
 const backupTime=backup?.updatedAt||0
 const source=fromDb&&backup?(rawTime>=backupTime?fromDb:backup):fromDb||backup
 const restored=source||createInitialGame()
 const result=advanceWorld(restored,Date.now())
 game.value=result.game
 companyName.value=result.game.company?.name||''
 cityName.value=result.game.city.name
 if(source&&result.completed.length)offlineMessage.value=`접속하지 않은 동안 임무 ${result.completed.length}건 완료 · +${money(result.earned)}`
 ready.value=true;now.value=Date.now();commit(result.game)
}
function tick(){
 if(!ready.value)return
 catchUp(false)
 if(message.value&&Date.now()-lastToast>4500)message.value=''
}
onMounted(()=>{
 hydrate().catch(err=>{console.error(err);blocked.value=true;ready.value=true;saved.value='불러오기 오류 · 덮어쓰기 방지'})
 interval=setInterval(tick,1000)
 window.addEventListener('focus',tick)
 document.addEventListener('visibilitychange',tick)
})
onBeforeUnmount(()=>{
 if(interval)clearInterval(interval)
 window.removeEventListener('focus',tick)
 document.removeEventListener('visibilitychange',tick)
})
</script>

<template>
<div class="shell">
 <header class="appbar">
  <div class="brand-line"><span class="brand-symbol">M<span class="brand-dot">·</span></span><strong>MYON</strong></div>
  <div class="header-metrics" v-if="ready&&!blocked">
   <time class="time-value" :datetime="new Date(now).toISOString()">{{clock(now)}}</time>
   <strong class="money-value">{{money(balance)}}</strong>
  </div>
 </header>
 <div class="mainwrap">
  <main v-if="!ready" class="stage"><div class="loading">저장된 MYON 세계를 불러오는 중입니다.</div></main>
  <main v-else-if="blocked" class="stage"><h1>저장 보호 모드</h1><p>저장 데이터에 오류가 있어 기존 정보를 보호하기 위해 쓰기를 중단했습니다.</p></main>
  <main v-else-if="game.phase==='intro'" class="stage">
   <div class="intro-art"><div class="city-graphic">▥ ▤ ▥ ▦ ▤</div><h1>도시 생성</h1></div>
   <form class="start-form" @submit.prevent="makeCity">
    <input id="city-name" v-model="cityName" maxlength="40" autocomplete="off" aria-label="도시 이름" placeholder="도시 이름 입력"/>
    <button class="primary jumbo" type="submit" :disabled="!cityName.trim()">게임 시작 <span>→</span></button>
   </form>
  </main>
  <main v-else class="stage">
   <nav v-if="screen!=='home'" class="crumbs" aria-label="현재 메뉴"><span>{{screenLabels[screen]||screen}}</span></nav>
   <div v-if="offlineMessage" class="quiet-message" @click="offlineMessage=''">{{offlineMessage}} <span>×</span></div>
   <template v-if="screen==='home'">
    <div class="page-intro"><h1>무엇을 하시겠습니까?</h1></div>
    <div class="menu-list">
     <button class="menu-row" @click="open('company')"><span class="menu-glyph">▦</span><span class="menu-text"><strong>회사 현황</strong></span><span class="arrow">›</span></button>
     <button class="menu-row" @click="open('guide')"><span class="menu-glyph">✳</span><span class="menu-text"><strong>게임 안내</strong></span><span class="arrow">›</span></button>
     <button class="menu-row" @click="open('data')"><span class="menu-glyph">▣</span><span class="menu-text"><strong>저장 관리</strong></span><span class="arrow">›</span></button>
    </div>
   </template>
   <template v-else-if="screen==='company'">
    <div class="page-intro"><h1>회사 현황<span v-if="company"> - {{company.name}}</span></h1></div>
    <div v-if="!company" class="content-card">
     <form class="company-create-form" @submit.prevent="createCompany">
      <input id="company-start-name" v-model="companyName" maxlength="40" autocomplete="off" aria-label="회사 이름" placeholder="회사 이름 입력"/>
      <button class="primary jumbo" type="submit" :disabled="!companyName.trim()">회사 운영 시작 <span>→</span></button>
     </form>
    </div>
    <template v-else>
     <section class="company-section">
      <div class="section-heading"><h2>진행 중인 임무</h2><span>{{game.missions.active.length}} / {{MAX_ACTIVE_MISSIONS}}</span></div>
      <div v-if="!game.missions.active.length" class="compact-empty">진행 중인 임무가 없습니다.</div>
      <div v-for="m in game.missions.active" :key="m.id" class="mission-card">
       <strong class="mission-title">{{m.title}}</strong>
       <div class="mission-line"><span>완료 시 회사 순수익</span><strong class="income-text">+{{money(m.companyProfit)}}</strong></div>
       <div class="mission-line"><span>남은 시간</span><strong>{{remaining(m.endsAt)}}</strong></div>
       <div class="progress large"><span :style="{width:progress(m)+'%'}"></span></div>
      </div>
     </section>
     <section class="company-section">
      <div class="section-heading"><h2>도시 임무</h2><span>수락 가능 {{game.missions.offers.length}}개</span></div>
      <div class="mission-list">
       <div v-for="m in game.missions.offers" :key="m.id" class="mission-card">
        <strong class="mission-title">{{m.title}}</strong>
        <div class="mission-line"><span>시 분담금</span><strong>{{money(m.cityShare)}}</strong></div>
        <div class="mission-line"><span>회사 수락 비용</span><strong>{{money(m.companyCost)}}</strong></div>
        <div class="mission-line"><span>완료 시 회사 순수익</span><strong class="income-text">+{{money(m.companyProfit)}}</strong></div>
        <div class="mission-bottom"><span>수락 기한 {{remaining(m.expiresAt)}}</span>
         <button class="primary mission-accept" :disabled="game.missions.active.length>=MAX_ACTIVE_MISSIONS||balance<m.companyCost||now>=m.expiresAt" @click="takeMission(m.id)">{{now>=m.expiresAt?'마감':acceptLabel(m)}}</button>
        </div>
       </div>
      </div>
     </section>
     <section class="company-section" v-if="game.missions.history.length">
      <div class="section-heading"><h2>완료된 임무</h2></div>
      <div class="content-card history-card">
       <div v-for="m in game.missions.history.slice(0,5)" :key="m.id" class="log-row"><span>{{m.title}}<small>{{clock(m.completedAt)}}</small></span><strong>+{{money(m.companyProfit)}}</strong></div>
      </div>
     </section>
    </template>
   </template>
   <template v-else-if="screen==='guide'">
    <div class="page-intro"><h1>게임 안내</h1></div>
    <div class="menu-list"><button class="menu-row" @click="open('changelog')"><span class="menu-glyph">◷</span><span class="menu-text"><strong>변경 기록</strong></span><span class="arrow">›</span></button></div>
   </template>
   <template v-else-if="screen==='changelog'">
    <div class="page-intro"><h1>변경 기록</h1></div>
    <div class="content-card version-list" aria-label="최신 변경 기록 10개"><div v-for="item in CHANGELOG" :key="item.version" class="version-entry"><h2>{{item.version}}</h2><p>{{item.detail}}</p></div></div>
   </template>
   <template v-else-if="screen==='data'">
    <div class="page-intro"><h1>저장 관리</h1></div>
    <div class="content-card">
     <div class="fact"><span>게임 버전</span><strong>{{GAME_VERSION}}</strong></div>
     <div class="save-actions"><button class="primary" @click="exportJson">내보내기</button><button class="secondary" @click="backupInput?.click()">불러오기</button></div>
     <input ref="backupInput" class="file-input" type="file" accept=".json,application/json" @change="importJson"/>
    </div>
   </template>
   <template v-else-if="screen==='rename'">
    <div class="content-card"><h1>회사 이름</h1><input v-model="companyName" maxlength="40" placeholder="회사 이름"/><button class="primary" @click="changeName">이름 저장</button></div>
   </template>
  </main>
 </div>
 <footer class="bottom-bar" v-if="ready&&!blocked&&game.phase==='ready'">
  <button :disabled="path.length<=1" @click="back"><span>←</span> 이전</button>
  <div v-if="screen!=='data'" class="footer-mid">{{saved}}</div>
  <button @click="home"><span>⌂</span> 처음으로</button>
 </footer>
 <div v-if="message" class="toast" role="status">{{message}}</div>
</div>
</template>
