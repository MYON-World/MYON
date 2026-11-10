<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

const buildId = __MYON_BUILD_ID__
const baseUrl = String(import.meta.env.BASE_URL)
const frameUrl = baseUrl + 'myon.html?build=' + encodeURIComponent(buildId)
const isDevelopment = /\/dev\/integrated\/?$/.test(baseUrl)
const devVersion = 'DEV 0.0005'

const activePage = ref('menu')
const integratedVisited = ref(false)
const history = [
  {
    version: 'DEV 0.0005',
    date: '2026-11-10',
    title: '기능별 미리보기 폐지 · 통합판 직접 개발',
    description: '기능별 미리보기 메뉴와 실행 로직을 제거하고, 앞으로의 신규 기능은 개발 통합판에 직접 반영하도록 개발 방식을 변경. 기존 DEV 0.0002~0.0004의 실험 이력은 개발 역사로 보존',
  },
  {
    version: 'DEV 0.0004',
    date: '2026-11-10',
    title: '미리보기의 다음 임무 표시 및 자동 배정 제거',
    description: '선택한 임무 하나만 체험하도록 임무 공급 타이머와 임무 목록을 숨기고, 후속 임무 자동 생성 중단 및 개발 스크립트 캐시 갱신',
  },
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
  activePage.value = hash === 'integrated' || hash === 'history' ? hash : 'menu'
  if (activePage.value === 'integrated') integratedVisited.value = true
}

function navigate(page) {
  if (page === 'integrated') integratedVisited.value = true
  window.location.hash = page === 'menu' ? '' : page
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
          <p>새로운 기능을 통합판에 직접 적용하고 개발의 모든 과정을 기록하는 공간입니다.</p>
        </div>

        <nav class="menu-tree" aria-label="MYON 개발 메뉴">
          <section class="menu-section">
            <button type="button" class="menu-root" @click="navigate('integrated')">
              <span class="menu-index">01</span>
              <span class="menu-root-content">
                <strong>통합판</strong>
                <small>새 기능을 바로 적용하고 전체 게임에서 확인</small>
              </span>
              <span class="menu-arrow" aria-hidden="true">›</span>
            </button>
          </section>

          <section class="menu-section">
            <button type="button" class="menu-root" @click="navigate('history')">
              <span class="menu-index">02</span>
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

.menu-root:hover { background: #20363a; }
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
.menu-arrow { flex: none; color: #acd4c2; font-size: 22px; line-height: 1; }

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
