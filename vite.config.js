import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/MYON/',
  // GitHub Actions는 매 배포의 GITHUB_SHA를 제공합니다.
  // 로컬 빌드에서는 빌드 시각을 대신 사용합니다.
  define: {
    __MYON_BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA || String(Date.now())),
  },
})
