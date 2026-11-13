import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { initializeMyonIndex } from './core/myon-index.js'

// MYON index owns the shared world pointer. Do not block the existing game UI
// if IndexedDB is unavailable; the legacy iframe continues to manage its own saves.
createApp(App).mount('#app')

void initializeMyonIndex().catch(error => {
  console.error('MYON index initialization:', error)
})
