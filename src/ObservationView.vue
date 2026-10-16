<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import {
  makeInitialObservation, validObservation, migrateLegacyObservation,
  advanceObservation, loadObservation, saveObservation,
  remainingSeconds, formatCountdown,
} from './observation.js'

const now = ref(Date.now())
const state = ref(null)
const tasks = computed(() => [...(state.value?.tasks ?? [])]
  .sort((a, b) => a.endsAt - b.endsAt || a.startedAt - b.startedAt))
const CATEGORIES = { bus: '버스', rail: '철도', air: '항공', sea: '해상', space: '우주' }

let timer = 0
let lastPaintSecond = -1
let saveQueue = Promise.resolve()
let isMounted = false

function persist(snapshot) {
  // 상태 저장을 직렬화하여 과거 스냅샷이 최신 상태를 덮어쓰지 않게 합니다.
  saveQueue = saveQueue.catch(() => {}).then(() => saveObservation(snapshot))
    .catch(error => console.warn('MYON 관전 저장 오류:', error))
}

function reconcile(time) {
  if (!state.value) return
  const next = advanceObservation(state.value, time)
  if (next !== state.value) {
    state.value = next
    persist(next)
  }
}

function refresh() {
  if (!isMounted) return
  const time = Date.now()
  reconcile(time)
  // 실제 현재 시간을 기준으로 계산하되 화면은 1초 단위로만 갱신합니다.
  if (Math.floor(time / 1000) !== lastPaintSecond) {
    now.value = time
    lastPaintSecond = Math.floor(time / 1000)
  }
}

async function initialize() {
  try {
    const saved = await loadObservation()
    if (!isMounted) return
    const time = Date.now()
    const fresh = !validObservation(saved)
    const initial = validObservation(saved) ? saved :
      migrateLegacyObservation(saved, time) ?? makeInitialObservation(time)
    const current = advanceObservation(initial, time)
    state.value = current
    if (fresh || current !== saved) persist(current)
  } catch (error) {
    console.warn('MYON 관전 저장 오류:', error)
    if (!isMounted) return
    state.value = makeInitialObservation(Date.now())
  }
  refresh()
}

onMounted(() => {
  isMounted = true
  initialize()
  timer = window.setInterval(refresh, 250)
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('pageshow', refresh)
  window.addEventListener('focus', refresh)
})
onBeforeUnmount(() => {
  isMounted = false
  window.clearInterval(timer)
  document.removeEventListener('visibilitychange', refresh)
  window.removeEventListener('pageshow', refresh)
  window.removeEventListener('focus', refresh)
})

const timeLeft = task => formatCountdown(remainingSeconds(task, now.value))
</script>

<template>
  <div class="observation-root">
    <header class="observation-header">
      <div class="observation-brand"><span class="observation-mark">M</span><strong>MYON</strong></div>
    </header>
    <main class="observation-content">
      <div v-if="state" class="observation-list">
        <article v-for="task in tasks" :key="task.id" class="observation-card">
          <span class="observation-category" :class="`category-${task.category}`">{{ CATEGORIES[task.category] }}</span>
          <span class="observation-task-name">{{ task.title }}</span>
          <time class="observation-timer">{{ timeLeft(task) }}</time>
        </article>
        <!-- 회사 설립 기능은 다음 버전에서 개방합니다. 항상 임무 목록의 맨 아래에 표시합니다. -->
        <div class="observation-card observation-company-card" aria-disabled="true">
          <span class="observation-task-name">회사생성</span>
          <span class="observation-coming-soon">Coming soon</span>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 화면은 세로 스크롤을 허용하지만 스크롤바를 숨깁니다. */
:global(html), :global(body), :global(#app) {width:100%;max-width:100%;scrollbar-width:none;-ms-overflow-style:none}
:global(html::-webkit-scrollbar), :global(body::-webkit-scrollbar), :global(#app::-webkit-scrollbar){display:none;width:0;height:0}
.observation-root{min-height:100vh;width:100%;background:#090e14;color:#e5edea;font-family:Inter,Pretendard,'Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.observation-header{display:flex;align-items:center;min-height:60px;padding:12px clamp(10px,2vw,24px);background:#0d151a;border-bottom:1px solid #22302f}
.observation-brand{display:flex;align-items:center;gap:11px}
.observation-mark{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;background:#c3efdc;color:#102a22;font-weight:900;font-size:16px}
.observation-brand strong{letter-spacing:.14em;font-size:17px}
.observation-content{width:100%;padding:10px clamp(8px,1.6vw,20px) 24px}
.observation-list{display:flex;flex-direction:column;gap:7px;width:100%}
.observation-card{width:100%;min-width:0;display:flex;align-items:center;gap:10px;padding:15px clamp(12px,2vw,19px);background:#111c23;border:1px solid #273b3d;border-radius:9px}
.observation-category{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-width:36px;padding:4px 7px;border-radius:4px;background:#244762;color:#d5eafa;font-size:11px;font-weight:750;line-height:1.35}
.category-bus{background:#244762;color:#d5eafa}
.category-rail{background:#254937;color:#d4edda}
.category-air{background:#47365f;color:#e6d8f9}
.category-sea{background:#254b53;color:#c7eaf0}
.category-space{background:#573f31;color:#f1dbc8}
.observation-task-name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;font-size:clamp(12px,1.5vw,15px);font-weight:650;letter-spacing:-.02em}
.observation-timer{flex:0 0 auto;margin-left:auto;white-space:nowrap;font-size:clamp(12px,1.7vw,18px);font-weight:750;font-variant-numeric:tabular-nums;font-feature-settings:'tnum';color:#e5f2ed}
/* 미구현 회사 생성은 목록 마지막에 고정된 비활성 안내 행입니다. */
.observation-company-card{background:#10171d;border-color:#2a3438;color:#95a49e;cursor:default;user-select:none}
.observation-company-card .observation-task-name{color:#a3afa9}
.observation-coming-soon{flex:0 0 auto;margin-left:auto;white-space:nowrap;font-size:clamp(12px,1.5vw,15px);font-weight:650;color:#8eaaa0}

@media(max-width:360px){.observation-card{gap:6px;padding-left:8px;padding-right:8px}.observation-category{min-width:30px;padding:4px 5px}}
</style>
