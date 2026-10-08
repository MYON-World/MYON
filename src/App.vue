<script setup>
import { ref } from 'vue'

const version = ref('0.01.0')
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">MYON</div>
      <span class="version">v{{ version }}</span>
    </header>
    <section class="welcome">
      <p class="eyebrow">MY OWN NETWORK</p>
      <h1>나만의 주제, 나만의 세계.</h1>
      <p>주제가 임무가 되고, 시간이 흐르며 세계가 확장됩니다.</p>
      <div class="status"><span class="dot"></span> 기본 환경 준비 완료</div>
    </section>
    <footer>MYON · Foundation</footer>
  </main>
</template>
