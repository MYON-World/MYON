import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { initializeMyonIndex } from './core/myon-index.js'
import { initializeMyonEconomy } from './core/myon-economy.js'

// Shared metadata initializes independently of the legacy iframe game.
// Never block the existing UI or touch its world/funds/vehicle records.
createApp(App).mount('#app')

void initializeMyonIndex()
  .then(() => initializeMyonEconomy())
  .catch(error => {
    console.error('MYON shared storage initialization:', error)
  })
