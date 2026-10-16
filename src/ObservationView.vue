<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import {
  makeInitialObservation, validObservation, migrateLegacyObservation,
  advanceObservation, loadObservation, saveObservation,
  remainingSeconds, formatCountdown,
} from './observation.js'
import {
  loadOrCreateProgress, loadProgress, saveProgress,
  companyFormOpen, menuIsUnlocked, createCompany, beginMenuUnlock,
} from './progression.js'

const now = ref(Date.now())
const state = ref(null)
const progress = ref(null)
const view = ref('home')
const menuStack = ref(['base'])
const companyInput = ref('')
const busy = ref(false)
const errorMessage = ref('')
const booting = ref(true)
const CATEGORIES = { bus: '버스', rail: '철도', air: '항공', sea: '해상', space: '우주' }

// 후속 버전에서 children에 항목을 추가해도 탐색 구조는 변경하지 않습니다.
const MENU_TREE = Object.freeze({
  base: { title: '기본 메뉴', parent: null, children: ['company', 'settings'] },
  company: { title: '회사 관리', parent: 'base', children: [], locked: true },
  settings: { title: '설정', parent: 'base', children: [], locked: true },
})

const currentMenu = computed(() => MENU_TREE[menuStack.value.at(-1)] ?? MENU_TREE.base)
const hasCompany = computed(() => Boolean(progress.value?.companyName))
const showCompanyForm = computed(() => companyFormOpen(progress.value, now.value))
const menuUnlocked = computed(() => menuIsUnlocked(progress.value, now.value))
const menuWaiting = computed(() => hasCompany.value && progress.value.menuUnlockStartedAt === null)
const menuCounting = computed(() => hasCompany.value && progress.value.menuUnlockStartedAt !== null && !menuUnlocked.value)
const companyValid = computed(() => companyInput.value.trim().replace(/\s+/g, ' ').length > 0 &&
  companyInput.value.trim().replace(/\s+/g, ' ').length <= 40)

// 0초가 되기 전에는 회사생성과 메뉴 해금 임무도 다른 임무와 동일하게 정렬합니다.
const sortedItems = computed(() => {
  const items = (state.value?.tasks ?? []).map(task => ({ ...task, kind: 'transport' }))
  if (progress.value && !hasCompany.value && !showCompanyForm.value) {
    items.push({ id: 'unlock-company', kind: 'company-countdown', endsAt: progress.value.companyUnlockAt })
  }
  if (menuCounting.value) {
    items.push({ id: 'unlock-menu', kind: 'menu-countdown', endsAt: progress.value.menuUnlockedAt })
  }
  items.sort((a, b) => a.endsAt - b.endsAt || (a.startedAt ?? 0) - (b.startedAt ?? 0))
  return items
})

const KST_CLOCK = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const kstTime = computed(() => KST_CLOCK.format(new Date(now.value)))
const timeLeft = item => formatCountdown(Math.max(0, Math.ceil((item.endsAt - now.value) / 1000)))

let timer = 0
let lastPaintSecond = -1
let observationSaveQueue = Promise.resolve()
let isMounted = false

function persistObservation(snapshot) {
  observationSaveQueue = observationSaveQueue.catch(() => {}).then(() => saveObservation(snapshot))
    .catch(error => console.warn('MYON 관전 저장 오류:', error))
}

function reconcile(time) {
  if (!state.value) return
  const next = advanceObservation(state.value, time)
  if (next !== state.value) {
    state.value = next
    persistObservation(next)
  }
}

function refresh() {
  if (!isMounted) return
  const time = Date.now()
  reconcile(time)
  if (Math.floor(time / 1000) !== lastPaintSecond) {
    now.value = time
    lastPaintSecond = Math.floor(time / 1000)
  }
}

async function initialize() {
  booting.value = true
  try {
    // 관전 저장은 v0.01 원본 DB를 그대로 사용합니다.
    const saved = await loadObservation()
    if (!isMounted) return
    const time = Date.now()
    const initial = validObservation(saved) ? saved :
      migrateLegacyObservation(saved, time) ?? makeInitialObservation(time)
    const current = advanceObservation(initial, time)
    state.value = current
    if (!validObservation(saved) || current !== saved) persistObservation(current)
  } catch (error) {
    console.warn('MYON 관전 저장 오류:', error)
    if (!isMounted) return
    state.value = makeInitialObservation(Date.now())
    errorMessage.value = '관전 기록을 저장할 수 없습니다. 브라우저 저장소를 확인해 주세요.'
  }

  try {
    const loaded = await loadOrCreateProgress(Date.now())
    if (!isMounted) return
    progress.value = loaded
  } catch (error) {
    console.warn('MYON 진행 정보 오류:', error)
    if (!isMounted) return
    errorMessage.value = '진행 정보를 불러올 수 없습니다. 브라우저 저장소를 확인해 주세요.'
  }
  booting.value = false
  refresh()
}

async function commitProgress(next) {
  busy.value = true
  errorMessage.value = ''
  try {
    await saveProgress(next)
    progress.value = next
    return true
  } catch (error) {
    console.warn('MYON 진행 정보 저장 오류:', error)
    errorMessage.value = '진행 정보를 저장하지 못했습니다. 다시 시도해 주세요.'
    return false
  } finally {
    busy.value = false
  }
}

async function confirmCompany() {
  if (busy.value || !progress.value || !showCompanyForm.value || !companyValid.value) return
  const name = companyInput.value.trim().replace(/\s+/g, ' ')
  // 확인 이전에는 관전 단계와 메뉴 잠금 상태를 변경하지 않습니다.
  if (!window.confirm(`'${name}' 회사를 생성하시겠습니까?`)) return
  try {
    const next = createCompany(progress.value, name, Date.now())
    if (await commitProgress(next)) companyInput.value = ''
  } catch (error) {
    errorMessage.value = error.message
  }
}

async function startMenu() {
  if (busy.value || !menuWaiting.value) return
  try {
    await commitProgress(beginMenuUnlock(progress.value, Date.now()))
  } catch (error) {
    errorMessage.value = error.message
  }
}

function enterMenu() {
  if (!menuUnlocked.value) return
  menuStack.value = ['base']
  view.value = 'menu'
  window.scrollTo({ top: 0, behavior: 'instant' })
}
function openChild(id) {
  const current = currentMenu.value
  if (!current.children.includes(id) || !MENU_TREE[id] || MENU_TREE[id].locked) return
  menuStack.value = [...menuStack.value, id]
  window.scrollTo({ top: 0, behavior: 'instant' })
}
function goHome() {
  view.value = 'home'
  window.scrollTo({ top: 0, behavior: 'instant' })
}
function goPrevious() {
  if (menuStack.value.length <= 1) goHome()
  else menuStack.value = menuStack.value.slice(0, -1)
}

async function syncOnFocus() {
  refresh()
  // 다른 탭에서 회사를 생성/해금한 경우, 재진입 시 최신 상태를 복구합니다.
  if (!isMounted || busy.value || !progress.value) return
  try {
    const latest = await loadProgress()
    if (isMounted && !busy.value && latest) progress.value = latest
  } catch (error) {
    console.warn('MYON 진행 동기화 오류:', error)
  }
}

onMounted(() => {
  isMounted = true
  initialize()
  timer = window.setInterval(refresh, 250)
  document.addEventListener('visibilitychange', syncOnFocus)
  window.addEventListener('pageshow', syncOnFocus)
  window.addEventListener('focus', syncOnFocus)
})
onBeforeUnmount(() => {
  isMounted = false
  window.clearInterval(timer)
  document.removeEventListener('visibilitychange', syncOnFocus)
  window.removeEventListener('pageshow', syncOnFocus)
  window.removeEventListener('focus', syncOnFocus)
})
</script>

<template>
  <div class="observation-root">
    <header class="observation-header">
      <div class="observation-brand">
        <span class="observation-mark">M</span>
        <strong>MYON</strong>
        <template v-if="hasCompany">
          <span class="brand-divider">|</span>
          <span class="company-brand">{{ progress.companyName }}</span>
        </template>
      </div>
      <div v-if="hasCompany" class="header-meta">
        <span class="header-version">v0.02</span>
        <time class="header-clock" aria-label="현재 한국 표준시간">{{ kstTime }}</time>
      </div>
    </header>

    <main v-if="view === 'home'" class="observation-content">
      <div v-if="booting" class="empty-text" role="status">불러오는 중...</div>
      <template v-else>
        <div v-if="menuUnlocked" class="pinned-section">
          <button class="observation-card menu-entry-card" type="button" @click="enterMenu">
            <span class="observation-task-name">기본 메뉴</span>
            <span class="menu-chevron" aria-hidden="true">›</span>
          </button>
        </div>
        <div v-if="showCompanyForm" class="pinned-section">
          <form class="company-form-card" @submit.prevent="confirmCompany">
            <strong>회사생성</strong>
            <label class="company-label" for="myon-company-input">회사명</label>
            <div class="company-controls">
              <input id="myon-company-input" v-model="companyInput" type="text" maxlength="40"
                placeholder="회사명을 입력하세요" autocomplete="off" :disabled="busy" required />
              <button type="submit" class="company-submit" :disabled="busy || !companyValid">회사 생성</button>
            </div>
          </form>
        </div>
        <div v-if="state" class="observation-list">
          <template v-for="item in sortedItems" :key="item.id">
            <article v-if="item.kind === 'transport'" class="observation-card">
              <span class="observation-category" :class="`category-${item.category}`">{{ CATEGORIES[item.category] }}</span>
              <span class="observation-task-name">{{ item.title }}</span>
              <time class="observation-timer">{{ timeLeft(item) }}</time>
            </article>
            <article v-else class="observation-card unlock-countdown-card">
              <span class="observation-task-name">{{ item.kind === 'company-countdown' ? '회사생성' : '기본 메뉴 해금' }}</span>
              <time class="observation-timer">{{ timeLeft(item) }}</time>
            </article>
          </template>
          <!-- 회사 생성 전에는 24시간 카운트다운, 완료 후에는 실제 폼을 최상단에 고정합니다. -->
          <button v-if="menuWaiting" type="button" class="observation-card waiting-menu-card"
            :disabled="busy" @click="startMenu">
            <span class="observation-task-name">기본 메뉴 해금</span>
            <span class="waiting-start">시작 ›</span>
          </button>
        </div>
      </template>
      <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
    </main>

    <main v-else class="menu-content">
      <div class="menu-card-list">
        <template v-for="childId in currentMenu.children" :key="childId">
          <button class="observation-card menu-child-card" type="button"
            :disabled="MENU_TREE[childId].locked" @click="openChild(childId)">
            <span class="observation-task-name">{{ MENU_TREE[childId].title }}</span>
            <span v-if="MENU_TREE[childId].locked" class="observation-coming-soon">Coming soon</span>
            <span v-else class="menu-chevron" aria-hidden="true">›</span>
          </button>
        </template>
      </div>
      <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
    </main>
    <nav v-if="view === 'menu'" class="menu-footer" aria-label="메뉴 이동">
      <button type="button" @click="goPrevious"><span aria-hidden="true">←</span> 이전메뉴</button>
      <span class="current-menu-label">{{ currentMenu.title }}</span>
      <button type="button" @click="goHome">홈</button>
    </nav>
  </div>
</template>

<style scoped>
:global(html), :global(body), :global(#app) {width:100%;max-width:100%;scrollbar-width:none;-ms-overflow-style:none}
:global(html::-webkit-scrollbar), :global(body::-webkit-scrollbar), :global(#app::-webkit-scrollbar){display:none;width:0;height:0}
.observation-root{min-height:100vh;width:100%;background:#090e14;color:#e5edea;font-family:Inter,Pretendard,'Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.observation-header{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:60px;padding:12px clamp(10px,2vw,24px);background:#0d151a;border-bottom:1px solid #22302f}
.observation-brand{min-width:0;display:flex;align-items:center;gap:11px}
.observation-mark{flex:0 0 auto;width:30px;height:30px;display:grid;place-items:center;border-radius:8px;background:#c3efdc;color:#102a22;font-weight:900;font-size:16px}
.observation-brand strong{letter-spacing:.14em;font-size:17px}
.brand-divider{color:#667b75}.company-brand{font-weight:700;font-size:clamp(12px,1.5vw,15px);overflow-wrap:anywhere;min-width:0}
.header-meta{flex:0 0 auto;display:flex;align-items:center;gap:13px}.header-version{font-size:10px;color:#7b978f}.header-clock{font-size:clamp(11px,1.8vw,14px);font-variant-numeric:tabular-nums;color:#cfe4db;white-space:nowrap}
.observation-content,.menu-content{width:100%;padding:10px clamp(8px,1.6vw,20px) 24px}
.menu-content{padding-bottom:94px}
.observation-list,.menu-card-list{display:flex;flex-direction:column;gap:7px;width:100%}
.observation-card{width:100%;min-width:0;display:flex;align-items:center;gap:10px;padding:15px clamp(12px,2vw,19px);background:#111c23;border:1px solid #273b3d;border-radius:9px;color:inherit;text-align:left}
.observation-category{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-width:36px;padding:4px 7px;border-radius:4px;background:#244762;color:#d5eafa;font-size:11px;font-weight:750;line-height:1.35}
.category-bus{background:#244762;color:#d5eafa}.category-rail{background:#254937;color:#d4edda}.category-air{background:#47365f;color:#e6d8f9}.category-sea{background:#254b53;color:#c7eaf0}.category-space{background:#573f31;color:#f1dbc8}
.observation-task-name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;font-size:clamp(12px,1.5vw,15px);font-weight:650;letter-spacing:-.02em}
.observation-timer{flex:0 0 auto;margin-left:auto;white-space:nowrap;font-size:clamp(12px,1.7vw,18px);font-weight:750;font-variant-numeric:tabular-nums;font-feature-settings:'tnum';color:#e5f2ed}
.unlock-countdown-card{border-color:#355346;background:#12221e}.pinned-section{margin-bottom:7px}.menu-entry-card{cursor:pointer;border-color:#426754;background:#173027;font-weight:750}.menu-entry-card:hover{background:#1d3e31}.menu-chevron{flex:0 0 auto;margin-left:auto;font-size:22px;line-height:1;color:#a7dbc2}
.waiting-menu-card{cursor:pointer;border-color:#365447;background:#15251f}.waiting-menu-card:hover{background:#1c3228}.waiting-start{white-space:nowrap;color:#b9e8cc;font-weight:700;font-size:13px}
.company-form-card{border:1px solid #416b57;background:#142820;border-radius:9px;padding:16px clamp(12px,2vw,19px);display:flex;flex-direction:column;gap:12px}
.company-form-card>strong{font-size:15px}.company-label{font-size:12px;color:#b6d6c4;font-weight:650}
.company-controls{display:flex;gap:9px;align-items:stretch}.company-controls input{flex:1 1 auto;width:100%;min-width:0;min-height:43px;padding:10px 12px;border-radius:7px;background:#0d1b1a;border:1px solid #426354;color:#e6f6ea;font-size:14px}.company-controls input::placeholder{color:#7d9c90}
.company-submit{flex:0 0 auto;border:1px solid #b3ebcf;background:#b3ebcf;color:#122a20;border-radius:7px;font-size:13px;font-weight:750;padding:10px 15px;white-space:nowrap}.company-submit:disabled{opacity:.45}
.menu-child-card{cursor:pointer}.menu-child-card:hover:not(:disabled){background:#1c2b32}.menu-child-card:disabled{cursor:default;opacity:1;color:#dce9e3}.observation-coming-soon{margin-left:auto;white-space:nowrap;font-size:clamp(11px,1.5vw,14px);color:#82998e;font-weight:650}
.menu-footer{position:fixed;left:0;right:0;bottom:0;z-index:30;background:#0d151a;border-top:1px solid #2a4139;min-height:66px;padding:10px clamp(8px,1.6vw,20px) max(10px,env(safe-area-inset-bottom));display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) minmax(0,1fr);align-items:center;gap:7px}
.menu-footer button{border:1px solid #2c4540;border-radius:8px;background:#152321;color:#d5eade;min-height:40px;white-space:nowrap;font-size:13px;font-weight:680;padding:9px 7px}.menu-footer button:hover{background:#20352e}.current-menu-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:13px;font-weight:750}
.empty-text{padding:22px 10px;color:#92a79e;font-size:13px}.error-message{padding:13px 14px;color:#ffd9c8;border:1px solid #8e5144;background:#33221e;border-radius:8px;font-size:12px;line-height:1.6}
@media(max-width:440px){.observation-header{gap:5px}.observation-brand{gap:6px}.header-meta{gap:6px}.header-version{font-size:9px}.observation-mark{width:26px;height:26px}.observation-brand strong{font-size:14px}.company-brand{font-size:12px}}
@media(max-width:360px){.observation-card{gap:6px;padding-left:8px;padding-right:8px}.observation-category{min-width:30px;padding:4px 5px}.company-controls{flex-wrap:wrap}.company-submit{flex:1}}
</style>
