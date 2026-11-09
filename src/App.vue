<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const buildId = __MYON_BUILD_ID__
const baseUrl = String(import.meta.env.BASE_URL)
const frameUrl = baseUrl + 'myon.html?build=' + encodeURIComponent(buildId)
const isDevelopment = /\/dev\/integrated\/?$/.test(baseUrl)
const devVersion = 'DEV 0.0003'

// Matches the 23 mission definitions shown in the integrated game's mission catalog.
// Each leaf runs the original mission logic in its own DEV-only, memory-only frame.
const previewGroups = [
  { key: 'vehicles', name: '차량·화물', items: [
    { id: 'unit/taxi', name: '택시' },
    { id: 'unit/truck', name: '화물차' },
  ] },
  { key: 'bus', name: '버스', items: [
    { id: 'route/village', name: '마을버스' },
    { id: 'route/city', name: '시내버스' },
    { id: 'route/express', name: '광역버스' },
    { id: 'route/nightExpress', name: '심야광역버스' },
    { id: 'route/demandMorning', name: '수요대응 광역버스 출근용' },
    { id: 'route/demandEvening', name: '수요대응 광역버스 퇴근용' },
    { id: 'route/demandFull', name: '수요대응 광역버스 전구간용' },
    { id: 'route/demandCharter', name: '수요대응 전세버스' },
  ] },
  { key: 'rail', name: '철도', items: [
    { id: 'route/tram', name: '트램' },
    { id: 'route/subway', name: '지하철' },
    { id: 'route/subwayExpress', name: '지하철급행' },
    { id: 'route/nightSubway', name: '심야지하철' },
    { id: 'route/regional', name: '일반열차' },
    { id: 'route/highspeed', name: '고속열차' },
  ] },
  { key: 'air', name: '항공', items: [
    { id: 'unit/domestic', name: '국내선' },
    { id: 'unit/international', name: '국제선' },
  ] },
  { key: 'marine', name: '해상·우주', items: [
    { id: 'unit/ship', name: '선박' },
    { id: 'unit/space', name: '우주임무' },
  ] },
  { key: 'construction', name: '건설·유지보수', items: [
    { id: 'construction/newRail', name: '신규 철도건설' },
    { id: 'construction/railRepair', name: '철도보수' },
    { id: 'construction/roadRepair', name: '도로보수' },
  ] },
]
const previewEntries = previewGroups.flatMap(group =>
  group.items.map(item => ({ ...item, groupName: group.name })),
)

const activePage = ref('menu')
const integratedVisited = ref(false)
const previewId = ref('')
const previewRevision = ref(0)
const selectedPreview = computed(() => previewEntries.find(entry => entry.id === previewId.value) || null)
const previewFrameUrl = computed(() => frameUrl + '&preview=' + encodeURIComponent(previewId.value))

const history = [
  {
    version: 'DEV 0.0003',
    date: '2026-11-10',
    title: '분야별 계층 메뉴와 임무별 미리보기',
    description: '6개 분야의 하위 메뉴에서 23종 정식 임무를 선택해 독립적으로 체험하는 화면을 연결',
  },
  {
    version: 'DEV 0.0002',
    date: '2026-11-10',
    title: '임무별 독립 실행 기반',
    description: '개발 환경에서 선택한 정식 임무를 즉시 생성하고, 다른 임무와 저장 데이터로부터 분리하는 미리보기 로직 추가',
  },
  {
    version: 'DEV 0.0001',
    date: '2026-11-10',
    title: '개발센터 기본 메뉴',
    description: '개발 메뉴 진입 화면 신설, 기존 통합판의 메뉴 진입 방식 변경, 기능별 미리보기 영역과 자체 변경 기록 메뉴 준비',
  },
]

function syncRoute() {
  if (!isDevelopment) return
  const hash = window.location.hash.slice(1)
  const requestedId = hash.startsWith('preview/') ? hash.slice(8) : ''
  const preview = previewEntries.find(entry => entry.id === requestedId)
  activePage.value = preview ? 'preview' : hash === 'integrated' || hash === 'history' ? hash : 'menu'
  previewId.value = preview ? preview.id : ''
  if (activePage.value === 'integrated') integratedVisited.value = true
}

function navigate(page) {
  if (page === 'integrated') integratedVisited.value = true
  window.location.hash = page === 'menu' ? '' : page
  syncRoute()
}

function openPreview(id) {
  if (!previewEntries.some(entry => entry.id === id)) return
  previewRevision.value = 0
  window.location.hash = 'preview/' + id
  syncRoute()
}

onMounted(() => {
  if (!isDevelopment) return
  document.title = 'MYON ' + devVersion
  syncRoute()
  window.addEventListener('hashchange', syncRoute)
})

onUnmounted(() => {
  if (isDevelopment) window.removeEventListener('hashchange', syncRoute)
})
</script>

<template>
  <div v-if="isDevelopment" class="dev-viewport">
    <div class="dev-shell">
      <header class="dev-header">
        <div class="dev-header-left">
          <button
            v-if="activePage !== 'menu'"
            type="button"
            class="back-button"
            aria-label="개발센터 메뉴로 돌아가기"
            @click="navigate('menu')"
          >←</button>
          <div class="dev-brand">
            <strong>MYON</strong>
            <span>개발센터</span>
          </div>
        </div>
        <span class="version-tag">{{ devVersion }}</span>
      </header>

      <main v-show="activePage === 'menu'" class="dev-menu">
        <div class="dev-intro">
          <p class="eyebrow">DEVELOPMENT CENTER</p>
          <h1>개발 메뉴</h1>
          <p>각 기능을 개발하고, 통합판에서 함께 확인하는 작업 공간입니다.</p>
        </div>

        <nav class="menu-tree" aria-label="MYON 개발 메뉴">
          <section class="menu-section">
            <button type="button" class="menu-root" @click="navigate('integrated')">
              <span class="menu-index">01</span>
              <span class="menu-root-content">
                <strong>통합판</strong>
                <small>기존 MYON 게임과 개발 기능을 함께 확인</small>
              </span>
              <span class="menu-arrow" aria-hidden="true">›</span>
            </button>
          </section>

          <details class="menu-section preview-section">
            <summary class="menu-root">
              <span class="menu-index">02</span>
              <span class="menu-root-content">
                <strong>기능별 미리보기</strong>
                <small>개별 기능을 독립적으로 개발하고 확인</small>
              </span>
              <span class="menu-expand" aria-hidden="true">⌄</span>
            </summary>
            <div class="menu-children">
              <details v-for="group in previewGroups" :key="group.key" class="mission-menu-group">
                <summary class="mission-menu-heading">
                  <strong>{{ group.name }}</strong>
                  <span class="mission-menu-count">{{ group.items.length }}종</span>
                  <span class="mission-menu-chevron" aria-hidden="true">⌄</span>
                </summary>
                <div class="mission-menu-items">
                  <button
                    v-for="item in group.items"
                    :key="item.id"
                    type="button"
                    class="mission-menu-link"
                    @click="openPreview(item.id)"
                  >
                    <span class="tree-branch" aria-hidden="true">└</span>
                    <span>{{ item.name }}</span>
                    <span class="mission-link-arrow" aria-hidden="true">›</span>
                  </button>
                </div>
              </details>
            </div>
          </details>

          <section class="menu-section">
            <button type="button" class="menu-root" @click="navigate('history')">
              <span class="menu-index">03</span>
              <span class="menu-root-content">
                <strong>개발 변경 기록</strong>
                <small>MYON 안에서 개발 이력 확인</small>
              </span>
              <span class="menu-arrow" aria-hidden="true">›</span>
            </button>
          </section>
        </nav>
        <p class="dev-note">개발 환경에서는 정식 게임의 저장 데이터를 읽거나 수정하지 않습니다.</p>
      </main>

      <main v-show="activePage === 'history'" class="history-view">
        <div class="view-intro">
          <p class="eyebrow">DEVELOPMENT HISTORY</p>
          <h1>개발 변경 기록</h1>
          <p>개발센터에 반영된 변경 사항을 확인합니다.</p>
        </div>
        <ol class="history-list">
          <li v-for="entry in history" :key="entry.version" class="history-entry">
            <div class="history-meta">
              <strong>{{ entry.version }}</strong>
              <time :datetime="entry.date">{{ entry.date }}</time>
            </div>
            <h2>{{ entry.title }}</h2>
            <p>{{ entry.description }}</p>
          </li>
        </ol>
      </main>

      <section v-if="activePage === 'preview' && selectedPreview" class="preview-view" aria-label="임무 미리보기">
        <div class="preview-heading">
          <p class="preview-breadcrumb">기능별 미리보기 / {{ selectedPreview.groupName }}</p>
          <div class="preview-heading-title">
            <h1>{{ selectedPreview.name }}</h1>
            <button type="button" class="preview-restart" @click="previewRevision++">임무 다시 시작</button>
          </div>
          <p>선택한 정식 임무를 독립적으로 실행합니다. 실제 시간 기준이며, 정식 저장과 통합판에 영향을 주지 않습니다.</p>
        </div>
        <iframe
          :key="previewId + ':' + previewRevision"
          class="game-frame preview-frame"
          :src="previewFrameUrl"
          :title="selectedPreview.name + ' 미리보기'"
        />
      </section>

      <section v-show="activePage === 'integrated'" class="integrated-view" aria-label="개발 통합판">
        <div class="integrated-label">
          <strong>통합판</strong>
          <span>개발 게임 · 저장 없음</span>
        </div>
        <iframe
          v-if="integratedVisited"
          class="game-frame integrated-frame"
          :src="frameUrl"
          title="MYON 개발 통합판"
        />
      </section>
    </div>
  </div>

  <iframe v-else class="game-frame" :src="frameUrl" title="MYON" />
</template>

<style scoped>
.game-frame {
  display: block;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  border: 0;
  background: #0e171b;
}

.dev-viewport {
  display: flex;
  justify-content: center;
  width: 100%;
  height: 100dvh;
  background: #0b1217;
  color: #edf5f0;
}

.dev-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 450px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #0e171b;
}

.dev-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 64px;
  padding: 0 16px;
  border-bottom: 1px solid #2c4346;
  background: #14242a;
}

.dev-header-left, .dev-brand {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 9px;
}

.dev-brand strong { font-size: 19px; letter-spacing: .01em; }
.dev-brand span { font-size: 12px; color: #a9c7ba; white-space: nowrap; }
.version-tag {
  flex: none;
  border: 1px solid #3a6156;
  border-radius: 5px;
  padding: 6px 8px;
  color: #c2ebd0;
  font-size: 11px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.back-button {
  width: 31px;
  height: 31px;
  padding: 0;
  border: 1px solid #39565b;
  border-radius: 8px;
  background: #20383f;
  color: #e3f2ec;
  font-size: 19px;
  cursor: pointer;
}

.dev-menu, .history-view {
  flex: 1;
  min-height: 0;
  padding: 22px 16px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: #3c5756 transparent;
}

.dev-intro, .view-intro { margin: 0 0 22px; }
.eyebrow {
  margin: 0 0 7px;
  color: #8eb8a7;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .16em;
}

.dev-intro h1, .view-intro h1 {
  margin: 0 0 8px;
  font-size: 24px;
  letter-spacing: -.04em;
}

.dev-intro > p:last-child, .view-intro > p:last-child {
  margin: 0;
  color: #a1b9b1;
  font-size: 12px;
  line-height: 1.7;
}

.menu-tree { display: flex; flex-direction: column; gap: 9px; }
.menu-section {
  overflow: hidden;
  border: 1px solid #30484a;
  border-radius: 11px;
  background: #19292e;
}

.menu-root {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 15px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  list-style: none;
  font: inherit;
}

.menu-root::-webkit-details-marker { display: none; }
button.menu-root:hover, summary.menu-root:hover { background: #20363a; }
.menu-root:focus-visible, .back-button:focus-visible {
  outline: 2px solid #8bdec3;
  outline-offset: -3px;
}

.menu-index {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border: 1px solid #3a6258;
  border-radius: 9px;
  color: #b2e7d1;
  font-size: 12px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.menu-root-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 5px;
}

.menu-root-content strong { font-size: 14px; font-weight: 750; }
.menu-root-content small { color: #99b3aa; font-size: 11px; line-height: 1.4; }
.menu-arrow, .menu-expand { flex: none; color: #acd4c2; font-size: 22px; line-height: 1; }
.menu-expand { transition: transform .15s; }
.preview-section[open] .menu-expand { transform: rotate(180deg); }
.menu-children { border-top: 1px solid #30484a; padding: 12px 14px 14px 18px; }
.mission-menu-group {
  overflow: hidden;
  border: 1px solid #30484a;
  border-radius: 8px;
  background: #14252a;
}
.mission-menu-group + .mission-menu-group { margin-top: 7px; }
.mission-menu-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  cursor: pointer;
  list-style: none;
  font-size: 12px;
}
.mission-menu-heading::-webkit-details-marker { display: none; }
.mission-menu-heading strong { flex: 1; }
.mission-menu-count { color: #9bb9af; font-size: 11px; }
.mission-menu-chevron { color: #acd4c2; font-size: 16px; transition: transform .15s; }
.mission-menu-group[open] .mission-menu-chevron { transform: rotate(180deg); }
.mission-menu-heading:focus-visible, .mission-menu-link:focus-visible {
  outline: 2px solid #8bdec3;
  outline-offset: -3px;
}
.mission-menu-items { border-top: 1px solid #2c4346; padding: 5px 0; }
.mission-menu-link {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  color: #d2e7dd;
  text-align: left;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.mission-menu-link:hover { background: #20383c; }
.tree-branch { color: #678f83; font-size: 13px; }
.mission-link-arrow { margin-left: auto; color: #8fbcab; font-size: 18px; }

.dev-note {
  margin: 23px 2px 0;
  color: #849e95;
  font-size: 11px;
  line-height: 1.65;
}

.history-list { list-style: none; display: flex; flex-direction: column; gap: 10px; padding: 0; margin: 0; }
.history-entry {
  border: 1px solid #30484a;
  border-radius: 10px;
  padding: 14px;
  background: #19292e;
}
.history-meta { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.history-meta strong { color: #bdebd5; font-size: 12px; }
.history-meta time { color: #8ca99d; font-size: 11px; }
.history-entry h2 { margin: 10px 0 5px; font-size: 14px; }
.history-entry p { margin: 0; color: #a4bfb3; font-size: 11px; line-height: 1.7; }

.preview-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.preview-heading {
  flex: none;
  padding: 14px 15px;
  background: #112329;
  border-bottom: 1px solid #30484a;
}
.preview-breadcrumb {
  margin: 0 0 7px;
  color: #94b8a9;
  font-size: 10px;
}
.preview-heading-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.preview-heading-title h1 { margin: 0; font-size: 16px; }
.preview-heading > p:last-child { margin: 9px 0 0; color: #9db7ac; font-size: 10px; line-height: 1.5; }
.preview-restart {
  flex: none;
  padding: 7px 9px;
  border: 1px solid #426c60;
  border-radius: 6px;
  background: #1e3c37;
  color: #bcebd5;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
.preview-restart:focus-visible { outline: 2px solid #8bdec3; outline-offset: 2px; }
.preview-frame { flex: 1; height: auto; min-height: 0; }

.integrated-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.integrated-view[style*="display: none"] { display: none !important; }
.integrated-label {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid #30484a;
  color: #c0ddd0;
  background: #102026;
}
.integrated-label strong { font-size: 12px; }
.integrated-label span { color: #91afa4; font-size: 10px; }
.integrated-frame {
  flex: 1;
  height: auto;
  min-height: 0;
}

@media (min-width: 600px) {
  .dev-viewport { padding: 20px 0; }
  .dev-shell {
    height: 100%;
    border: 1px solid #304448;
    border-radius: 16px;
    box-shadow: 0 0 35px #0005;
  }
}

@media (max-width: 360px) {
  .dev-brand strong { font-size: 17px; }
  .dev-brand span { font-size: 11px; }
  .dev-header { padding: 0 12px; }
  .version-tag { font-size: 10px; padding: 6px; }
  .menu-root { gap: 9px; }
}
</style>
