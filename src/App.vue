<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  GAME_VERSION, BASIC_UNLOCKS, UNLOCK_DURATION_MS, ACCEPT_RATE, REWARD_RATE,
  createInitialGame, isValidGame, cityMissionName, isUnlocked,
  beginUnlock, advanceWorld, renameCompany,
} from './gameEngine.js'
import {
  loadFromIndexedDB, saveToIndexedDB, makePlainSnapshot,
  loadFallback, saveFallback, downloadSaveJson, parseSaveJson,
} from './storage.js'
import { CHANGELOG } from './changelog.js'

const game = ref(createInitialGame())
const ready = ref(false)
const activeTab = ref('city')
const now = ref(Date.now())
const saveState = ref('불러오는 중')
const notice = ref('')
const latestSettlement = ref('')
const companyDraft = ref('')
const fileInput = ref(null)
const localStorageError = ref(false)
let clockTimer = null
let toastTimer = null
let queue = Promise.resolve()

const unlocked = id => isUnlocked(game.value, id)
const timeUnlocked = computed(() => unlocked('time'))
const fundsUnlocked = computed(() => unlocked('funds'))
const companyUnlocked = computed(() => unlocked('company'))
const assistantUnlocked = computed(() => unlocked('assistant'))
const mainTabs = computed(() => [
  { id: 'city', label: '도시', icon: '◈' },
  ...(companyUnlocked.value ? [{ id: 'company', label: '회사', icon: '▦' }] : []),
  ...(assistantUnlocked.value ? [{ id: 'assistant', label: '비서', icon: '✳' }] : []),
  { id: 'data', label: '저장 관리', icon: '▣' },
])
watch(mainTabs, tabs => {
  if (!tabs.some(t => t.id === activeTab.value)) activeTab.value = 'city'
})
const formatNumber = n => Number(n || 0).toLocaleString('ko-KR')
const formatClock = timestamp => new Date(timestamp).toLocaleString('ko-KR', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})
const duration = ms => {
  const all = Math.max(0, Math.ceil(ms / 1000))
  const days = Math.floor(all / 86400)
  const hours = Math.floor((all % 86400) / 3600)
  const minutes = Math.floor((all % 3600) / 60)
  const seconds = all % 60
  if (days) return `${days}일 ${hours}시간 ${minutes}분`
  if (hours) return `${hours}시간 ${minutes}분`
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`
}
const studyState = id => unlocked(id) ? '완료' : Object.hasOwn(game.value.progress.startedAt, id) ? '연구 중' : '시작 가능'
const studyStarted = id => Object.hasOwn(game.value.progress.startedAt, id)
const studyEndsAt = id => game.value.progress.startedAt[id] + UNLOCK_DURATION_MS

function toast(message) {
  notice.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { notice.value = '' }, 4000)
}

function commit(updated) {
  const snapshot = makePlainSnapshot(updated)
  if (!isValidGame(snapshot)) { toast('저장 데이터에 문제가 있습니다.'); return false }
  game.value = snapshot
  try { saveFallback(snapshot); localStorageError.value = false }
  catch (error) { console.warn('MYON backup:', error); localStorageError.value = true }
  saveState.value = '저장 중'
  queue = queue.catch(() => {}).then(() => saveToIndexedDB(snapshot))
    .then(() => { saveState.value = '자동 저장됨' })
    .catch(error => { console.error('MYON save:', error); saveState.value = '저장 실패 · JSON 백업 권장' })
  return true
}

function tick() {
  if (!ready.value) return
  now.value = Date.now()
  const { game: next, changed, newlyUnlocked, completed, paid } = advanceWorld(game.value, now.value)
  if (!changed) return
  if (completed) latestSettlement.value = paid > 0
    ? `도시 임무 ${formatNumber(completed)}건 갱신 · +${formatNumber(paid)} M`
    : `도시 임무 ${formatNumber(completed)}건이 완료되어 새 임무로 교체되었습니다.`
  if (commit(next) && newlyUnlocked.length) {
    const titles = newlyUnlocked.map(id => BASIC_UNLOCKS.find(item => item.id === id)?.title).filter(Boolean)
    toast(`${titles.join(' · ')} 연구가 완료됐습니다.`)
  }
  companyDraft.value = next.identity.company?.name || ''
}

async function hydrate() {
  let primary = null
  try { primary = await loadFromIndexedDB() }
  catch (error) { console.warn('MYON load:', error) }
  const backup = loadFallback()
  const stored = isValidGame(primary) ? primary : null
  const source = stored && backup ? (stored.updatedAt >= backup.updatedAt ? stored : backup) : stored || backup
  const initial = source || createInitialGame()
  // Offline mission completions are calculated before painting, without a live background worker.
  const restored = advanceWorld(initial, Date.now())
  game.value = restored.game
  now.value = Date.now()
  companyDraft.value = restored.game.identity.company?.name || ''
  ready.value = true
  if (restored.completed) latestSettlement.value = `접속하지 않은 동안 도시 임무 ${formatNumber(restored.completed)}건이 갱신됐습니다.`
  if (restored.newlyUnlocked.length) toast('접속하지 않은 동안 연구가 완료됐습니다.')
  commit(restored.game)
}

function startStudy(id) {
  tick()
  try {
    const next = beginUnlock(game.value, id, Date.now())
    if (commit(next)) toast('연구를 시작했습니다. 종료 후에도 실제 시간에 따라 진행됩니다.')
  } catch (error) { toast(error.message) }
}
function changeCompany() {
  try {
    const next = renameCompany(game.value, companyDraft.value, Date.now())
    if (commit(next)) toast('회사 이름이 저장되었습니다.')
  } catch (error) { toast(error.message) }
}
function exportBackup() {
  tick()
  try { downloadSaveJson(game.value); toast('save.json을 내보냈습니다.') }
  catch (error) { toast(`내보내기 실패: ${error.message}`) }
}
async function importBackup(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const imported = parseSaveJson(await file.text(), Date.now())
    const isOlder = Boolean(imported.legacyArchive)
    const description = isOlder
      ? '이전 철도 기록은 보관만 되고 현재 화면에는 표시되지 않습니다. 현재 MYON 진행 데이터 전체를 교체할까요?'
      : '현재 MYON 진행 데이터 전체를 이 save.json의 데이터로 교체할까요?'
    if (!window.confirm(description)) return
    // The imported game must win over previous browser cache and autosave snapshots.
    imported.updatedAt = Date.now()
    const restored = advanceWorld(imported, Date.now())
    if (!commit(restored.game)) return
    companyDraft.value = game.value.identity.company?.name || ''
    activeTab.value = 'city'
    toast('저장 데이터를 불러왔습니다. 실제 경과 시간이 반영되었습니다.')
  } catch (error) { toast(`불러오기 실패: ${error.message}`) }
  finally { event.target.value = '' }
}
onMounted(() => {
  hydrate().catch(error => {
    console.error('MYON startup:', error)
    saveState.value = '불러오기 오류 · 기존 저장 데이터 유지'
    toast('저장 데이터를 열 수 없습니다. 기존 데이터를 보호하기 위해 저장을 중단했습니다.')
  })
  clockTimer = setInterval(tick, 1000)
  document.addEventListener('visibilitychange', tick)
  window.addEventListener('focus', tick)
})
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
  if (toastTimer) clearTimeout(toastTimer)
  document.removeEventListener('visibilitychange', tick)
  window.removeEventListener('focus', tick)
})
</script>

<template>
  <div class="site-shell">
    <aside class="side-rail">
      <div class="brand"><div class="brand-icon">M<span>·</span></div><div><strong>MYON</strong><small>MY OWN NETWORK</small></div></div>
      <p class="rail-caption">WORKSPACE</p>
      <nav class="nav-list" aria-label="기본 메뉴">
        <button v-for="item in mainTabs" :key="item.id" type="button" :class="['nav-entry', { current: activeTab === item.id }]" @click="activeTab = item.id">
          <span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span><span v-if="item.id === 'city'" class="nav-small">14</span>
        </button>
      </nav>
      <div class="rail-foot"><div class="online-pip"></div><span>LOCAL FIRST</span><small>v{{ GAME_VERSION }}</small></div>
    </aside>

    <div class="page-shell">
      <header class="topbar">
        <div class="location-label"><span class="location-square"></span><span>MYON</span><span class="breadcrumb-divider">/</span><strong>{{ mainTabs.find(t => t.id === activeTab)?.label || '도시' }}</strong></div>
        <div class="topbar-right">
          <span v-if="timeUnlocked" class="metric time-metric"><span class="metric-label">표준시간</span>{{ formatClock(now) }}</span>
          <span v-if="fundsUnlocked" class="metric funds-metric"><span class="metric-label">보유 자금</span>{{ formatNumber(game.economy.balance) }} M</span>
          <span class="save-state"><span class="online-pip"></span>{{ saveState }}</span>
        </div>
      </header>

      <main v-if="ready" class="page-content">
        <template v-if="activeTab === 'city'">
          <section class="hero">
            <div class="hero-copy"><span class="eyebrow">MYON / LIVING WORLD</span><h1>도시는 멈추지 않습니다<span class="heading-period">.</span></h1><p>도시 임무는 언제나 진행됩니다. 어떤 기능을 발견하고 사용할지는 직접 결정하세요.</p></div>
            <div class="hero-activity"><div class="activity-pip"></div><div><strong>세계 운영 중</strong><span>{{ timeUnlocked ? '1틱 = 실제 1초' : '도시가 계속 움직입니다' }}</span></div></div>
          </section>
          <div class="mission-layout">
            <section class="board city-panel">
              <div class="board-heading"><div><div class="eyebrow">AUTOMATIC ROTATION</div><h2>도시 임무 <span class="heading-count">10</span></h2><p>완료된 임무는 사라지고 새로운 도시 임무가 이어집니다.</p></div><div class="status-lite"><span class="live-pip"></span> 자동 순환</div></div>
              <div class="city-tasks">
                <article v-for="(mission, index) in game.cityMissions" :key="mission.id" class="city-task">
                  <div class="task-index">{{ String(index + 1).padStart(2, '0') }}</div>
                  <div class="task-info"><strong>{{ cityMissionName(mission) }}</strong><div class="task-detail"><span class="active-tag"><span class="live-pip"></span> 진행 중</span><template v-if="timeUnlocked"><span>소요 {{ duration(mission.endsAt - mission.startedAt) }}</span><span>완료 예정 {{ formatClock(mission.endsAt) }}</span></template></div></div>
                  <div v-if="timeUnlocked" class="task-countdown"><strong>{{ duration(mission.endsAt - now) }}</strong><small>남은 시간</small></div>
                  <span v-else class="task-hidden">진행 중</span>
                </article>
              </div>
              <div v-if="latestSettlement" class="board-footer">{{ latestSettlement }}</div>
              <div v-else class="board-footer subtle">임무는 별도 조작 없이 계속 진행됩니다.</div>
            </section>

            <section class="unlock-column">
              <div class="unlock-heading"><div class="eyebrow">FOUNDATION RESEARCH</div><h2>기본 연구 <span class="heading-count">4</span></h2><p>순서 없이 원하는 기능부터 시작하세요.</p></div>
              <article v-for="study in BASIC_UNLOCKS" :key="study.id" :class="['unlock-card', { done: unlocked(study.id) }]">
                <div class="unlock-top"><div class="study-symbol">{{ study.symbol }}</div><span :class="['study-state', { complete: unlocked(study.id), progressing: studyStarted(study.id) && !unlocked(study.id) }]">{{ studyState(study.id) }}</span></div>
                <h3>{{ study.title }}</h3><p>{{ study.description }}</p>
                <div v-if="studyStarted(study.id) && timeUnlocked" class="unlock-time"><span>소요 24시간</span><strong>{{ unlocked(study.id) ? '연구 완료' : `${duration(studyEndsAt(study.id) - now)} 남음` }}</strong></div>
                <div v-else-if="studyStarted(study.id) && !unlocked(study.id)" class="unlock-time"><span>연구 진행 중</span><strong>시간 미확인</strong></div>
                <button type="button" :class="['study-button', { complete: unlocked(study.id) }]" :disabled="studyStarted(study.id) || unlocked(study.id)" @click="startStudy(study.id)">
                  {{ unlocked(study.id) ? '✓ 해금 완료' : studyStarted(study.id) ? '연구 진행 중' : '연구 시작' }}
                  <span v-if="!studyStarted(study.id) && !unlocked(study.id)">↗</span>
                </button>
              </article>
            </section>
          </div>
        </template>

        <template v-else-if="activeTab === 'company' && companyUnlocked">
          <div class="page-heading"><span class="eyebrow">COMPANY / MY WORLD</span><h1>나만의 회사<span class="heading-period">.</span></h1><p>회사는 앞으로 개인 운영 데이터와 심층 연구가 쌓이는 공간입니다.</p></div>
          <div class="detail-grid">
            <section class="board detail-panel"><div class="eyebrow">COMPANY PROFILE</div><h2>{{ game.identity.company.name }}</h2><p>회사 설립이 완료되었습니다. 이름과 데이터는 사용자 저장 공간에서 관리됩니다.</p>
              <form class="company-form" @submit.prevent="changeCompany"><label for="company-name">회사 이름</label><div class="form-row"><input id="company-name" v-model="companyDraft" maxlength="40" required autocomplete="off" /><button class="filled-button" type="submit">이름 저장</button></div></form>
              <div v-if="timeUnlocked" class="company-founded">설립 시각 {{ formatClock(game.identity.company.foundedAt) }}</div>
            </section>
            <section class="board detail-panel"><div class="eyebrow">RESEARCH LAB</div><h2>심층 연구</h2><p>회사가 열렸으므로 앞으로 새로운 분야별 연구를 추가할 수 있습니다.</p><div class="empty-card"><span>◇</span><strong>아직 등록된 심층 연구가 없습니다.</strong><p>교통·경영·비서 확장은 이후 업데이트에서 하나씩 추가됩니다.</p></div></section>
          </div>
        </template>

        <template v-else-if="activeTab === 'assistant' && assistantUnlocked">
          <div class="page-heading"><span class="eyebrow">ASSISTANT / SYSTEM LOG</span><h1>비서<span class="heading-period">.</span></h1><p>처음 해금한 비서는 시스템 변경기록만 안내합니다.</p></div>
          <div class="detail-grid">
            <section class="board detail-panel"><div class="eyebrow">CHANGELOG</div><h2>시스템 변경기록</h2><div class="changelog"><article v-for="(entry, index) in CHANGELOG" :key="index"><time>{{ entry.date }}</time><div><strong>{{ entry.title }}</strong><p>{{ entry.detail }}</p></div></article></div></section>
            <section class="board detail-panel"><div class="eyebrow">ASSISTANT MESSAGE</div><h2>비서 안내</h2><div class="assistant-message"><div class="assistant-avatar">✳</div><p>더 많은 정보를 얻고 싶으시면 <strong>회사 메뉴에서 관련 연구를 확인하세요.</strong></p></div><p v-if="!companyUnlocked" class="help-note">회사 메뉴는 회사 신설 연구 이후 표시됩니다. 회사를 만들지 않아도 도시 임무는 계속 돌아갑니다.</p></section>
          </div>
        </template>

        <template v-else-if="activeTab === 'data'">
          <div class="page-heading"><span class="eyebrow">DATA / LOCAL STORAGE</span><h1>저장 관리<span class="heading-period">.</span></h1><p>전체 진행 데이터를 자동 저장하고, save.json 파일 하나로 옮길 수 있습니다.</p></div>
          <div class="detail-grid">
            <section class="board detail-panel"><div class="eyebrow">EXPORT / BACKUP</div><h2>게임 전체 내보내기</h2><p>도시 임무, 해금 진행, 회사, M 자금과 향후 확장 데이터를 모두 포함합니다.</p><button class="filled-button wide" type="button" @click="exportBackup">↓ save.json 내보내기</button></section>
            <section class="board detail-panel"><div class="eyebrow">IMPORT / RESTORE</div><h2>게임 전체 불러오기</h2><p>현재 데이터를 백업한 후 불러오세요. 가져온 데이터는 현재 진행 상태를 교체합니다.</p><input ref="fileInput" class="sr-only" type="file" accept=".json,application/json" @change="importBackup"/><button class="outline-button wide" type="button" @click="fileInput?.click()">↑ save.json 불러오기</button></section>
          </div>
          <div class="board storage-board"><div><span class="eyebrow">SAVE STATUS</span><h2>로컬 저장 정보</h2></div><div class="storage-labels"><div><span>자동 저장</span><strong>IndexedDB</strong></div><div><span>게임 버전</span><strong>v{{ GAME_VERSION }}</strong></div><div><span>백업 형식</span><strong>save.json</strong></div><div><span>상태</span><strong>{{ saveState }}</strong></div></div><p class="help-note">이번 재구성은 이전 게임의 브라우저 저장공간을 건드리지 않도록 새로운 저장공간에 저장합니다. 이전 철도 저장 파일을 불러오면 철도 자료는 보관 데이터로만 남으며, 예전 철도 메뉴가 다시 나타나지는 않습니다.</p><p v-if="localStorageError" class="help-note warn">브라우저의 보조 로컬 저장에 실패했습니다. JSON 내보내기로 백업하는 것을 권장합니다.</p></div>
        </template>
      </main>
      <main v-else class="page-content"><div class="loading-panel">MYON 데이터를 불러오는 중입니다.</div></main>
      <footer class="footer"><span>MYON · MY OWN NETWORK</span><span>v{{ GAME_VERSION }} · {{ timeUnlocked ? '1 TICK = 1 SECOND' : 'LOCAL FIRST' }}</span></footer>
    </div>
    <div v-if="notice" class="toast" role="status">{{ notice }}</div>
  </div>
</template>
