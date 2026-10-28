/// <reference types="vitest/config" />
import path from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
let releaseBuild = false

export default defineConfig({
  plugins: [react(), {
    name: 'store-release-assets',
    enforce: 'pre',
    config(_config, env) {
      releaseBuild = env.mode === 'prod' || env.mode === 'production';
      // BGM과 제품용 이미지를 보존하고 시험 페이지는 제외한다.
      if (releaseBuild) {
        // 배포 워크플로의 운영 기본값과 일치시킨다. CI는 명시적 환경변수로 대체할 수 있다.
        const api = process.env.VITE_API_BASE_URL || 'https://api.mindbreeze.looxidlabs.com/api/v1';
        let url: URL;
        try { url = new URL(api); }
        catch { throw new Error('운영 API 주소 형식을 확인해 주세요.'); }
        if (url.protocol !== 'https:' || /localhost|127\.0\.0\.1|dev-api|\.local$/.test(url.hostname) || !/\/api\/v1\/?$/.test(url.pathname)) {
          throw new Error('운영 API 주소 설정을 확인해 주세요. 개발·로컬 주소는 사용할 수 없습니다.');
        }
        return {
          publicDir: false,
          define: {
            'import.meta.env.VITE_API_BASE_URL': JSON.stringify(api),
            'import.meta.env.VITE_SOCKET_URL': JSON.stringify(url.origin),
            // 운영 서버는 LIVE_PROTOCOL_V2=true 로 회차를 v2 에 고정한다. 앱·웹 운영 번들은 항상 v2 클라이언트여야 한다
            // (미주입 시 앱이 v1 으로 동작해 상담사 대기 화면에 준비 현황이 반영되지 않는다). 시험 목적일 때만 환경변수로 끈다.
            'import.meta.env.VITE_LIVE_PROTOCOL_V2': JSON.stringify(process.env.VITE_LIVE_PROTOCOL_V2 === 'false' ? 'false' : 'true'),
          },
        };
      }
    },
    resolveId(source) {
      if (releaseBuild && source.includes('/pages/design/')) return '\0store-design-disabled';
    },
    load(id) {
      if (id === '\0store-design-disabled') return 'export default function DisabledDesign() { return null; }';
    },
    generateBundle() {
      if (!releaseBuild) return;
      const copy = (dir: string, prefix = '') => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const name = prefix + entry.name;
          if (name === 'chat-test.html') continue;
          // 기존 제품이 참조하는 mb-design/assets는 보존하고 시안 HTML은 제외한다.
          if (name.startsWith('mb-design/') && !name.startsWith('mb-design/assets') && name !== 'mb-design/assets') continue;
          if (entry.isDirectory()) copy(path.join(dir, entry.name), name + '/');
          else this.emitFile({ type: 'asset', fileName: name, source: readFileSync(path.join(dir, entry.name)) });
        }
      };
      copy(path.join(rootDir, 'public'));
    },
  }],
  // SDD-246 T12: core.worker 는 동적 import(WASM 글루)를 쓰므로 ES 모듈 워커로 번들한다.
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  build: {
    cssCodeSplit: false,
  },
  test: {
    // CJS 테스트에서도 vitest 전역(test/expect)을 쓸 수 있게 한다.
    globals: true,
  },
  server: {
    host: true,
    port: 5175,
    proxy: {
      '/api': {
        target: 'https://dev-api.mindbreeze.looxidlabs.com',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'https://dev-api.mindbreeze.looxidlabs.com',
        changeOrigin: true,
        ws: true,
      },
    },
    allowedHosts: [
      'brian-macmini.taila00d2a.ts.net',
      '.taila00d2a.ts.net',
      'localhost',
    ],
  },
})
