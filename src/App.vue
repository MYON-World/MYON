<script setup>
import ObservationView from './ObservationView.vue'

// 정적 HTML 화면은 배포마다 다른 주소를 사용해 이전 버전 캐시를 피합니다.
// 빌드 식별자는 GitHub Actions의 커밋 SHA입니다. 새 배포 때마다 변경됩니다.
const mode = new URLSearchParams(window.location.search).get('mode')
const legacy = mode === 'legacy'
const buildId = __MYON_BUILD_ID__
const pageName = mode === 'missions' ? 'mission-board.html' : mode === 'taxi' ? 'taxi.html' : mode === 'v007' ? 'myon.html' : 'myon-v008.html'
const frameUrl = String(import.meta.env.BASE_URL) + pageName + '?build=' + encodeURIComponent(buildId)
</script>

<template>
  <ObservationView v-if="legacy" />
  <iframe v-else class="myon-frame" :src="frameUrl" title="MYON" />
</template>

<style scoped>
.myon-frame {
  display: block;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  border: 0;
  background: #0a0f15;
}
</style>
