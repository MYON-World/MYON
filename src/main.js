import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// Emergency launcher: do not initialize or modify the player's legacy IndexedDB
// until they explicitly enter LIVE. The portal's backup actions are read-only.
createApp(App).mount('#app')
