<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  GAME_VERSION, RESEARCH, createInitialGame, isValidGame, availableLocomotives,
  startRun, settleRuns, completeResearch, addRoute, deleteRoute,
} from './gameEngine.js'
import {
  loadFromIndexedDB, saveToIndexedDB, makePlainSnapshot,
  loadFallback, saveFallback, downloadSaveJson, parseSaveJson,
} from './storage.js'

const menus = [
  { key: 'overview', label: '운행', icon: '◈' },
  { key: 'fleet', label: '차량', icon: '▤' },
  { key: 'routes', label: '노선', icon: '⌁' },
  { key: 'research', label: '연구', icon: '✳' },
  { key: 'save', label: '저장', icon: '▣' },
]
const tab = ref('overview')
const game = ref(createInitialGame())
const ready = ref(false)
const saveStatus = ref('불러오는 중')
const toast = ref('')
const latestArrival = ref(null)
const selectedRouteId = ref('route-001')
const selectedLocoId = ref('L-001')
const selectedDestination = ref('')
const newRouteName = ref('')
const newRouteStations = ref('')
const fileInput = ref(null)
const now = ref(Date.now())
const storageEstimate = ref(null)
let ticker = null
let writeQueue = Promise.resolve()
let toastTimeout = null
let initialized = false

const completed = computed(() => game.value.progress.completedRuns)
const routeCount = computed(() => game.value.routes.length)
const researchDone = id => game.value.progress.research.includes(id)
const timeUnlocked = computed(() => researchDone('time-sense'))
const routeUnlocked = computed(() => researchDone('route-design'))
const selectedRoute = computed(() => game.value.routes.find(r => r.id === selectedRouteId.value) || game.value.routes[0])
const idleLocos = computed(() => availableLocomotives(game.value))
const selectedLoco = computed(() => idleLocos.value.find(l => l.id === selectedLocoId.value) || idleLocos.value[0])
const destinations = computed(() => selectedRoute.value && selectedLoco.value
  ? selectedRoute.value.stations.filter(s => s !== selectedLoco.value.station && selectedRoute.value.stations.includes(selectedLoco.value.station))
  : [])
const effectiveDestination = computed(() => destinations.value.includes(selectedDestination.value) ? selectedDestination.value : (destinations.value[0] || ''))
const canDispatch = computed(() => ready.value && Boolean(selectedLoco.value && selectedDestination.value && destinations.value.includes(selectedDestination.value)))
watch(destinations, items => {
  if (!items.includes(selectedDestination.value)) selectedDestination.value = items[0] || ''
}, { immediate: true })
const attachedCoaches = locoId => game.value.vehicles.filter(v => v.type === 'coach' && v.attachedTo === locoId)
const locomotiveBusy = id => game.value.activeRuns.some(r => r.locoId === id)
const activeRunFor = id => game.value.activeRuns.find(r => r.locoId === id)
const dateSeconds = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor(s % 86400 / 3600)
  const m = Math.floor(s % 3600 / 60)
  const sec = s % 60
  return d ? `${d}일 ${h}시간 ${m}분` : h ? `${h}시간 ${m}분` : `${m}분 ${String(sec).padStart(2, '0')}초`
}

function flash(message) {
  toast.value = message
  if (toastTimeout) clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => { toast.value = '' }, 4400)
}

/** Persist immutable, plain snapshots; serialize IDB writes so fast clicks cannot reorder saves. */
function replaceGame(next) {
  const snapshot = makePlainSnapshot(next)
  if (!isValidGame(snapshot)) { flash('저장할 데이터 구조를 확인해 주세요.'); return false }
  game.value = snapshot
  try {
    saveFallback(snapshot)
    saveStatus.value = '자동 저장'
  } catch (error) {
    console.warn('MYON localStorage fallback:', error)
    saveStatus.value = '로컬 백업 제한 · IndexedDB 저장 중'
  }
  writeQueue = writeQueue.catch(() => {}).then(() => saveToIndexedDB(snapshot))
    .then(() => { saveStatus.value = '자동 저장' })
    .catch(error => {
      console.error('MYON IndexedDB save failed:', error)
      saveStatus.value = '저장 오류 · JSON 백업 권장'
    })
  return true
}

function updateWorld() {
  if (!ready.value) return
  now.value = Date.now()
  const result = settleRuns(game.value, now.value)
  if (!result.finished.length) return
  latestArrival.value = result.finished.map(r => `${r.from} → ${r.to}`).join(' / ')
  replaceGame(result.game)
  flash(`${result.finished.length}개 운행 완료 · 차량 위치가 갱신되었습니다.`)
}

async function hydrate() {
  let indexed = null
  try { indexed = await loadFromIndexedDB() } catch (e) { console.warn('MYON IndexedDB load:', e) }
  const cached = loadFallback()
  const validIndexed = isValidGame(indexed) ? indexed : null
  const loaded = (validIndexed && cached)
    ? (validIndexed.updatedAt >= cached.updatedAt ? validIndexed : cached)
    : validIndexed || cached || createInitialGame()
  game.value = makePlainSnapshot(loaded)
  selectedRouteId.value = game.value.routes[0]?.id || ''
  selectedLocoId.value = game.value.vehicles.find(v => v.type === 'locomotive')?.id || ''
  ready.value = true
  const result = settleRuns(game.value, Date.now())
  if (result.finished.length) {
    latestArrival.value = result.finished.map(r => `${r.from} → ${r.to}`).join(' / ')
    flash(`접속하지 않은 동안 ${result.finished.length}개 운행이 완료되었습니다.`)
  }
  replaceGame(result.game)
  refreshStorageEstimate()
}

function dispatch() {
  updateWorld()
  try {
    const next = startRun(game.value, {
      routeId: selectedRoute.value.id,
      locoId: selectedLoco.value.id,
      to: effectiveDestination.value,
    }, Date.now())
    if (replaceGame(next)) flash('운행을 시작했습니다. 도착 시점은 아직 알 수 없습니다.')
  } catch (e) { flash(e.message) }
}

function unlockResearch(id) {
  updateWorld()
  try {
    const next = completeResearch(game.value, id, Date.now())
    if (replaceGame(next)) flash('연구가 완료되어 새로운 기능이 열렸습니다.')
  } catch (e) { flash(e.message) }
}

function saveNewRoute() {
  try {
    const next = addRoute(game.value, newRouteName.value, newRouteStations.value, Date.now())
    if (!replaceGame(next)) return
    selectedRouteId.value = next.routes.at(-1).id
    newRouteName.value = ''
    newRouteStations.value = ''
    flash('새 노선이 등록되었습니다. save.json에도 포함됩니다.')
  } catch (e) { flash(e.message) }
}

function removeRoute(route) {
  if (!window.confirm(`'${route.name}' 노선을 삭제할까요?`)) return
  try {
    const next = deleteRoute(game.value, route.id)
    if (!replaceGame(next)) return
    selectedRouteId.value = next.routes[0].id
    flash('노선을 삭제했습니다.')
  } catch (e) { flash(e.message) }
}

function exportGame() {
  updateWorld()
  try { downloadSaveJson(game.value); flash('save.json 파일을 내보냈습니다.') }
  catch (e) { flash(`내보내기 실패: ${e.message}`) }
}

async function importGame(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const parsed = parseSaveJson(await file.text())
    if (!window.confirm('현재 게임 진행 데이터 전체를 save.json의 데이터로 바꿀까요? 기존 게임은 덮어쓰게 됩니다.')) return
    // Update timestamp to ensure the restored save wins over older browser cache.
    parsed.updatedAt = Date.now()
    const result = settleRuns(parsed, Date.now())
    if (!replaceGame(result.game)) return
    selectedRouteId.value = game.value.routes[0]?.id || ''
    selectedLocoId.value = game.value.vehicles.find(v => v.type === 'locomotive')?.id || ''
    selectedDestination.value = ''
    latestArrival.value = result.finished.length ? `${result.finished.length}개 운행 복구 정산` : null
    tab.value = 'overview'
    flash('save.json을 복원했습니다. 오프라인 운행도 반영되었습니다.')
  } catch (e) { flash(`불러오기 실패: ${e.message}`) }
  finally { event.target.value = '' }
}

async function refreshStorageEstimate() {
  try {
    if (navigator.storage?.estimate) storageEstimate.value = await navigator.storage.estimate()
  } catch { /* Optional browser estimate */ }
}
const formatBytes = bytes => {
  if (!Number.isFinite(bytes)) return '측정 불가'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`
}

onMounted(() => {
  hydrate().catch(error => {
    console.error('MYON start failed:', error)
    game.value = createInitialGame()
    ready.value = true
    saveStatus.value = '불러오기 실패 · 기존 데이터 보존'
    flash('저장 데이터에 접근할 수 없습니다. 기존 데이터를 덮어쓰지 않도록 주의하세요.')
  })
  ticker = setInterval(updateWorld, 1000)
  document.addEventListener('visibilitychange', updateWorld)
  window.addEventListener('focus', updateWorld)
  initialized = true
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  if (toastTimeout) clearTimeout(toastTimeout)
  if (initialized) {
    document.removeEventListener('visibilitychange', updateWorld)
    window.removeEventListener('focus', updateWorld)
  }
})
</script>

<template>
  <div class="app-root">
    <aside class="sidebar">
      <div class="brand-wrap">
        <div class="brand-logo">M<span>.</span></div>
        <div class="brand-copy"><strong>MYON</strong><small>MY OWN NETWORK</small></div>
      </div>
      <div class="nav-caption">WORKSPACE</div>
      <nav class="side-nav" aria-label="메인 메뉴">
        <button v-for="menu in menus" :key="menu.key" :class="['nav-button', { active: tab === menu.key }]"
          type="button" @click="tab = menu.key">
          <span class="nav-symbol">{{ menu.icon }}</span> {{ menu.label }}
          <span v-if="menu.key === 'overview' && game.activeRuns.length" class="nav-count">{{ game.activeRuns.length }}</span>
        </button>
      </nav>
      <div class="side-bottom">
        <span class="environment-dot"></span>
        <span>LOCAL WORLD</span>
        <small>v{{ GAME_VERSION }}</small>
      </div>
    </aside>

    <div class="content-shell">
      <header class="topbar">
        <div class="breadcrumb"><span>MYON</span><span class="slash">/</span><strong>{{ menus.find(m => m.key === tab)?.label }}</strong></div>
        <div class="header-actions"><span class="save-indicator"><i></i>{{ saveStatus }}</span><button class="top-export" type="button" :disabled="!ready" @click="exportGame">↓ save.json</button></div>
      </header>

      <main v-if="ready" class="main-content">
        <template v-if="tab === 'overview'">
          <div class="page-heading"><div><span class="section-kicker">RAILWAY · FOUNDATION</span><h1>운행을 시작하는 곳.</h1><p>아직 회사도, 자금도, 시간표도 없습니다. 지금은 열차가 움직이는 것부터 시작합니다.</p></div><div class="phase-tag"><span class="phase-pulse"></span> 시작 단계</div></div>
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-label">진행 중 운행</div><div class="stat-value">{{ game.activeRuns.length }}<span>건</span></div><div class="stat-detail">진행 상황은 자동으로 갱신됩니다</div></div>
            <div class="stat-card"><div class="stat-label">누적 완료</div><div class="stat-value">{{ completed }}<span>회</span></div><div class="stat-detail">완료 이력은 고정배차 전까지 폐기</div></div>
            <div class="stat-card"><div class="stat-label">등록된 노선</div><div class="stat-value">{{ routeCount }}<span>개</span></div><div class="stat-detail">각 사용자의 개인 노선</div></div>
          </div>

          <div class="main-grid">
            <section class="panel dispatch-panel">
              <div class="panel-head"><div><span class="panel-kicker">DISPATCH</span><h2>새 운행 배정</h2></div><span class="soft-pill">자유 운행</span></div>
              <p class="panel-desc">어디로 보낼지 결정하세요. 운행을 시작한 뒤에는 목적지에 도착할 때까지 기다립니다.</p>
              <div class="form-stack">
                <label class="field"><span>운행 노선</span><select v-model="selectedRouteId"><option v-for="r in game.routes" :key="r.id" :value="r.id">{{ r.name }} · {{ r.stations.join(' — ') }}</option></select></label>
                <label class="field"><span>운행 기관차</span><select v-model="selectedLocoId" :disabled="!idleLocos.length"><option v-for="v in idleLocos" :key="v.id" :value="v.id">{{ v.name }} · {{ v.station }} 대기</option></select><small v-if="!idleLocos.length">현재 모든 기관차가 운행 중입니다.</small></label>
                <label class="field"><span>도착역</span><select v-model="selectedDestination" :disabled="!destinations.length"><option value="" disabled>도착역을 선택하세요</option><option v-for="st in destinations" :key="st" :value="st">{{ st }}</option></select><small v-if="selectedLoco && !destinations.length">기관차의 현재 위치가 포함된 노선을 선택해 주세요.</small></label>
              </div>
              <div class="dispatch-summary"><span>출발 위치</span><strong>{{ selectedLoco?.station || '운행 가능 차량 없음' }}</strong><span class="arrow-mark">→</span><strong>{{ effectiveDestination || '선택 대기' }}</strong></div>
              <button class="primary-button full" type="button" :disabled="!canDispatch" @click="dispatch">운행 시작 <span>↗</span></button>
              <div class="quiet-note">남은 시간은 표시되지 않습니다. 운행은 사이트를 닫아도 실제 시간에 따라 진행됩니다.</div>
            </section>

            <section class="panel operations-panel">
              <div class="panel-head"><div><span class="panel-kicker">LIVE STATUS</span><h2>현재 운행</h2></div><span class="live-dot">● LIVE</span></div>
              <div v-if="game.activeRuns.length" class="run-list">
                <article v-for="run in game.activeRuns" :key="run.id" class="run-card">
                  <div class="run-title"><strong>{{ game.vehicles.find(v => v.id === run.locoId)?.name || run.locoId }}</strong><span class="running-state"><i></i>운행 중</span></div>
                  <div class="track-preview"><div class="track-line"></div><div class="track-station left"></div><div class="moving-train">▰</div><div class="track-station right"></div></div>
                  <div class="run-stations"><span>{{ run.from }}</span><span>{{ run.to }}</span></div>
                  <div class="run-meta"><span>목적지로 이동하고 있습니다</span><strong>{{ timeUnlocked ? dateSeconds(run.endsAt - now) : '도착 시각 미확인' }}</strong></div>
                </article>
              </div>
              <div v-else class="empty-operations"><div class="empty-illustration">⌁</div><h3>운행 대기 중</h3><p>왼쪽에서 노선과 기관차를 선택해 첫 운행을 시작하세요.</p></div>
              <div v-if="latestArrival" class="arrival-note"><span>✓ 최근 완료</span><strong>{{ latestArrival }}</strong><small>세부 완료 기록은 저장하지 않습니다.</small></div>
            </section>
          </div>

          <div class="bottom-grid">
            <section class="info-strip"><span class="info-icon">✳</span><div><strong>연구로 새로운 기능을 발견하세요.</strong><p>운행 경험이 쌓이면 노선 설계와 시간 관측 기능을 사용할 수 있습니다.</p></div><button type="button" @click="tab = 'research'">연구 보기 ↗</button></section>
          </div>
        </template>

        <template v-else-if="tab === 'fleet'">
          <div class="page-heading"><div><span class="section-kicker">ROLLING STOCK</span><h1>차량 관리</h1><p>기관차와 객차는 각각 고유한 ID와 위치를 가진 독립 자산입니다.</p></div></div>
          <div class="fleet-intro panel"><span class="train-icon">▰</span><div><strong>차량 정보는 운행과 별개로 유지됩니다.</strong><p>운행이 끝나면 기관차와 연결된 객차가 함께 도착역으로 이동합니다. 연결·분리 조작은 후속 단계에서 추가됩니다.</p></div></div>
          <div class="vehicle-grid">
            <article v-for="v in game.vehicles" :key="v.id" class="panel vehicle-card">
              <div class="vehicle-top"><span :class="['vehicle-kind', v.type]">{{ v.type === 'locomotive' ? 'LOCOMOTIVE' : 'PASSENGER CAR' }}</span><span class="mono-id">{{ v.id }}</span></div>
              <div class="vehicle-avatar">{{ v.type === 'locomotive' ? '▰═' : '▣' }}</div>
              <h2>{{ v.name }}</h2>
              <div class="vehicle-meta"><span>현재 위치</span><strong>{{ v.station }}</strong></div>
              <div class="vehicle-meta"><span>상태</span><strong>{{ v.type === 'locomotive' ? (locomotiveBusy(v.id) ? '운행 중' : '대기 중') : (v.attachedTo ? `${v.attachedTo} 연결` : '미연결') }}</strong></div>
              <div v-if="v.type === 'locomotive'" class="vehicle-meta"><span>연결 객차</span><strong>{{ attachedCoaches(v.id).length }}량</strong></div>
            </article>
          </div>
        </template>

        <template v-else-if="tab === 'routes'">
          <div class="page-heading"><div><span class="section-kicker">PERSONAL NETWORK</span><h1>나의 노선</h1><p>공용 철도 자료와 별개로, 직접 만든 운행 경로는 모두 내 save.json에 보관됩니다.</p></div><span class="phase-tag">{{ routeCount }} ROUTES</span></div>
          <div class="route-grid">
            <section class="panel route-list-panel"><div class="panel-head"><div><span class="panel-kicker">NETWORK</span><h2>등록 노선</h2></div></div>
              <article v-for="r in game.routes" :key="r.id" class="route-card"><div class="route-card-top"><div><h3>{{ r.name }}</h3><span class="mono-id">{{ r.id }}</span></div><button v-if="routeUnlocked && game.routes.length > 1" class="icon-text-button" type="button" @click="removeRoute(r)">삭제</button></div><div class="station-chain"><span v-for="(st,idx) in r.stations" :key="`${r.id}-${idx}`"><i></i>{{ st }}</span></div><div class="route-footer"><span>{{ r.stations.length }}개 역</span><span>완료 {{ r.runs }}회</span></div></article>
            </section>
            <section class="panel route-editor"><div class="panel-head"><div><span class="panel-kicker">CREATE</span><h2>노선 추가</h2></div></div>
              <template v-if="routeUnlocked"><p class="panel-desc">역 이름을 쉼표로 구분해 자유롭게 작성하세요.</p><form class="form-stack" @submit.prevent="saveNewRoute"><label class="field"><span>노선명</span><input v-model="newRouteName" maxlength="40" placeholder="예: 나의 호남 운행" required /></label><label class="field"><span>경유역 (2개 이상)</span><textarea v-model="newRouteStations" rows="4" placeholder="서울, 대전, 익산, 목포" required></textarea></label><button class="primary-button full" type="submit">내 노선 등록 +</button></form></template>
              <div v-else class="locked-feature"><span>✳</span><h3>노선 설계 연구 필요</h3><p>운행을 1회 완료한 뒤 연구에서 노선 설계를 해금하면 이곳에서 자유롭게 생성할 수 있습니다.</p><button class="secondary-button" @click="tab = 'research'">연구로 이동 ↗</button></div>
            </section>
          </div>
        </template>

        <template v-else-if="tab === 'research'">
          <div class="page-heading"><div><span class="section-kicker">DISCOVERY & RESEARCH</span><h1>연구</h1><p>운영 경험이 쌓이면서 새로운 기능이 열립니다. 초기 연구에는 자금이 필요하지 않습니다.</p></div></div>
          <div class="research-progress panel"><div><span class="panel-kicker">OPERATIONAL EXPERIENCE</span><h2>{{ completed }}회 운행 완료</h2><p>기본 운행을 반복해 기술을 하나씩 발견합니다.</p></div><div class="research-symbol">✳</div></div>
          <div class="research-grid"><article v-for="(tech,index) in RESEARCH" :key="tech.id" class="panel research-card"><div class="research-step">RESEARCH 0{{ index + 1 }}</div><div class="research-badge" :class="{ done: researchDone(tech.id) }">{{ researchDone(tech.id) ? '연구 완료' : completed >= tech.requirement ? '연구 가능' : '잠김' }}</div><h2>{{ tech.title }}</h2><p>{{ tech.description }}</p><div class="research-requirement">요구 조건 · 운행 완료 {{ tech.requirement }}회</div><button class="secondary-button full" :disabled="researchDone(tech.id) || completed < tech.requirement" @click="unlockResearch(tech.id)">{{ researchDone(tech.id) ? '✓ 완료됨' : completed >= tech.requirement ? '연구 완료하기' : '아직 연구할 수 없음' }}</button></article></div>
          <section class="future-panel"><span class="section-kicker">NEXT STAGES · DEVELOPMENT ROADMAP</span><h2>앞으로 열릴 시스템</h2><div class="future-chips"><span>차량 연결·분리</span><span>고정배차</span><span>회사 설립</span><span>리얼 경제</span><span>복합열차</span><span>폐색</span><span>항공 ATC</span></div><p>이 항목들은 후속 개발 대상이며, 현재 v{{ GAME_VERSION }}에서는 실행되지 않습니다. 리얼 경제 전환은 연구 완료 후 별도 확인과 함께 영구 적용되는 방식으로 설계합니다.</p></section>
        </template>

        <template v-else-if="tab === 'save'">
          <div class="page-heading"><div><span class="section-kicker">LOCAL SAVE / PORTABLE WORLD</span><h1>저장 관리</h1><p>모든 개인 진행 상태를 save.json 파일 하나로 가져가고, 다시 불러올 수 있습니다.</p></div></div>
          <div class="save-grid"><section class="panel save-action"><div class="save-big-icon">↓</div><span class="panel-kicker">EXPORT</span><h2>전체 내보내기</h2><p>노선, 차량, 진행 중인 운행, 연구, 누적 기록 및 향후 사업 확장 데이터를 모두 저장합니다.</p><button class="primary-button full" type="button" @click="exportGame">save.json 내보내기 ↗</button></section><section class="panel save-action"><div class="save-big-icon">↑</div><span class="panel-kicker">IMPORT</span><h2>전체 불러오기</h2><p>기존 파일을 검증한 뒤 게임 전체를 복원합니다. 진행 중인 운행은 실제 경과 시간을 반영합니다.</p><input ref="fileInput" type="file" accept=".json,application/json" class="visually-hidden" @change="importGame" /><button class="secondary-button full" type="button" @click="fileInput?.click()">save.json 불러오기 ↗</button></section></div>
          <div class="panel storage-info"><div class="panel-head"><div><span class="panel-kicker">STORAGE</span><h2>저장 상태</h2></div><button class="icon-text-button" @click="refreshStorageEstimate">새로고침 ↻</button></div><div class="storage-grid"><div><span>자동 저장</span><strong>IndexedDB</strong></div><div><span>백업 형식</span><strong>save.json</strong></div><div><span>완료 운행 기록</span><strong>{{ game.runHistory.length }}건</strong></div><div><span>브라우저 저장 사용량 (추정)</span><strong>{{ storageEstimate ? formatBytes(storageEstimate.usage) : '조회 불가' }}</strong></div></div><p class="storage-footnote">브라우저 사용량은 이 사이트에 할당된 전체 저장공간의 추정치입니다. JSON 파일은 내보낸 시점의 사본이며, 이후 변경사항을 자동 반영하지 않습니다.</p></div>
          <p class="save-warning">주의: 불러오기는 현재 게임 진행을 교체합니다. 기존 게임을 보존하려면 먼저 내보내기로 백업하세요. 이전 버전의 데이터는 자동 삭제하지 않습니다.</p>
        </template>
      </main>
      <main v-else class="main-content"><div class="loading-state">MYON 데이터를 불러오고 있습니다…</div></main>
      <footer class="footer"><span>MYON · MY OWN NETWORK</span><span>v{{ GAME_VERSION }} · LOCAL FIRST</span></footer>
    </div>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </div>
</template>
