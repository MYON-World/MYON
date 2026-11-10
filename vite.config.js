import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Main-branch workflow_dispatch does not change GITHUB_SHA when test changes.
// Fingerprint test-owned game assets to reliably invalidate both Vite app + iframe caches.
const gameFingerprint = createHash('sha256')
  .update(readFileSync(new URL('./public/myon.html', import.meta.url)))
  .update(readFileSync(new URL('./public/myon-v013.js', import.meta.url)))
  .digest('hex')
  .slice(0, 16)

export default defineConfig({
  plugins: [vue()],
  base: process.env.MYON_BASE_PATH || '/MYON/',
  define: {
    __MYON_BUILD_ID__: JSON.stringify('test-' + gameFingerprint),
  },
})
