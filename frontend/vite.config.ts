import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // CSS 코드 스플리팅 비활성화 — 청크마다 Tailwind base가 중복 생성되고
    // preset(디자인 시스템 토큰)이 일부 청크에만 적용되는 문제를 방지한다.
    cssCodeSplit: false,
  },
})
