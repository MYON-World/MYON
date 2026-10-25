<script setup>
const buildId = __MYON_BUILD_ID__
const frameUrl = String(import.meta.env.BASE_URL) + 'myon.html?build=' + encodeURIComponent(buildId)
</script>

<template>
  <iframe class="game-frame" :src="frameUrl" title="MYON" />
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
</style>
