<script setup>
import ObservationView from './ObservationView.vue'

// v0.06 택시 분야가 기본 화면입니다. 이전 버전은 별도 경로로 보존합니다.
const mode = new URLSearchParams(window.location.search).get('mode')
const legacy = mode === 'legacy'
const frameUrl = mode === 'missions'
  ? String(import.meta.env.BASE_URL) + 'mission-board.html'
  : String(import.meta.env.BASE_URL) + 'taxi.html' + (new URLSearchParams(window.location.search).get('preview') === '1' ? '?preview=1' : '')
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
