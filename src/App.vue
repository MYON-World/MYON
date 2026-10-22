<script setup>
import ObservationView from './ObservationView.vue'

// v0.05 자동임무판을 기본 화면으로 사용하고, 기존 v0.03 기능은 별도 경로로 보존합니다.
const legacy = new URLSearchParams(window.location.search).get('mode') === 'legacy'
const boardUrl = `${import.meta.env.BASE_URL}mission-board.html`
</script>

<template>
  <ObservationView v-if="legacy" />
  <iframe v-else class="mission-board-frame" :src="boardUrl" title="MYON 임무판" />
</template>

<style scoped>
.mission-board-frame {
  display: block;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  border: 0;
  background: #0a0f15;
}
</style>
